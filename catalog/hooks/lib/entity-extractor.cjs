#!/usr/bin/env node
/**
 * entity-extractor.cjs — Regex-based entity extraction from LLM conversation text.
 *
 * Extracts tech decisions, error patterns, and explicit entity refs from assistant
 * messages. Used by kg-auto-update Stop hooks across all agents.
 *
 * Design:
 *   - Regex-only (no LLM re-parse, no dependencies)
 *   - Append-only: never overwrites existing KG entities
 *   - Low confidence (0.5): all auto-extracted, unverified
 *   - Frequency filter: noisy patterns (PascalCase, ALL_CAPS) require 3+ mentions
 *   - Max 10 entities per session (rate limit)
 */

'use strict';

const fs = require('fs');

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_ENTITIES = 10;
const MIN_FREQUENCY = 3;       // noisy patterns need 3+ mentions
const AUTO_CONFIDENCE = 0.5;   // auto-extracted, unverified
const MIN_MATCH_LENGTH = 4;    // skip very short matches

// Common English words that look like PascalCase/tech terms but aren't
const NOISE_WORDS = new Set([
  'the', 'this', 'that', 'then', 'than', 'there', 'their', 'these', 'those',
  'here', 'have', 'been', 'being', 'some', 'from', 'into', 'just', 'only',
  'also', 'each', 'done', 'does', 'made', 'make', 'like', 'after', 'before',
  'very', 'more', 'less', 'most', 'much', 'many', 'back', 'good', 'well',
  'next', 'last', 'first', 'second', 'third', 'step', 'note', 'sure',
  // PascalCase false positives from English
  'Let', 'The', 'This', 'That', 'Here', 'There', 'When', 'What', 'Where',
  'Which', 'While', 'Until', 'Since', 'After', 'Before', 'During', 'About',
  'Below', 'Above', 'Under', 'Over', 'Between', 'Through', 'Could', 'Would',
  'Should', 'Might', 'Please', 'Thanks', 'Sorry', 'Great', 'Good', 'Sure',
  'Right', 'Well', 'Just', 'Also', 'Still', 'Only', 'Even', 'Then', 'Now',
  'Yes', 'However', 'Therefore', 'Instead', 'Although', 'Because', 'Furthermore',
  // ALL_CAPS noise
  'TODO', 'NOTE', 'FIXME', 'HACK', 'INFO', 'WARN', 'DEBUG', 'TRUE', 'FALSE',
  'NULL', 'NONE', 'HTTP', 'HTTPS', 'HTML', 'JSON', 'YAML', 'TOML', 'PASS',
  'FAIL', 'DONE', 'SKIP', 'TEST', 'MUST', 'IMPORTANT', 'CRITICAL', 'HIGH',
  'MEDIUM', 'STATUS', 'ERROR', 'READ', 'WRITE', 'EDIT',
]);

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract explicit backtick-quoted entity refs (TIER:SCOPE:LABEL).
 * These are highest quality — user or assistant explicitly named them.
 * @param {string} text
 * @returns {Array<{raw: string, type: 'explicit'}>}
 */
function extractExplicitEntities(text) {
  const regex = /`((?:BIZ|TECH|PATTERN|INCIDENT|RULE|FLOW|ENTITY|DECISION|GOTCHA):[^`]+)`/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({ raw: match[1], type: 'explicit' });
  }
  return results;
}

/**
 * Extract tech decision signals (e.g., "chose PostgreSQL", "migrate to Redis").
 * @param {string} text
 * @returns {Array<{raw: string, type: 'tech-decision'}>}
 */
function extractTechDecisions(text) {
  const regex = /\b(?:use|chose|prefer|switch(?:ed)?\s+to|migrate(?:d)?\s+to|adopt(?:ed)?|implement(?:ed)?\s+with)\s+([A-Z][\w.]+(?:\s+[A-Z][\w.]+)?)/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const term = match[1].trim();
    if (term.length >= MIN_MATCH_LENGTH && !NOISE_WORDS.has(term)) {
      results.push({ raw: term, type: 'tech-decision' });
    }
  }
  return results;
}

/**
 * Extract error/bug patterns from descriptive text.
 * @param {string} text
 * @returns {Array<{raw: string, type: 'error-pattern'}>}
 */
function extractErrorPatterns(text) {
  const regex = /\b(?:error|failed|bug|issue|broken|crash|exception|timeout)\s*[:.]?\s+(.{10,80}?)(?:\.|$|\n)/gi;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const desc = match[1].trim().replace(/\s+/g, ' ');
    if (desc.length >= 10) {
      results.push({ raw: desc, type: 'error-pattern' });
    }
  }
  return results;
}

/**
 * Extract PascalCase identifiers (2+ humps = likely class/component).
 * Noisy — requires frequency filter.
 * @param {string} text
 * @returns {Array<{raw: string, type: 'pascal-case'}>}
 */
function extractPascalCase(text) {
  const regex = /\b([A-Z][a-z]+(?:[A-Z][a-z]+){1,})\b/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const term = match[1];
    if (term.length >= MIN_MATCH_LENGTH && !NOISE_WORDS.has(term)) {
      results.push({ raw: term, type: 'pascal-case' });
    }
  }
  return results;
}

/**
 * Extract ALL_CAPS constants (likely config/env keys).
 * Noisy — requires frequency filter.
 * @param {string} text
 * @returns {Array<{raw: string, type: 'all-caps'}>}
 */
function extractAllCaps(text) {
  const regex = /\b([A-Z][A-Z_]{3,})\b/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const term = match[1];
    if (!NOISE_WORDS.has(term)) {
      results.push({ raw: term, type: 'all-caps' });
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify an extraction into KG entity name + type.
 * @param {{raw: string, type: string}} extraction
 * @param {string} projectName - current project name (for entity naming)
 * @returns {{name: string, entityType: string, observation: string}}
 */
function classify(extraction, projectName) {
  const proj = projectName || 'Unknown';

  switch (extraction.type) {
    case 'explicit':
      // Already fully named — parse tier to determine entityType
      return {
        name: extraction.raw,
        entityType: guessEntityType(extraction.raw),
        observation: `Referenced in conversation`,
      };

    case 'tech-decision':
      return {
        name: `TECH:Decision:${extraction.raw}`,
        entityType: 'tech-decision',
        observation: `Decided to use ${extraction.raw}`,
      };

    case 'error-pattern':
      // Truncate to reasonable length for entity name
      const desc = extraction.raw.slice(0, 50).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-');
      return {
        name: `INCIDENT:${proj}:${desc}`,
        entityType: 'incident-bug',
        observation: extraction.raw,
      };

    case 'pascal-case':
      return {
        name: `PATTERN:${proj}:${extraction.raw}`,
        entityType: 'pattern-code',
        observation: `Component/class mentioned: ${extraction.raw}`,
      };

    case 'all-caps':
      return {
        name: `TECH:Config:${extraction.raw}`,
        entityType: 'tech-config',
        observation: `Config/env key: ${extraction.raw}`,
      };

    default:
      return null;
  }
}

/**
 * Guess entity type from a fully-qualified entity name (TIER:SCOPE:LABEL).
 * Checks both tier and scope segments (e.g., TECH:Decision:X → tech-decision).
 * @param {string} name
 * @returns {string}
 */
function guessEntityType(name) {
  const parts = name.split(':');
  const tier = (parts[0] || '').toUpperCase();
  const scope = (parts[1] || '').toUpperCase();
  const typeMap = {
    'BIZ': 'biz-domain', 'RULE': 'biz-rule', 'FLOW': 'biz-flow', 'ENTITY': 'biz-entity',
    'PATTERN': 'pattern-code', 'TECH': 'tech-stack', 'INCIDENT': 'incident-bug',
    'DECISION': 'tech-decision', 'GOTCHA': 'incident-gotcha',
  };
  // Check scope first (TECH:Decision:X → Decision → tech-decision)
  if (typeMap[scope]) return typeMap[scope];
  return typeMap[tier] || 'tech-stack';
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXTRACTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract entities from concatenated assistant message text.
 *
 * @param {string} text - concatenated assistant messages
 * @param {string} [projectName] - project name for entity naming
 * @returns {Array<{name: string, entityType: string, observations: string[]}>}
 */
function extractEntities(text, projectName) {
  if (!text || text.length < 20) return [];

  // Run all extractors
  const explicit = extractExplicitEntities(text);
  const decisions = extractTechDecisions(text);
  const errors = extractErrorPatterns(text);
  const pascal = extractPascalCase(text);
  const caps = extractAllCaps(text);

  // Count frequencies for noisy patterns
  const freqMap = {};
  for (const p of pascal) {
    freqMap[p.raw] = (freqMap[p.raw] || 0) + 1;
  }
  for (const c of caps) {
    freqMap[c.raw] = (freqMap[c.raw] || 0) + 1;
  }

  // Filter noisy patterns by frequency
  const filteredPascal = pascal.filter(p => (freqMap[p.raw] || 0) >= MIN_FREQUENCY);
  const filteredCaps = caps.filter(c => (freqMap[c.raw] || 0) >= MIN_FREQUENCY);

  // Combine all extractions (priority order: explicit > decisions > errors > pascal > caps)
  const all = [...explicit, ...decisions, ...errors, ...filteredPascal, ...filteredCaps];

  // Classify and deduplicate by entity name
  const entityMap = new Map();
  for (const extraction of all) {
    const classified = classify(extraction, projectName);
    if (!classified) continue;

    if (entityMap.has(classified.name)) {
      // Merge observations
      const existing = entityMap.get(classified.name);
      if (!existing.observations.includes(classified.observation)) {
        existing.observations.push(classified.observation);
      }
    } else {
      entityMap.set(classified.name, {
        name: classified.name,
        entityType: classified.entityType,
        observations: [classified.observation],
      });
    }
  }

  // Cap at MAX_ENTITIES
  return [...entityMap.values()].slice(0, MAX_ENTITIES);
}

/**
 * Filter out entities that already exist in brain.jsonl.
 * Only skip exact name matches (case-insensitive).
 *
 * @param {Array} entities - from extractEntities()
 * @param {string} brainPath - path to brain.jsonl
 * @returns {Array} entities not yet in KG
 */
function filterExisting(entities, brainPath) {
  if (!entities.length) return entities;  // nothing to filter — skip brain read
  if (!brainPath || !fs.existsSync(brainPath)) return entities;

  let lines;
  try { lines = fs.readFileSync(brainPath, 'utf-8').trim().split('\n'); }
  catch { return entities; }

  const existingNames = new Set();
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'entity' && obj.name) {
      existingNames.add(obj.name.toLowerCase());
    }
  }

  return entities.filter(e => !existingNames.has(e.name.toLowerCase()));
}

/**
 * Format observations with auto-extracted confidence prefix.
 * @param {string[]} observations
 * @returns {Array<{content: string, confidence: number}>}
 */
function formatObservations(observations) {
  const date = new Date().toISOString().slice(0, 10);
  return observations.map(obs => ({
    content: `[${AUTO_CONFIDENCE}|${date}] ${obs}`,
    confidence: AUTO_CONFIDENCE,
  }));
}

/**
 * Acquire a simple advisory lock file. Returns true on success, false if already locked.
 * Uses 'wx' flag (exclusive create) which is atomic on most filesystems.
 * @param {string} lockPath
 * @returns {boolean}
 */
function _acquireLock(lockPath) {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Release advisory lock file (best-effort — ignore errors if already gone).
 * @param {string} lockPath
 */
function _releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already gone — safe to ignore */ }
}

/**
 * Append new entities to brain.jsonl.
 * Acquires an advisory lock (5 retries, 200ms interval) to prevent concurrent writes
 * from MCP server and hooks corrupting the file.
 * @param {Array} entities - filtered entities (not in KG)
 * @param {string} brainPath
 * @returns {number} count of entities written (0 if lock not acquired)
 */
function appendToBrain(entities, brainPath) {
  if (!entities.length || !brainPath) return 0;

  const dir = require('path').dirname(brainPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Acquire advisory lock (same pattern as brain-io.mjs) to prevent concurrent writes
  const lockPath = brainPath + '.lock';
  const MAX_RETRIES = 5;
  const RETRY_INTERVAL_MS = 200;
  let acquired = false;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (_acquireLock(lockPath)) { acquired = true; break; }
    // Busy-wait: synchronous sleep via blocking loop (CJS context, no async available here)
    const until = Date.now() + RETRY_INTERVAL_MS;
    while (Date.now() < until) { /* spin */ }
  }
  if (!acquired) {
    // Could not acquire lock after retries — skip append to avoid corruption
    return 0;
  }

  try {
    const now = Date.now();
    const lines = entities.map(e => JSON.stringify({
      type: 'entity',
      name: e.name,
      entityType: e.entityType,
      observations: formatObservations(e.observations),
      createdAt: now,
    }));

    fs.appendFileSync(brainPath, lines.join('\n') + '\n', 'utf-8');
    return entities.length;
  } finally {
    _releaseLock(lockPath);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  extractEntities,
  filterExisting,
  formatObservations,
  appendToBrain,
  // Exposed for testing
  extractExplicitEntities,
  extractTechDecisions,
  extractErrorPatterns,
  extractPascalCase,
  extractAllCaps,
  classify,
  guessEntityType,
  // Constants
  MAX_ENTITIES,
  MIN_FREQUENCY,
  AUTO_CONFIDENCE,
};
