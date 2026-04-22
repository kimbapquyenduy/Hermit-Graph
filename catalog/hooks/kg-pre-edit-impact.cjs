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
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.xml']);
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
 * Load the CodeGraph index for the project. Returns { symbols, symbolsById, callersMap }
 * or null if missing (no nudge possible without index — silent skip).
 * callersMap: targetId → Set<sourceId>  (reverse-call lookup for blast-radius BFS)
 * symbolsById: symbolId → symbol  (O(1) caller file resolution for biz-rule overlay)
 */
function loadGraph(projectCwd) {
  const indexPath = path.join(projectCwd, 'data', 'code-symbols.jsonl');
  if (!fs.existsSync(indexPath)) return null;
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    const symbols = [];
    const symbolsById = new Map();
    const callersMap = new Map();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj._type === 'symbol') {
          symbols.push(obj);
          symbolsById.set(obj.id, obj);
        } else if (obj._type === 'relation' && obj.from && obj.to && String(obj.kind || '').toUpperCase() === 'CALLS') {
          if (!callersMap.has(obj.to)) callersMap.set(obj.to, new Set());
          callersMap.get(obj.to).add(obj.from);
        }
      } catch { /* skip bad lines */ }
    }
    return { symbols, symbolsById, callersMap };
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

/**
 * Precision targeting — extract the set of line numbers being modified from
 * Edit or MultiEdit payloads. Returns null for Write (full overwrite — no diff)
 * or when the edits cannot be resolved (not a fatal condition, caller falls back
 * to full-file reporting).
 */
function extractChangedLines(toolName, toolInput, absFilePath) {
  const edits = toolName === 'MultiEdit'
    ? (toolInput.edits || [])
    : (toolName === 'Edit' ? [{ old_string: toolInput.old_string }] : []);
  if (edits.length === 0) return null;
  if (!fs.existsSync(absFilePath)) return null;

  try {
    const content = fs.readFileSync(absFilePath, 'utf-8');
    const changed = new Set();
    for (const edit of edits) {
      const needle = edit.old_string;
      if (!needle || typeof needle !== 'string') continue;
      const idx = content.indexOf(needle);
      if (idx < 0) continue; // needle not present — maybe stale edit
      // Line 1-based: lines strictly before idx, +1 for first line of needle
      const before = content.slice(0, idx);
      const firstLine = (before.match(/\n/g) || []).length + 1;
      const needleLines = (needle.match(/\n/g) || []).length + 1;
      for (let i = 0; i < needleLines; i++) changed.add(firstLine + i);
    }
    return changed.size > 0 ? changed : null;
  } catch {
    return null;
  }
}

/**
 * Keep only symbols whose declared line range overlaps any changed line.
 * When changedLines is null (Write or diff-unavailable), returns input unchanged.
 */
function filterByChangedLines(symbols, changedLines) {
  if (!changedLines) return symbols;
  return symbols.filter(s => {
    const [start, end] = s.line || [];
    if (typeof start !== 'number' || typeof end !== 'number') return false;
    for (let l = start; l <= end; l++) if (changedLines.has(l)) return true;
    return false;
  });
}

/**
 * Load business-rule index from brain.jsonl. Returns a Map<normalizedFilePath, rule[]>.
 * Minimal re-implementation of biz-linker.buildFileRuleIndex, inlined here because
 * the hook is .cjs and biz-linker is .mjs. Returns empty map if brain missing or
 * no matching rules/flows.
 */
function loadBizIndex(projectCwd) {
  const brainPath = process.env.MEMORY_FILE_PATH
    || path.join(projectCwd, 'data', 'brain.jsonl');
  if (!fs.existsSync(brainPath)) return new Map();

  const norm = (p) => (p || '').trim()
    .replace(/:\d+(-\d+)?$/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
  const parseFiles = (text) => {
    const m = (text || '').match(/^FILES?:\s*(.+)/i);
    if (!m) return [];
    return m[1].split(/[,\s]+/).map(s => s.trim()).filter(Boolean).map(norm);
  };
  const obsText = (o) => typeof o === 'string' ? o : (o && o.content) || '';

  const index = new Map();
  try {
    const raw = fs.readFileSync(brainPath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'entity') continue;
      if (e.entityType !== 'biz-rule' && e.entityType !== 'biz-flow') continue;
      for (const obs of (e.observations || [])) {
        const text = obsText(obs).replace(/^\[[\d.]+\|\d{4}-\d{2}-\d{2}\]\s*/, '');
        for (const file of parseFiles(text)) {
          if (!index.has(file)) index.set(file, []);
          index.get(file).push({ name: e.name, entityType: e.entityType });
        }
      }
    }
  } catch { /* empty brain — fine */ }
  return index;
}

/**
 * Collect business rules that reference files in the blast-radius of the given
 * public symbols (their own file + files of their d=1 callers).
 * Returns a deduped array sorted by rule name.
 */
function findRulesAtRisk(publicSymbols, callersMap, symbolsById, bizIndex, targetRelPath) {
  if (bizIndex.size === 0) return [];

  const norm = (p) => (p || '').replace(/\\/g, '/').toLowerCase();
  const affectedFiles = new Set([norm(targetRelPath)]);

  for (const s of publicSymbols) {
    for (const callerId of (callersMap.get(s.id) || [])) {
      const caller = symbolsById.get(callerId);
      if (caller && caller.file) affectedFiles.add(norm(caller.file));
    }
  }

  const hits = new Map(); // rule name → entityType
  for (const file of affectedFiles) {
    const rules = bizIndex.get(file);
    if (!rules) continue;
    for (const r of rules) hits.set(r.name, r.entityType);
  }

  return [...hits].map(([name, entityType]) => ({ name, entityType }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
function emitNudge(relPath, publicSymbols, callersMap, opts) {
  const { bizIndex = new Map(), symbolsById = new Map(), precision = false, totalInFile = publicSymbols.length } = opts || {};

  // Compute impact per symbol, sort by d1 desc (highest risk first)
  const enriched = publicSymbols.map(s => ({
    s,
    counts: computeImpactCounts(callersMap, s.id),
    fb: isLikelyFrameworkBound(s),
  })).sort((a, b) => b.counts.d1 - a.counts.d1);

  const lines = [];
  lines.push('');
  lines.push(`[hermit pre-edit-impact] Editing ${relPath}`);
  if (precision) {
    lines.push(`  Precision mode — ${publicSymbols.length} symbol${publicSymbols.length === 1 ? '' : 's'} contain the changed lines (of ${totalInFile} public in file):`);
  } else {
    lines.push(`  ${publicSymbols.length} exported/framework-bound symbol${publicSymbols.length === 1 ? '' : 's'} in this file (sorted by fan-in):`);
  }

  const top = enriched.slice(0, MAX_SYMBOLS_REPORTED);
  for (const { s, counts, fb } of top) {
    const scope = s.parent ? `${s.parent}.` : '';
    const fbTag = fb ? ' [framework-bound]' : '';
    lines.push(`    - ${scope}${s.name} (${s.kind}) @ :${s.line[0]} — d=1:${counts.d1} d=2:${counts.d2} d=3:${counts.d3} risk:${counts.risk}${fbTag}`);
  }
  if (publicSymbols.length > MAX_SYMBOLS_REPORTED) {
    lines.push(`    ... ${publicSymbols.length - MAX_SYMBOLS_REPORTED} more`);
  }

  // Business-rule overlay — surface rules whose FILES: references the target or d=1 caller files
  const rulesAtRisk = findRulesAtRisk(publicSymbols, callersMap, symbolsById, bizIndex, relPath);
  if (rulesAtRisk.length > 0) {
    lines.push('');
    lines.push(`  Business rules at risk (${rulesAtRisk.length}):`);
    for (const r of rulesAtRisk.slice(0, MAX_SYMBOLS_REPORTED)) {
      const kind = r.entityType === 'biz-flow' ? 'FLOW' : 'RULE';
      lines.push(`    - ${kind} ${r.name}`);
    }
    if (rulesAtRisk.length > MAX_SYMBOLS_REPORTED) {
      lines.push(`    ... ${rulesAtRisk.length - MAX_SYMBOLS_REPORTED} more`);
    }
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

    const allPublic = findPublicSymbols(graph.symbols, relPath);
    if (allPublic.length === 0) return allow(); // purely internal edit

    // Precision targeting — narrow to symbols whose line range overlaps the
    // actual changed lines (Edit/MultiEdit). For Write, changedLines is null
    // and we fall back to reporting all public symbols in the file.
    const changedLines = extractChangedLines(toolName, hookData.tool_input || {}, absFile);
    const targeted = filterByChangedLines(allPublic, changedLines);
    // If diff resolution finds zero matches (stale edit text, etc.), fall back
    // to full-file list so the user still gets signal.
    const symbolsToShow = (changedLines && targeted.length > 0) ? targeted : allPublic;
    const precision = changedLines !== null && targeted.length > 0;

    const bizIndex = loadBizIndex(projectCwd);
    emitNudge(relPath, symbolsToShow, graph.callersMap, {
      bizIndex,
      symbolsById: graph.symbolsById,
      precision,
      totalInFile: allPublic.length,
    });
    allow();
  } catch (err) {
    // Defensive: never block an edit due to hook error. Log to stderr and allow.
    process.stderr.write(`[hermit pre-edit-impact] hook error: ${err.message}\n`);
    allow();
  }
}

main();
