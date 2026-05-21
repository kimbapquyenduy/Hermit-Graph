/**
 * AST parser wrapper — language detection + ast-grep integration.
 * Supports JS/TS/TSX built-in, Python and Java via optional @ast-grep/lang-*.
 *
 * Java uses the dynamic-language registration path (`registerDynamicLanguage`
 * + string key like 'java' to `parse()`). Python uses the legacy language-
 * object path for backward compat with @ast-grep/lang-python@0.0.6.
 */

import { parse, Lang, registerDynamicLanguage } from '@ast-grep/napi';
import { extname } from 'path';

// ── Extension → Lang mapping ──
// Value is either Lang enum (JS/TS), language object (Python), or a string
// key for dynamically-registered languages (Java).
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
let _pythonLoadPromise = null;

async function loadPython() {
  if (_pythonLoadPromise) return _pythonLoadPromise;
  _pythonLoadPromise = (async () => {
    try {
      const mod = await import('@ast-grep/lang-python');
      _pythonLang = mod.default || mod.languageObject || mod;
      EXT_TO_LANG.set('.py', _pythonLang);
    } catch { /* @ast-grep/lang-python not installed — Python support disabled */ }
    return _pythonLang;
  })();
  return _pythonLoadPromise;
}

// ── Optional Java support (dynamic-language registration) ──

let _javaReady = false;
let _javaLoadPromise = null;

async function loadJava() {
  // Dedup concurrent callers — return the in-flight promise so both await the same resolution
  if (_javaLoadPromise) return _javaLoadPromise;
  _javaLoadPromise = (async () => {
    try {
      const mod = await import('@ast-grep/lang-java');
      const langJava = mod.default || mod;
      registerDynamicLanguage({ java: langJava });
      EXT_TO_LANG.set('.java', 'java');
      _javaReady = true;
    } catch (err) {
      if (process.env.HERMIT_DEBUG) {
        process.stderr.write(`[parser] Java load failed: ${err.message}\n`);
      }
    }
    return _javaReady;
  })();
  return _javaLoadPromise;
}

// Eagerly attempt optional language loads (non-blocking)
loadPython().catch(() => {});
loadJava().catch(() => {});

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
  if (lang === 'java') return 'java';
  return 'unknown';
}

/** @returns {boolean} whether filePath is a supported code file */
export function isSupported(filePath) {
  if (detectLang(filePath) !== null) return true;
  const ext = extname(filePath).toLowerCase();
  // XML files handled by non-AST extractors (e.g. MyBatis mapper) — indexer
  // inspects content to decide whether to process them, not this predicate.
  // .vue files handled by SFC extractor (extractor-vue-sfc.mjs).
  return ext === '.xml' || ext === '.vue' || ext === '.svelte';
}

/** @returns {boolean} whether Python language is available */
export function hasPython() {
  return _pythonLang !== null;
}

/** @returns {boolean} whether Java language is available */
export function hasJava() {
  return _javaReady;
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

/** Ensure Java is loaded (call before batch indexing). */
export { loadJava as ensureJavaLoaded };
