/**
 * Unified symbol + relation extractor — delegates to language-specific modules.
 * Entry point for Phase 1: parseFile → extractAll → { symbols, relations }.
 */

import { extractSymbolsJS, extractRelationsJS } from './extractor-js.mjs';
import { extractSymbolsPy, extractRelationsPy } from './extractor-py.mjs';
import { extractSymbolsJava, extractRelationsJava } from './extractor-java.mjs';

/**
 * Extract all symbols from a parsed AST root.
 * @param {object} root — SgNode (ast-grep root)
 * @param {string} file — relative file path
 * @param {string} lang — 'javascript' | 'typescript' | 'tsx' | 'python'
 * @returns {object[]} Symbol entries
 */
export function extractSymbols(root, file, lang) {
  if (lang === 'python') return extractSymbolsPy(root, file);
  if (lang === 'java') return extractSymbolsJava(root, file);
  return extractSymbolsJS(root, file, lang);
}

/**
 * Extract all relations from a parsed AST root.
 * @param {object} root — SgNode
 * @param {string} file
 * @param {string} lang
 * @param {Map<string, string>} symbolMap — name → symbolId (local + cross-file)
 * @returns {object[]} Relation entries
 */
export function extractRelations(root, file, lang, symbolMap) {
  if (lang === 'python') return extractRelationsPy(root, file, symbolMap);
  if (lang === 'java') return extractRelationsJava(root, file, symbolMap);
  return extractRelationsJS(root, file, lang, symbolMap);
}

/**
 * Convenience: extract symbols + relations in one call.
 * Builds local symbolMap automatically from extracted symbols.
 * @param {object} root
 * @param {string} file
 * @param {string} lang
 * @param {Map<string, string>} [globalSymbolMap] — optional cross-file map
 * @returns {{ symbols: object[], relations: object[] }}
 */
export function extractAll(root, file, lang, globalSymbolMap) {
  const symbols = extractSymbols(root, file, lang);

  // Build symbol lookup: name → id (local symbols take precedence)
  const symbolMap = new Map(globalSymbolMap || []);
  for (const s of symbols) {
    symbolMap.set(s.name, s.id);
  }

  const relations = extractRelations(root, file, lang, symbolMap);

  // Add MEMBER_OF relations for methods
  for (const s of symbols) {
    if (s.parent) {
      relations.push({
        _v: 1, _type: 'relation',
        from: s.id,
        to: `${s.file}::${s.parent}`,
        kind: 'MEMBER_OF',
        line: s.line[0],
      });
    }
  }

  return { symbols, relations };
}
