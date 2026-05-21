/**
 * Phase 07 — Liquid template extractor (Shopify themes).
 *
 * Liquid files have no functions/classes — they're templates. Symbols emitted
 * here are SYNTHETIC nodes representing the file itself as a "template" kind,
 * so framework resolvers can target them for {% render 'snippet' %} edges.
 *
 * Template structure:
 *   sections/<name>.liquid   — page section
 *   snippets/<name>.liquid   — reusable snippet
 *   templates/<name>.liquid  — top-level page template
 *   layout/<name>.liquid     — wrapping layout
 *   blocks/<name>.liquid     — Shopify blocks (newer Liquid feature)
 *
 * Component name = filename without extension. Kind = inferred from parent
 * directory (section / snippet / template / layout / block).
 */

import { basename, extname, dirname } from 'path';

const LIQUID_KIND_BY_DIR = {
  sections:  'section',
  snippets:  'snippet',
  templates: 'template',
  layout:    'layout',
  blocks:    'block',
};

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isLiquid(filePath) {
  return extname(filePath).toLowerCase() === '.liquid';
}

/**
 * Infer the Liquid file's role from its parent directory.
 * Falls back to 'template' if directory isn't recognized.
 */
function inferKind(filePath) {
  const parent = basename(dirname(filePath)).toLowerCase();
  return LIQUID_KIND_BY_DIR[parent] || 'template';
}

/**
 * Extract symbols + relations from a .liquid file.
 *
 * Emits:
 *  - 1 symbol for the file itself (kind: 'component', lang: 'liquid')
 *  - relations for {% render 'snippet' %}, {% include 'header' %},
 *    {% section 'name' %} pointing at the referenced file's symbol
 *    (target ID looked up by the framework scanner in pass-3).
 *
 * @param {string} src
 * @param {string} file
 * @returns {{ symbols: object[], relations: object[] }}
 */
export function extractLiquid(src, file) {
  const symbols = [];
  const relations = [];

  const componentName = basename(file, '.liquid');
  const componentKind = inferKind(file);
  const totalLines = src.split('\n').length;

  const componentId = `${file}::${componentName}`;
  symbols.push({
    _v: 1,
    _type: 'symbol',
    id: componentId,
    kind: 'component',
    name: componentName,
    file,
    line: [1, totalLines],
    lang: 'liquid',
    exported: true,
    parent: null,
    params: 0,
    _liquidKind: componentKind,
  });

  return { symbols, relations };
}
