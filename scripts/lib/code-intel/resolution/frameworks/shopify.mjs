/**
 * Phase 04 — Shopify (Liquid) framework resolver.
 *
 * Patterns:
 *   {% render 'snippet-name' %}    → renders snippets/snippet-name.liquid
 *   {% include 'header' %}         → renders snippets/header.liquid (legacy)
 *   {% section 'name' %}           → renders sections/name.liquid
 *
 * The framework-scanner collects .liquid files via FRAMEWORK_EXTRA_EXTS;
 * extractor-liquid.mjs emits one component symbol per .liquid file. This
 * resolver then links those symbols via RENDERS edges based on template
 * directive references.
 */

import { pickBest } from '../scoring.mjs';

const RENDER_RE  = /\{%[-]?\s*render\s+['"]([\w\-./]+)['"]/;
const INCLUDE_RE = /\{%[-]?\s*include\s+['"]([\w\-./]+)['"]/;
const SECTION_RE = /\{%[-]?\s*section\s+['"]([\w\-./]+)['"]/;

export const shopifyResolver = {
  name: 'shopify',

  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    // Shopify theme markers: shopify.theme.toml OR config/settings_schema.json
    try {
      await fs.stat(`${projectRoot}/shopify.theme.toml`);
      return true;
    } catch {}
    try {
      await fs.stat(`${projectRoot}/config/settings_schema.json`);
      return true;
    } catch {}
    // Fallback: presence of sections/ + snippets/ + templates/ dirs together
    try {
      await Promise.all([
        fs.stat(`${projectRoot}/sections`),
        fs.stat(`${projectRoot}/snippets`),
      ]);
      return true;
    } catch {}
    return false;
  },

  /**
   * Live-pipeline scan: emit RENDERS for each render/include/section
   * directive that points at a known liquid file.
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const renderGlobal  = /\{%[-]?\s*render\s+['"]([\w\-./]+)['"]/g;
    const includeGlobal = /\{%[-]?\s*include\s+['"]([\w\-./]+)['"]/g;
    const sectionGlobal = /\{%[-]?\s*section\s+['"]([\w\-./]+)['"]/g;

    // The "from" of each relation is this liquid file's own component symbol.
    let fromId = file;
    for (const s of graph.symbols.values()) {
      if (s.file === file && s.kind === 'component' && s.lang === 'liquid') { fromId = s.id; break; }
    }

    const scan = (regex, expectedDir) => {
      let m;
      while ((m = regex.exec(src)) !== null) {
        const refName = m[1].split('.')[0]; // strip trailing extension if any
        const line = src.slice(0, m.index).split('\n').length;
        const key = `${expectedDir}:${refName}@${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let target = null;
        for (const s of graph.symbols.values()) {
          if (s.lang !== 'liquid') continue;
          if (s.name !== refName) continue;
          // Prefer matching directory (sections/ for {% section %}, snippets/ for {% render %})
          if (expectedDir && !s.file.includes(`${expectedDir}/`)) continue;
          target = s; break;
        }
        // Fallback: any liquid file matching the name.
        if (!target) {
          for (const s of graph.symbols.values()) {
            if (s.lang === 'liquid' && s.name === refName) { target = s; break; }
          }
        }
        if (!target) continue;
        if (fromId === target.id) continue;
        rels.push({
          _v: 1, _type: 'relation', from: fromId, to: target.id, kind: 'RENDERS', line,
          _meta: { confidence: 0.92, resolvedBy: 'framework:shopify' },
        });
      }
    };

    scan(renderGlobal,  'snippets');
    scan(includeGlobal, 'snippets');
    scan(sectionGlobal, 'sections');

    return rels;
  },

  /**
   * Cascade entry point. Resolves a single ref with contextText.
   */
  resolve(ref, ctx) {
    if (!ref.contextText) return null;
    const txt = ref.contextText;
    for (const re of [RENDER_RE, INCLUDE_RE, SECTION_RE]) {
      const m = re.exec(txt);
      if (!m) continue;
      const refName = m[1].split('.')[0];
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.lang === 'liquid' && s.name === refName) candidates.push(s);
      }
      if (!candidates.length) return null;
      const { candidate } = pickBest(ref, candidates);
      if (!candidate) return null;
      return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'renders', confidence: 0.92 };
    }
    return null;
  },
};
