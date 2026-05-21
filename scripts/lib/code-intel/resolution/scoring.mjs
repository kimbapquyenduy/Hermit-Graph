/**
 * Phase 03 — match-scoring ladder for reference resolution.
 *
 * Returns 0-300 where higher means stronger match. Six weighted signals:
 *   +100 same file
 *   +min(sharedDirSegments * 15, 80) directory proximity
 *   +50 same language    -80 cross-language penalty (mismatches kill match)
 *   +25 type-hint match (calls→function/method, instantiates→class)
 *   +10 exported (more likely to be the canonical match)
 *   +max(0, 20 - lineDistance/10) line proximity within same file
 *
 * The scoring is heuristic — agents see the confidence and can disambiguate.
 */

const TYPE_HINT_MATCH = {
  calls: new Set(['function', 'method']),
  instantiates: new Set(['class']),
  extends: new Set(['class']),
  implements: new Set(['interface', 'class']),
  imports: new Set(['module', 'function', 'class']),
};

function sharedPathSegments(fileA, fileB) {
  if (!fileA || !fileB) return 0;
  const a = fileA.split(/[/\\]/);
  const b = fileB.split(/[/\\]/);
  let n = 0;
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) n++;
    else break;
  }
  return n;
}

/**
 * Score a candidate symbol against a reference.
 * @param {object} ref — { referenceName, referenceKind, fromFile, fromLine, fromLang }
 * @param {object} candidate — Symbol record (id, name, kind, file, line, lang, exported)
 * @returns {number} score (0-300)
 */
export function scoreCandidate(ref, candidate) {
  let score = 0;

  // Same-file proximity (huge bonus).
  if (ref.fromFile && candidate.file === ref.fromFile) {
    score += 100;
    // Line proximity within the same file — closer = stronger.
    if (typeof ref.fromLine === 'number' && Array.isArray(candidate.line)) {
      const dist = Math.abs(candidate.line[0] - ref.fromLine);
      score += Math.max(0, 20 - Math.floor(dist / 10));
    }
  } else {
    // Directory proximity (capped).
    const shared = sharedPathSegments(ref.fromFile, candidate.file);
    score += Math.min(shared * 15, 80);
  }

  // Language match — cross-language hit is almost certainly wrong.
  if (ref.fromLang && candidate.lang) {
    if (ref.fromLang === candidate.lang) score += 50;
    else score -= 80;
  }

  // Type hint: calls→function/method, instantiates→class, …
  const expectedKinds = TYPE_HINT_MATCH[ref.referenceKind];
  if (expectedKinds && expectedKinds.has(candidate.kind)) score += 25;

  // Exported symbols are more likely the canonical match.
  if (candidate.exported) score += 10;

  return score;
}

/**
 * Pick the highest-scoring candidate. Returns { candidate, confidence, ambiguous }.
 * Confidence normalizes the top score to 0.0-1.0; 0.5 is the threshold below
 * which the match is treated as low-confidence dross.
 *
 * Ambiguous = multiple candidates within 10 points of the top score.
 */
export function pickBest(ref, candidates) {
  if (!candidates.length) return { candidate: null, confidence: 0, ambiguous: false, alternatives: [] };
  const scored = candidates
    .map(c => ({ candidate: c, score: scoreCandidate(ref, c) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tieBand = scored.filter(s => s.score >= top.score - 10);
  return {
    candidate: top.candidate,
    confidence: Math.min(1, Math.max(0, top.score / 200)), // 200 = "great" match
    ambiguous: tieBand.length > 1,
    alternatives: tieBand.length > 1 ? tieBand.slice(1, 5).map(s => s.candidate) : [],
  };
}
