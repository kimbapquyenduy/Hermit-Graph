/**
 * Phase 01 — adaptive output budget by project size.
 *
 * Four tiers scale response caps to project size. Small projects get a
 * tighter cap (don't dump source on a 100-file repo); large projects get
 * generous defaults (their native discovery cost dwarfs a fat response).
 *
 * `includeMeta*` flags gate optional preamble/postamble sections so tiny
 * projects skip the budget reminder and "additional files" lists, saving
 * ~200 tokens per response on small repos.
 */

/**
 * @typedef {object} OutputBudget
 * @property {number} maxOutputChars     - hard cap on total response chars
 * @property {number} defaultMaxFiles    - default file count for survey tools
 * @property {number} maxCharsPerFile    - per-file slice cap
 * @property {number} gapThreshold       - merge contiguous slices < N lines apart
 * @property {number} maxSymbolsInFileHeader
 * @property {number} maxEdgesPerRelationshipKind
 * @property {boolean} includeRelationships
 * @property {boolean} includeAdditionalFiles
 * @property {boolean} includeCompletenessSignal
 * @property {boolean} includeBudgetNote
 */

/**
 * @param {number} fileCount
 * @returns {OutputBudget}
 */
export function getOutputBudget(fileCount) {
  if (fileCount < 500) {
    return {
      maxOutputChars: 18000,
      defaultMaxFiles: 5,
      maxCharsPerFile: 3800,
      gapThreshold: 8,
      maxSymbolsInFileHeader: 6,
      maxEdgesPerRelationshipKind: 6,
      includeRelationships: true,
      includeAdditionalFiles: false,
      includeCompletenessSignal: false,
      includeBudgetNote: false,
    };
  }
  if (fileCount < 5000) {
    return {
      maxOutputChars: 13000,
      defaultMaxFiles: 6,
      maxCharsPerFile: 2500,
      gapThreshold: 10,
      maxSymbolsInFileHeader: 8,
      maxEdgesPerRelationshipKind: 8,
      includeRelationships: true,
      includeAdditionalFiles: true,
      includeCompletenessSignal: true,
      includeBudgetNote: true,
    };
  }
  if (fileCount < 15000) {
    return {
      maxOutputChars: 35000,
      defaultMaxFiles: 12,
      maxCharsPerFile: 7000,
      gapThreshold: 15,
      maxSymbolsInFileHeader: 15,
      maxEdgesPerRelationshipKind: 15,
      includeRelationships: true,
      includeAdditionalFiles: true,
      includeCompletenessSignal: true,
      includeBudgetNote: true,
    };
  }
  return {
    maxOutputChars: 38000,
    defaultMaxFiles: 14,
    maxCharsPerFile: 7000,
    gapThreshold: 15,
    maxSymbolsInFileHeader: 15,
    maxEdgesPerRelationshipKind: 15,
    includeRelationships: true,
    includeAdditionalFiles: true,
    includeCompletenessSignal: true,
    includeBudgetNote: true,
  };
}

/**
 * Recommended number of explore-style calls for a project of given size.
 * Larger projects need more calls to survey their surface area.
 */
export function getExploreBudget(fileCount) {
  if (fileCount < 500) return 1;
  if (fileCount < 5000) return 2;
  if (fileCount < 15000) return 3;
  if (fileCount < 25000) return 4;
  return 5;
}
