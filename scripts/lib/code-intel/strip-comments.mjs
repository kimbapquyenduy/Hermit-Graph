/**
 * Phase 01 — comment-stripping helper that preserves line offsets.
 *
 * Replaces comment ranges with spaces (not deletion) so regex `match.index`
 * still maps to the original source position. Used by framework resolvers
 * and biz-linker to avoid false positives from `// app.get('/x')` style
 * documentation examples embedded in comments.
 *
 * Per-language dispatch:
 *   js/ts: //...  /* ... *\/   (preserves regex literals + strings)
 *   py:    #...   """ ... """  ''' ... '''  (preserves strings)
 *   php:   //... #...   /* ... *\/
 *   ruby:  #...   =begin\n...\n=end
 *
 * For string preservation we don't do full lexer — we skip past strings
 * delimited by ', ", `. Edge case: escapes inside strings are honored.
 */

const LANG_JS_LIKE   = new Set(['javascript', 'typescript', 'tsx', 'js', 'ts', 'jsx']);
const LANG_PHP       = new Set(['php']);
const LANG_PY        = new Set(['python', 'py']);
const LANG_RUBY      = new Set(['ruby', 'rb']);

/**
 * Replace `start..end` substring with spaces of equal length, preserving newlines.
 */
function blankRange(src, start, end) {
  let out = '';
  for (let i = start; i < end; i++) out += src[i] === '\n' ? '\n' : ' ';
  return src.slice(0, start) + out + src.slice(end);
}

/**
 * Strip comments from source. Newlines and total character count preserved
 * so `match.index` in subsequent regexes still maps to original source.
 *
 * @param {string} source
 * @param {string} lang
 * @returns {string}
 */
export function stripCommentsForRegex(source, lang) {
  if (!source) return source;
  const l = String(lang || '').toLowerCase();
  if (LANG_JS_LIKE.has(l) || LANG_PHP.has(l)) {
    return stripCStyle(source, LANG_PHP.has(l));
  }
  if (LANG_PY.has(l)) return stripPython(source);
  if (LANG_RUBY.has(l)) return stripRuby(source);
  return source; // unknown language — pass through
}

// JS/TS/PHP: // line, /* block */, plus PHP's # line.
function stripCStyle(src, includeHashLine) {
  let out = src;
  let i = 0;
  while (i < out.length) {
    const ch = out[i];
    const next = out[i + 1];
    // Strings: skip past — comments inside strings shouldn't be touched.
    if (ch === '"' || ch === '\'' || ch === '`') {
      const closer = ch;
      let j = i + 1;
      while (j < out.length) {
        if (out[j] === '\\') { j += 2; continue; }
        if (out[j] === closer) { j++; break; }
        if (out[j] === '\n' && closer !== '`') { j++; break; } // single-line strings end at newline
        j++;
      }
      i = j;
      continue;
    }
    // Line comment //
    if (ch === '/' && next === '/') {
      let j = i;
      while (j < out.length && out[j] !== '\n') j++;
      out = blankRange(out, i, j);
      i = j;
      continue;
    }
    // PHP-only hash line comment
    if (includeHashLine && ch === '#') {
      let j = i;
      while (j < out.length && out[j] !== '\n') j++;
      out = blankRange(out, i, j);
      i = j;
      continue;
    }
    // Block /* ... */
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < out.length - 1 && !(out[j] === '*' && out[j + 1] === '/')) j++;
      const end = Math.min(out.length, j + 2);
      out = blankRange(out, i, end);
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

// Python: # line + triple-quoted "..." and '...' (treat as docstring comments
// when they are the only thing on their statement, which we approximate by
// just blanking all triple-quoted spans — preserves newlines).
function stripPython(src) {
  let out = src;
  let i = 0;
  while (i < out.length) {
    const ch = out[i];
    // Triple-quoted strings
    if ((ch === '"' || ch === '\'') && out[i + 1] === ch && out[i + 2] === ch) {
      const quote = ch.repeat(3);
      const start = i;
      let j = i + 3;
      while (j < out.length && out.slice(j, j + 3) !== quote) j++;
      const end = Math.min(out.length, j + 3);
      out = blankRange(out, start, end);
      i = end;
      continue;
    }
    // Single/double-quote strings — skip past (don't strip)
    if (ch === '"' || ch === '\'') {
      const closer = ch;
      let j = i + 1;
      while (j < out.length) {
        if (out[j] === '\\') { j += 2; continue; }
        if (out[j] === closer) { j++; break; }
        if (out[j] === '\n') { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    // # line comment
    if (ch === '#') {
      let j = i;
      while (j < out.length && out[j] !== '\n') j++;
      out = blankRange(out, i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

// Ruby: # line + =begin/=end block (must be at column 0).
function stripRuby(src) {
  let out = src;
  // =begin ... =end
  const blockRe = /(^|\n)=begin\b[\s\S]*?\n=end\b/g;
  out = out.replace(blockRe, (m) => m.replace(/[^\n]/g, ' '));
  // line comments
  let i = 0;
  while (i < out.length) {
    const ch = out[i];
    if (ch === '"' || ch === '\'') {
      const closer = ch;
      let j = i + 1;
      while (j < out.length) {
        if (out[j] === '\\') { j += 2; continue; }
        if (out[j] === closer) { j++; break; }
        if (out[j] === '\n') { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    if (ch === '#') {
      let j = i;
      while (j < out.length && out[j] !== '\n') j++;
      out = blankRange(out, i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out;
}
