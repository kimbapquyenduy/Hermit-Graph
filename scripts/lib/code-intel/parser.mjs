/**
 * AST parser wrapper — language detection + ast-grep integration.
 * Supports JS/TS/TSX built-in, Python via optional @ast-grep/lang-python.
 */

import { parse, Lang } from '@ast-grep/napi';
import { extname } from 'path';

// ── Extension → Lang mapping ──

const EXT_TO_LANG = new Map([
  ['.js', Lang.JavaScript],
  ['.mjs', Lang.JavaScript],
  ['.cjs', Lang.JavaScript],
  ['.jsx', Lang.JavaScript],
  ['.ts', Lang.TypeScript],
  ['.tsx', Lang.Tsx],
]);

// ── Optional Python support (graceful degradation) ──

let _pythonLang = null;
let _pythonChecked = false;

async function loadPython() {
  if (_pythonChecked) return _pythonLang;
  _pythonChecked = true;
  try {
    const mod = await import('@ast-grep/lang-python');
    _pythonLang = mod.default || mod.languageObject || mod;
    EXT_TO_LANG.set('.py', _pythonLang);
  } catch { /* @ast-grep/lang-python not installed — Python support disabled */ }
  return _pythonLang;
}

// Eagerly attempt Python load (non-blocking)
loadPython().catch(() => {});

// ── Public API ──

/**
 * Detect language from file extension.
 * @param {string} filePath
 * @returns {object|null} ast-grep Lang value or null if unsupported
 */
export function detectLang(filePath) {
  return EXT_TO_LANG.get(extname(filePath).toLowerCase()) ?? null;
}

/**
 * Get human-readable language name for a Lang value.
 * @param {object} lang
 * @returns {string}
 */
export function langName(lang) {
  if (lang === Lang.JavaScript) return 'javascript';
  if (lang === Lang.TypeScript) return 'typescript';
  if (lang === Lang.Tsx) return 'tsx';
  if (lang === _pythonLang && _pythonLang) return 'python';
  return 'unknown';
}

/** @returns {boolean} whether filePath is a supported code file */
export function isSupported(filePath) {
  return detectLang(filePath) !== null;
}

/** @returns {boolean} whether Python language is available */
export function hasPython() {
  return _pythonLang !== null;
}

/**
 * Parse source code into an ast-grep SgRoot.
 * Error-tolerant — returns partial tree for broken syntax.
 * @param {string} filePath — used for language detection
 * @param {string} source — file contents
 * @returns {{ root: object, lang: object, langStr: string } | null}
 */
export function parseFile(filePath, source) {
  const lang = detectLang(filePath);
  if (!lang) return null;
  try {
    const tree = parse(lang, source);
    return { root: tree.root(), lang, langStr: langName(lang) };
  } catch {
    return null; // binary or completely unparseable file
  }
}

/** Ensure Python is loaded (call before batch indexing). */
export { loadPython as ensurePythonLoaded };
