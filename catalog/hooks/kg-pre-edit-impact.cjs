#!/usr/bin/env node
/**
 * kg-pre-edit-impact.cjs — PreToolUse Hook for Edit / Write / MultiEdit
 *
 * Goal: when AI is about to edit a source file, surface the exported or
 * framework-bound symbols in that file so it can decide whether to call
 * `hermit_impact` first.
 *
 * Targets: Edit, Write, MultiEdit
 *
 * Soft warn only — exit code 0 always. Warnings go to stderr so Claude Code
 * shows them to the AI. Does NOT block the edit.
 *
 * Setup: Add to ~/.claude/settings.json → hooks.PreToolUse:
 *   {
 *     "matcher": "Edit|Write|MultiEdit",
 *     "hooks": [{ "type": "command", "command": "node <hermit-graph>/catalog/hooks/kg-pre-edit-impact.cjs" }]
 *   }
 *
 * Exit codes:
 *   0 — allow (always)
 *   (never exits with 2; soft-warn design)
 *
 * Env:
 *   CLAUDE_PROJECT_DIR — project root (for index lookup)
 *   HERMIT_PROJECT_CWD — alternate override
 *   HERMIT_PRE_EDIT_QUIET=1 — suppress nudges entirely
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const TARGET_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
const MAX_SYMBOLS_REPORTED = 5;

const FRAMEWORK_DIRS = /\/(middleware|commands?|jobs?|handlers?|listeners?|tasks?|observers?|events?|hooks?|subscribers?|controllers?)\//i;
const FRAMEWORK_METHODS = new Set([
  'handle', 'run', 'execute', 'process', 'dispatch', 'invoke',
  'perform', 'fire', 'trigger', 'exec', 'call', '__invoke',
]);

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function allow() {
  process.exit(0);
}

function quiet() {
  return process.env.HERMIT_PRE_EDIT_QUIET === '1';
}

function resolveProjectCwd() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.HERMIT_PROJECT_CWD || process.cwd();
}

/**
 * Extract file path from Edit/Write/MultiEdit tool_input.
 * All three use `file_path` as the primary key.
 */
function extractFilePath(toolInput) {
  return toolInput.file_path || toolInput.path || '';
}

function isSourceFile(filePath) {
  return SOURCE_EXTS.has(path.extname(filePath).toLowerCase());
}

/**
 * Load the CodeGraph index for the project. Returns { symbols, callersMap }
 * or null if missing (no nudge possible without index — silent skip).
 * callersMap: targetId → Set<sourceId>  (reverse-call lookup for blast-radius BFS)
 */
function loadGraph(projectCwd) {
  const indexPath = path.join(projectCwd, 'data', 'code-symbols.jsonl');
  if (!fs.existsSync(indexPath)) return null;
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    const symbols = [];
    const callersMap = new Map();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj._type === 'symbol') {
          symbols.push(obj);
        } else if (obj._type === 'relation' && obj.from && obj.to && String(obj.kind || '').toUpperCase() === 'CALLS') {
          if (!callersMap.has(obj.to)) callersMap.set(obj.to, new Set());
          callersMap.get(obj.to).add(obj.from);
        }
      } catch { /* skip bad lines */ }
    }
    return { symbols, callersMap };
  } catch {
    return null;
  }
}

/**
 * 3-hop upstream BFS — count callers at each depth. Runs per symbol (~1ms
 * on pre-built map), caps at d=3. Returns { d1, d2, d3, risk }.
 */
function computeImpactCounts(callersMap, symbolId) {
  let d1 = 0, d2 = 0, d3 = 0;
  const visited = new Set([symbolId]);
  const queue = [];
  for (const c of (callersMap.get(symbolId) || [])) queue.push([c, 1]);
  while (queue.length > 0) {
    const [id, depth] = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth === 1) d1++;
    else if (depth === 2) d2++;
    else if (depth === 3) d3++;
    if (depth >= 3) continue;
    for (const next of (callersMap.get(id) || [])) {
      if (!visited.has(next)) queue.push([next, depth + 1]);
    }
  }
  const risk = d1 > 5 ? 'HIGH' : d1 > 0 ? 'MEDIUM' : 'LOW';
  return { d1, d2, d3, risk };
}

function isLikelyFrameworkBound(symbol) {
  const file = symbol.file || '';
  const parent = symbol.parent || '';
  if (FRAMEWORK_DIRS.test(file) && FRAMEWORK_METHODS.has(symbol.name)) return true;
  if (symbol.kind === 'method' && /Controller$/.test(parent)) return true;
  if (symbol.kind === 'method' && /\/controllers?\//i.test(file)) return true;
  return false;
}

/**
 * Find exported or framework-bound symbols in the target file.
 * Also includes methods whose parent class is exported — a class is the
 * public API boundary, so its methods are effectively public.
 */
function findPublicSymbols(symbols, relPath) {
  const norm = relPath.replace(/\\/g, '/');
  const inFile = symbols.filter(s => {
    const sf = (s.file || '').replace(/\\/g, '/');
    return sf === norm || sf.endsWith('/' + norm) || norm.endsWith('/' + sf);
  });
  if (inFile.length === 0) return [];

  // Build set of exported class names in the file
  const exportedClasses = new Set(
    inFile.filter(s => s.kind === 'class' && s.exported).map(s => s.name)
  );

  return inFile.filter(s => {
    if (s.exported) return true;
    if (isLikelyFrameworkBound(s)) return true;
    // Methods of exported classes OR any class method (CommonJS extractor often
    // misses `module.exports = Class`, so treat all class methods as potential
    // public surface — low false-positive rate since nudge is soft warning only).
    if (s.kind === 'method' && s.parent) return true;
    return false;
  });
}

/**
 * Emit soft warning to stderr with inline impact counts per symbol.
 * Claude Code surfaces stderr from PreToolUse hooks to the AI, so the AI
 * gets d=1/d=2/d=3/risk directly — no follow-up hermit_impact call needed
 * for basic triage.
 */
function emitNudge(relPath, publicSymbols, callersMap) {
  // Compute impact per symbol, sort by d1 desc (highest risk first)
  const enriched = publicSymbols.map(s => ({
    s,
    counts: computeImpactCounts(callersMap, s.id),
    fb: isLikelyFrameworkBound(s),
  })).sort((a, b) => b.counts.d1 - a.counts.d1);

  const lines = [];
  lines.push('');
  lines.push(`[hermit pre-edit-impact] Editing ${relPath}`);
  lines.push(`  ${publicSymbols.length} exported/framework-bound symbol${publicSymbols.length === 1 ? '' : 's'} in this file (sorted by fan-in):`);

  const top = enriched.slice(0, MAX_SYMBOLS_REPORTED);
  for (const { s, counts, fb } of top) {
    const scope = s.parent ? `${s.parent}.` : '';
    const fbTag = fb ? ' [framework-bound]' : '';
    lines.push(`    - ${scope}${s.name} (${s.kind}) @ :${s.line[0]} — d=1:${counts.d1} d=2:${counts.d2} d=3:${counts.d3} risk:${counts.risk}${fbTag}`);
  }
  if (publicSymbols.length > MAX_SYMBOLS_REPORTED) {
    lines.push(`    ... ${publicSymbols.length - MAX_SYMBOLS_REPORTED} more`);
  }

  // Only mention hermit_impact drill-down if any symbol has actual callers
  const hasCallers = enriched.some(e => e.counts.d1 > 0);
  if (hasCallers) {
    lines.push('  Tip: call `hermit_impact({target: "ClassName.method"})` for full caller list + business rules.');
  } else {
    lines.push('  Tip: all symbols have 0 AST callers. Framework-bound methods may still be invoked via route/config strings — grep to confirm.');
  }
  lines.push('  (Silence: HERMIT_PRE_EDIT_QUIET=1)');
  lines.push('');

  process.stderr.write(lines.join('\n') + '\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  try {
    if (quiet()) return allow();

    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) return allow();

    const hookData = JSON.parse(stdin);
    const toolName = hookData.tool_name || '';
    if (!TARGET_TOOLS.has(toolName)) return allow();

    const filePath = extractFilePath(hookData.tool_input || {});
    if (!filePath || !isSourceFile(filePath)) return allow();

    const projectCwd = resolveProjectCwd();
    // Resolve against project root, not current working dir, since hook may be
    // invoked from a different cwd than the project being edited.
    const absFile = path.isAbsolute(filePath) ? filePath : path.resolve(projectCwd, filePath);
    const relPath = path.relative(projectCwd, absFile).replace(/\\/g, '/');

    // File outside project root — skip
    if (relPath.startsWith('..')) return allow();

    const graph = loadGraph(projectCwd);
    if (!graph) return allow(); // no index = no nudge

    const publicSymbols = findPublicSymbols(graph.symbols, relPath);
    if (publicSymbols.length === 0) return allow(); // purely internal edit

    emitNudge(relPath, publicSymbols, graph.callersMap);
    allow();
  } catch (err) {
    // Defensive: never block an edit due to hook error. Log to stderr and allow.
    process.stderr.write(`[hermit pre-edit-impact] hook error: ${err.message}\n`);
    allow();
  }
}

main();
