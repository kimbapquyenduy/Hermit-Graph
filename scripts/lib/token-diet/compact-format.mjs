/**
 * Compact-format helpers — reduce per-symbol token weight by ~40% via
 * abbreviated rows and grouped output. Used by codegraph-module and
 * unified-search formatters.
 *
 * Style rules:
 *  - No leading score backticks (saves ~10 chars/row)
 *  - Tag set abbreviated: 'exp' not 'exported', 'd1:N' not 'd=1:N'
 *  - File-line as plain text, not backtick-quoted
 *  - Headers use single # instead of ##/### where possible
 *  - No blank-line padding between sections (one \n separator)
 *  - Truncate to topN with "... and N more" tail when over limit
 */

/**
 * Compact single-line symbol row.
 * Before: -  `0.234` **getCurrentUser** (function) — `src/auth/user.ts:42` [exported, d=1:5]   (~90 chars)
 * After:  - getCurrentUser (function) src/auth/user.ts:42 [exp,d1:5]                            (~55 chars)
 */
export function formatSymbolCompact(s) {
  const tags = [];
  if (s.exported) tags.push('exp');
  if (typeof s._d1 === 'number') tags.push(`d1:${s._d1}`);
  const tagStr = tags.length ? ` [${tags.join(',')}]` : '';
  const line = s.line?.[0] ?? s.startLine ?? '?';
  return `- ${s.name} (${s.kind}) ${s.file}:${line}${tagStr}`;
}

/**
 * Compact caller/callee row — no kind needed (context implies it).
 * Before: - getCurrentUser (`src/auth/user.ts:42`)
 * After:  - getCurrentUser src/auth/user.ts:42
 */
export function formatRefCompact(s) {
  const line = s.line?.[0] ?? s.startLine ?? '?';
  return `- ${s.name} ${s.file}:${line}`;
}

/**
 * Truncate a list to topN with summary tail.
 * @param {Array} items
 * @param {number} topN
 * @returns {{ shown: Array, tail: string|null }}
 */
export function topNWithTail(items, topN) {
  if (items.length <= topN) return { shown: items, tail: null };
  return {
    shown: items.slice(0, topN),
    tail: `… +${items.length - topN} more`,
  };
}

/**
 * Group items by `getKey(item)`, return Map for ordered rendering.
 * Used by unified-search to group symbols by file.
 */
export function groupBy(items, getKey) {
  const m = new Map();
  for (const it of items) {
    const k = getKey(it);
    const list = m.get(k) || [];
    list.push(it);
    m.set(k, list);
  }
  return m;
}

/** Compact "file: name1:10, name2:25, name3:40" line — one line per file. */
export function formatFileSymbols(file, symbols) {
  const names = symbols.map(s => `${s.name}:${s.line?.[0] ?? s.startLine ?? '?'}`).join(', ');
  return `${file}: ${names}`;
}
