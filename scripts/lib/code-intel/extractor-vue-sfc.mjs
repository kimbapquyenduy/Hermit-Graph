/**
 * Phase 07 — Vue SFC (Single-File Component) extractor.
 *
 * Minimal MVP: extracts ONE component symbol per .vue file.
 *
 * Strategy (most-to-least preferred):
 *  1. `name: 'X'` field in `export default { name: 'X', ... }` or `defineComponent({ name: 'X' })`
 *  2. PascalCase filename derived from path basename (Vue convention)
 *
 * Inner <script> contents are scanned for methods inside `methods: { ... }`
 * and `computed: { ... }` blocks via lightweight regex — sufficient for
 * common Vue 2 patterns. Vue 3 <script setup> handled by extracting
 * exported consts (functions).
 *
 * Line numbers reflect the .vue file (not the inner script), so callers
 * can navigate to the right place in the source.
 */

import { basename, extname } from 'path';

const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/i;
const NAME_FIELD_RE = /\bname\s*:\s*['"]([A-Za-z_][\w]*)['"]/;
const METHODS_BLOCK_RE = /\bmethods\s*:\s*\{([\s\S]*?)\n\s*\}/;
const COMPUTED_BLOCK_RE = /\bcomputed\s*:\s*\{([\s\S]*?)\n\s*\}/;
const METHOD_NAME_RE = /^\s*(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;

/**
 * @param {string} filePath — relative path ending in .vue
 * @returns {boolean}
 */
export function isVueSfc(filePath) {
  return extname(filePath).toLowerCase() === '.vue';
}

/**
 * Derive PascalCase component name from path basename.
 *   resources/components/UserCard.vue          → UserCard
 *   resources/components/user-card.vue         → UserCard
 *   resources/components/control/Apexchart.vue → Apexchart
 */
function deriveNameFromPath(filePath) {
  const base = basename(filePath, '.vue');
  if (/^[A-Z]/.test(base)) return base;          // already PascalCase
  return base.split('-').map(p => p[0]?.toUpperCase() + p.slice(1)).join('');
}

/**
 * Locate the <script> block in source.
 * @param {string} src
 * @returns {{ inner: string, scriptStartLine: number } | null}
 */
function findScriptBlock(src) {
  const m = SCRIPT_BLOCK_RE.exec(src);
  if (!m) return null;
  const before = src.slice(0, m.index);
  const scriptStartLine = before.split('\n').length;
  // m[1] starts right after the opening > of <script>. The first newline
  // belongs to the original file too.
  return { inner: m[1], scriptStartLine };
}

/**
 * Count lines in a string slice up to position p, used to compute the
 * effective .vue file line number for symbols inside the script block.
 */
function lineOffsetInScript(scriptInner, posInScript) {
  return scriptInner.slice(0, posInScript).split('\n').length - 1;
}

/**
 * Extract symbols (and lightweight relations) from a .vue file.
 * @param {string} src
 * @param {string} file - relative path
 * @returns {{ symbols: object[], relations: object[] }}
 */
export function extractVueSfc(src, file) {
  const symbols = [];
  const relations = [];

  const block = findScriptBlock(src);

  // Step 1: derive component name. Prefer explicit `name:` field.
  let componentName = null;
  if (block) {
    const m = NAME_FIELD_RE.exec(block.inner);
    if (m) componentName = m[1];
  }
  if (!componentName) componentName = deriveNameFromPath(file);

  // Step 2: emit component symbol.
  const componentId = `${file}::${componentName}`;
  // Approximate the symbol's line range to the whole file (size-bounded).
  const totalLines = src.split('\n').length;
  symbols.push({
    _v: 1,
    _type: 'symbol',
    id: componentId,
    kind: 'component',
    name: componentName,
    file,
    line: [1, totalLines],
    lang: 'vue',
    exported: true,
    parent: null,
    params: 0,
  });

  // Step 3: extract methods + computed properties as members.
  if (block) {
    const methodsBlock = METHODS_BLOCK_RE.exec(block.inner);
    if (methodsBlock) {
      const inner = methodsBlock[1];
      const blockOffsetInScript = methodsBlock.index;
      let nm;
      METHOD_NAME_RE.lastIndex = 0;
      while ((nm = METHOD_NAME_RE.exec(inner)) !== null) {
        const methodName = nm[1];
        // Skip reserved words that aren't methods.
        if (['if', 'for', 'while', 'switch', 'return', 'function'].includes(methodName)) continue;
        const localLine = lineOffsetInScript(inner, nm.index);
        const fileLine = block.scriptStartLine + lineOffsetInScript(block.inner, blockOffsetInScript) + localLine;
        const memberId = `${file}::${componentName}.${methodName}`;
        symbols.push({
          _v: 1,
          _type: 'symbol',
          id: memberId,
          kind: 'method',
          name: methodName,
          file,
          line: [fileLine, fileLine + 5], // approximation — most Vue methods short
          lang: 'vue',
          exported: false,
          parent: componentName,
          params: 0,
        });
        relations.push({
          _v: 1, _type: 'relation', from: memberId, to: componentId, kind: 'MEMBER_OF', line: fileLine,
        });
      }
    }

    const computedBlock = COMPUTED_BLOCK_RE.exec(block.inner);
    if (computedBlock) {
      const inner = computedBlock[1];
      const blockOffsetInScript = computedBlock.index;
      let nm;
      METHOD_NAME_RE.lastIndex = 0;
      while ((nm = METHOD_NAME_RE.exec(inner)) !== null) {
        const propName = nm[1];
        if (['if', 'for', 'while', 'switch', 'return', 'function'].includes(propName)) continue;
        const localLine = lineOffsetInScript(inner, nm.index);
        const fileLine = block.scriptStartLine + lineOffsetInScript(block.inner, blockOffsetInScript) + localLine;
        const memberId = `${file}::${componentName}.${propName}`;
        symbols.push({
          _v: 1,
          _type: 'symbol',
          id: memberId,
          kind: 'method',
          name: propName,
          file,
          line: [fileLine, fileLine + 5],
          lang: 'vue',
          exported: false,
          parent: componentName,
          params: 0,
        });
        relations.push({
          _v: 1, _type: 'relation', from: memberId, to: componentId, kind: 'MEMBER_OF', line: fileLine,
        });
      }
    }
  }

  return { symbols, relations };
}
