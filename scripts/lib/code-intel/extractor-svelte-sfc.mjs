/**
 * Phase 07 — Svelte SFC extractor.
 *
 * Mirrors Vue SFC extractor. Svelte single-file components have:
 *   <script>...</script>     — component logic + named exports
 *   <style>...</style>       — scoped CSS (ignored)
 *   (template at top level)  — JSX-like markup with mustache expressions
 *
 * Component identity = PascalCase filename (Svelte convention).
 * Exported functions inside <script> become member symbols.
 * Svelte 5 runes ($state/$derived/$effect) are filtered out as builtins.
 */

import { basename, extname } from 'path';

const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/i;
const EXPORT_FN_RE = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LET_RE = /^\s*export\s+let\s+([A-Za-z_$][\w$]*)/gm;
const NAMED_FN_RE = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isSvelteSfc(filePath) {
  return extname(filePath).toLowerCase() === '.svelte';
}

function deriveNameFromPath(filePath) {
  const base = basename(filePath, '.svelte');
  if (/^[A-Z]/.test(base)) return base;
  return base.split(/[-_]/).map(p => p[0]?.toUpperCase() + p.slice(1)).join('');
}

function findScriptBlock(src) {
  const m = SCRIPT_BLOCK_RE.exec(src);
  if (!m) return null;
  const before = src.slice(0, m.index);
  const scriptStartLine = before.split('\n').length;
  return { inner: m[1], scriptStartLine };
}

function lineOffset(scriptInner, posInScript) {
  return scriptInner.slice(0, posInScript).split('\n').length - 1;
}

/**
 * Extract symbols + relations from a .svelte file.
 * @param {string} src
 * @param {string} file
 * @returns {{ symbols: object[], relations: object[] }}
 */
export function extractSvelteSfc(src, file) {
  const symbols = [];
  const relations = [];

  const block = findScriptBlock(src);
  const componentName = deriveNameFromPath(file);
  const componentId = `${file}::${componentName}`;
  const totalLines = src.split('\n').length;

  // 1. Component symbol.
  symbols.push({
    _v: 1,
    _type: 'symbol',
    id: componentId,
    kind: 'component',
    name: componentName,
    file,
    line: [1, totalLines],
    lang: 'svelte',
    exported: true,
    parent: null,
    params: 0,
  });

  if (!block) return { symbols, relations };

  // 2. Exported functions → exported members.
  const seen = new Set();
  let m;
  EXPORT_FN_RE.lastIndex = 0;
  while ((m = EXPORT_FN_RE.exec(block.inner)) !== null) {
    const fnName = m[1];
    if (seen.has(fnName)) continue;
    seen.add(fnName);
    const localLine = lineOffset(block.inner, m.index);
    const fileLine = block.scriptStartLine + localLine;
    const memberId = `${file}::${componentName}.${fnName}`;
    symbols.push({
      _v: 1, _type: 'symbol', id: memberId, kind: 'method', name: fnName,
      file, line: [fileLine, fileLine + 5], lang: 'svelte',
      exported: true, parent: componentName, params: 0,
    });
    relations.push({
      _v: 1, _type: 'relation', from: memberId, to: componentId, kind: 'MEMBER_OF', line: fileLine,
    });
  }

  // 3. export let → props (treated as members for impact tracking).
  EXPORT_LET_RE.lastIndex = 0;
  while ((m = EXPORT_LET_RE.exec(block.inner)) !== null) {
    const propName = m[1];
    if (seen.has(propName)) continue;
    seen.add(propName);
    const localLine = lineOffset(block.inner, m.index);
    const fileLine = block.scriptStartLine + localLine;
    const memberId = `${file}::${componentName}.${propName}`;
    symbols.push({
      _v: 1, _type: 'symbol', id: memberId, kind: 'variable', name: propName,
      file, line: [fileLine, fileLine + 1], lang: 'svelte',
      exported: true, parent: componentName, params: 0,
    });
    relations.push({
      _v: 1, _type: 'relation', from: memberId, to: componentId, kind: 'MEMBER_OF', line: fileLine,
    });
  }

  // 4. Internal named functions → private methods.
  NAMED_FN_RE.lastIndex = 0;
  while ((m = NAMED_FN_RE.exec(block.inner)) !== null) {
    const fnName = m[1];
    if (seen.has(fnName)) continue;
    seen.add(fnName);
    const localLine = lineOffset(block.inner, m.index);
    const fileLine = block.scriptStartLine + localLine;
    const memberId = `${file}::${componentName}.${fnName}`;
    symbols.push({
      _v: 1, _type: 'symbol', id: memberId, kind: 'method', name: fnName,
      file, line: [fileLine, fileLine + 5], lang: 'svelte',
      exported: false, parent: componentName, params: 0,
    });
    relations.push({
      _v: 1, _type: 'relation', from: memberId, to: componentId, kind: 'MEMBER_OF', line: fileLine,
    });
  }

  return { symbols, relations };
}
