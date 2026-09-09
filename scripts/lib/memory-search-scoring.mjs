/**
 * memory-search-scoring.mjs — Exact-token relevance scoring for brain search.
 *
 * Replaces the old substring matcher (`text.includes(term)`) which made short
 * query terms like "in" / "out" / "api" match nearly every entity, producing
 * cross-project noise. Scoring here is exact-token, stopword-filtered, and
 * boosts identifier-shaped tokens (ACPS10610000, btnVerify, snake_case) which
 * carry far more signal than prose words.
 */

/**
 * Generic English + Vietnamese filler words that carry no search signal.
 * Exported so session-recall shares one stopword list instead of maintaining
 * a second, English-only one (Vietnamese fillers were matching every entity).
 */
export const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
  'by', 'from', 'as', 'into', 'out', 'up', 'down', 'over', 'under', 'through',
  'and', 'but', 'or', 'nor', 'not', 'no', 'so', 'if', 'then', 'than', 'that',
  'this', 'these', 'those', 'it', 'its', 'we', 'you', 'they', 'them', 'their',
  'all', 'any', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'too', 'very', 'just', 'about', 'also', 'only', 'here', 'there',
  'what', 'which', 'when', 'where', 'why', 'how', 'who',
  // Vietnamese
  'và', 'là', 'của', 'có', 'không', 'được', 'cho', 'với', 'này', 'đó', 'các',
  'những', 'một', 'khi', 'thì', 'mà', 'nên', 'đã', 'sẽ', 'đang', 'bị', 'bởi',
  'từ', 'đến', 'trong', 'ngoài', 'trên', 'dưới', 'vào', 'ra', 'rồi', 'nữa',
  'cũng', 'vẫn', 'còn', 'phải', 'nếu', 'vì', 'nhưng', 'hoặc', 'theo', 'về',
  'tại', 'sau', 'trước', 'giữa', 'cùng', 'như', 'rất', 'quá', 'hơn', 'nhất',
  'bạn', 'tôi', 'mình', 'chúng', 'họ', 'ai', 'gì', 'sao', 'đâu', 'nào',
]);

/** Minimum length for a plain prose token to count. */
const MIN_TOKEN_LEN = 3;

/** Weight multiplier applied to identifier-shaped tokens. */
const IDENTIFIER_BOOST = 2;

/** Points for a query token found in the entity name / entityType. */
const NAME_HIT = 5;

/** Points for a query token found only in observations. */
const OBS_HIT = 2;

/**
 * Identifier-shaped tokens (screen codes, symbol names, table names) are the
 * high-signal part of a query. Detected on the ORIGINAL casing, before
 * lowercasing, so camelCase / PascalCase survive.
 * @param {string} raw
 * @returns {boolean}
 */
export function isIdentifierToken(raw) {
  if (raw.length < 3) return false;
  if (/\d{3,}/.test(raw)) return true;                     // ACPS10610000
  if (/_/.test(raw)) return true;                          // MEMB_SLIP_NO
  if (/[a-z]/.test(raw) && /[A-Z]/.test(raw)) return true; // btnVerify, SaveDataMaster
  if (/^[A-Z]{3,}$/.test(raw)) return true;                // SAP, TVP
  return false;
}

/** Split text into raw tokens on non-alphanumeric boundaries (Unicode-aware). */
function rawTokens(text) {
  return String(text).split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}

/**
 * Entity names glue words together (ACPS10610000SaveMissingLoadingIndicator),
 * so a whole-token match would never fire. Expand each raw token into the full
 * token plus its camelCase / digit-boundary / underscore parts, and index all
 * of them. Query tokens get the same treatment, so "ACPS10610000" matches the
 * glued name via its "acps" + "10610000" parts.
 * @param {string} raw
 * @returns {string[]} raw token first, then its parts
 */
function expandToken(raw) {
  const parts = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean);
  return parts.length > 1 ? [raw, ...parts] : [raw];
}

/**
 * Tokenize free text into a Set of normalized (lowercased) tokens.
 * Drops stopwords and short prose words, but always keeps identifier-shaped
 * tokens regardless of length rules.
 * @param {string} text
 * @returns {Set<string>}
 */
export function tokenize(text) {
  const out = new Set();
  for (const rawWord of rawTokens(text)) {
    for (const raw of expandToken(rawWord)) {
      const norm = raw.toLowerCase();
      if (STOP_WORDS.has(norm)) continue;
      if (!isIdentifierToken(raw) && norm.length < MIN_TOKEN_LEN) continue;
      out.add(norm);
    }
  }
  return out;
}

/**
 * Tokenize a query into weighted terms. Identifier-shaped terms weigh more.
 * @param {string} query
 * @returns {Array<{token: string, weight: number}>}
 */
export function tokenizeQuery(query) {
  const seen = new Set();
  const terms = [];
  for (const rawWord of rawTokens(query)) {
    // Parts of an identifier inherit the boost — "acps" out of "ACPS10610000"
    // is still a high-signal token even though it looks like a plain word.
    const parentIdent = isIdentifierToken(rawWord);
    for (const raw of expandToken(rawWord)) {
      const norm = raw.toLowerCase();
      if (STOP_WORDS.has(norm)) continue;
      const ident = parentIdent || isIdentifierToken(raw);
      if (!ident && norm.length < MIN_TOKEN_LEN) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      terms.push({ token: norm, weight: ident ? IDENTIFIER_BOOST : 1 });
    }
  }
  return terms;
}

/**
 * Build the searchable token sets for one entity. Name tokens score higher
 * than observation tokens.
 * @param {object} entity
 * @param {(obs: any) => string} obsToText - extractor for observation text
 * @returns {{ nameTokens: Set<string>, obsTokens: Set<string> }}
 */
export function entityTokens(entity, obsToText) {
  const nameTokens = tokenize([entity.name || '', entity.entityType || ''].join(' '));
  const obsTokens = new Set();
  for (const obs of entity.observations || []) {
    for (const t of tokenize(obsToText(obs))) obsTokens.add(t);
  }
  return { nameTokens, obsTokens };
}

/**
 * Score one entity against pre-tokenized query terms.
 * @param {Array<{token: string, weight: number}>} terms
 * @param {object} entity
 * @param {(obs: any) => string} obsToText
 * @returns {{ score: number, matched: string[] }} score normalized to 0..1
 */
export function scoreEntity(terms, entity, obsToText) {
  if (!terms.length) return { score: 0, matched: [] };
  const { nameTokens, obsTokens } = entityTokens(entity, obsToText);
  let total = 0;
  let max = 0;
  const matched = [];
  for (const { token, weight } of terms) {
    max += weight * NAME_HIT;
    if (nameTokens.has(token)) { total += weight * NAME_HIT; matched.push(token); }
    else if (obsTokens.has(token)) { total += weight * OBS_HIT; matched.push(token); }
  }
  return { score: max ? total / max : 0, matched };
}
