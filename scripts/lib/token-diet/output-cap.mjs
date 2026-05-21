/**
 * Universal output cap — hard limit on tool response size to bound worst-case
 * token cost. Tools that exceed get clean-newline truncation + marker.
 *
 * 15000-char cap balances detail vs context cost.
 */

export const MAX_OUTPUT_CHARS = 15000;

/**
 * Truncate text at MAX_OUTPUT_CHARS, cutting on last newline within the
 * final 20% to avoid mid-line cuts. Appends a marker explaining truncation.
 *
 * @param {string} text
 * @param {number} [maxChars=MAX_OUTPUT_CHARS]
 * @returns {string}
 */
export function truncateOutput(text, maxChars = MAX_OUTPUT_CHARS) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastNewline = cut.lastIndexOf('\n');
  // Only cut at newline if it's within the final 20% — otherwise we'd waste
  // too much output.
  const safe = lastNewline > maxChars * 0.8 ? cut.slice(0, lastNewline) : cut;
  return safe + `\n\n… (truncated at ${maxChars} chars; refine query for tighter result)`;
}
