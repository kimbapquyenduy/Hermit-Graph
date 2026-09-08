import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;
export const REQUIRED_ARTIFACTS = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model.onnx'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const content = entity => [entity.name, entity.entityType, ...entity.observations.filter(o => typeof o === 'string' || !o.lifecycle || o.lifecycle === 'active').map(o => typeof o === 'string' ? o : o.content)].join('\n');

// The only network-enabled boundary is an explicit installation.
const transformersEngine = {
  async install({ modelsDir }) {
    const { pipeline } = await import('@huggingface/transformers');
    const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32', local_files_only: false, cache_dir: modelsDir });
    await extractor.dispose();
  },
  async load({ modelDir }) {
    const { pipeline } = await import('@huggingface/transformers');
    const extractor = await pipeline('feature-extraction', modelDir, { dtype: 'fp32', local_files_only: true });
    return async text => (await extractor(text, { pooling: 'mean', normalize: true })).data;
  },
};

/** engine supports alternative local backends; load returns a text-to-vector function. */
export class ModelManager {
  constructor({ store, dataDir, engine = transformersEngine }) {
    if (!dataDir) throw new Error('ModelManager requires dataDir');
    this.store = store; this.engine = engine; this.modelsDir = resolve(dataDir, 'models');
    this.modelDir = join(this.modelsDir, ...MODEL_ID.split('/'));
    this.manifestPath = join(this.modelDir, 'hermit-manifest.json');
  }
  status() {
    try {
      const manifest = JSON.parse(readFileSync(this.manifestPath, 'utf8'));
      if (manifest.model !== MODEL_ID || manifest.dimension !== EMBEDDING_DIM || manifest.version !== 1) throw new Error('incompatible model manifest');
      for (const file of REQUIRED_ARTIFACTS) if (!manifest.files?.[file]) throw new Error(`missing manifest artifact: ${file}`);
      for (const [file, hash] of Object.entries(manifest.files)) {
        const path = resolve(this.modelDir, file), rel = relative(this.modelDir, path);
        if (rel.startsWith('..') || isAbsolute(rel) || !statSync(path).isFile()) throw new Error('invalid artifact path');
        const bytes = readFileSync(path);
        if (!bytes.length || sha256(bytes) !== hash) throw new Error(`artifact checksum mismatch: ${file}`);
        if (file.endsWith('.json')) JSON.parse(bytes.toString('utf8'));
      }
      return { installed: true, model: MODEL_ID, dimension: EMBEDDING_DIM, path: this.modelDir, reason: null };
    } catch (error) { return { installed: false, model: MODEL_ID, dimension: EMBEDDING_DIM, path: this.modelDir, reason: error.code === 'ENOENT' ? 'local model is not installed' : error.message }; }
  }
  async install() {
    mkdirSync(this.modelDir, { recursive: true });
    await this.engine.install({ modelDir: this.modelDir, modelsDir: this.modelsDir });
    const files = {};
    const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else if (entry.isFile() && !entry.name.startsWith('hermit-manifest.')) files[relative(this.modelDir, path).replaceAll('\\', '/')] = sha256(readFileSync(path)); } };
    walk(this.modelDir);
    for (const file of REQUIRED_ARTIFACTS) if (!files[file]) throw new Error(`installer did not produce required artifact: ${file}`);
    const tmp = this.manifestPath + '.tmp';
    writeFileSync(tmp, JSON.stringify({ version: 1, model: MODEL_ID, dimension: EMBEDDING_DIM, files }, null, 2)); renameSync(tmp, this.manifestPath);
    const result = this.status(); if (!result.installed) throw new Error(result.reason);
    this.loading = null; return result;
  }
  async embed(text) {
    this.loading ??= this.engine.load({ modelDir: this.modelDir, localFilesOnly: true });
    const fn = await this.loading, vector = Float32Array.from(await fn(text));
    if (vector.length !== EMBEDDING_DIM || !vector.every(Number.isFinite) || !vector.some(v => v !== 0)) throw new Error('invalid embedding vector');
    return vector;
  }
  ensureTable() {
    if (!this.store?.db) throw new Error('semantic retrieval requires a BrainStore');
    this.store.db.exec('CREATE TABLE IF NOT EXISTS semantic_vectors(entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,content_hash TEXT NOT NULL,model TEXT NOT NULL,dimension INTEGER NOT NULL,vector BLOB NOT NULL)');
  }
  async backfill(options = {}) {
    const status = this.status(); if (!status.installed) throw new Error(status.reason);
    this.ensureTable(); let updated = 0;
    const entities = this.store.listEntities({ ...options, lifecycles: ['active'] });
    const get = this.store.db.prepare('SELECT content_hash,model,dimension FROM semantic_vectors WHERE entity_id=?');
    const put = this.store.db.prepare('INSERT OR REPLACE INTO semantic_vectors(entity_id,content_hash,model,dimension,vector) VALUES (?,?,?,?,?)');
    for (const entity of entities) {
      const text = content(entity), hash = sha256(text), old = get.get(entity.id);
      if (old?.content_hash === hash && old.model === MODEL_ID && old.dimension === EMBEDDING_DIM) continue;
      const vector = await this.embed(text); put.run(entity.id, hash, MODEL_ID, EMBEDDING_DIM, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)); updated++;
    }
    return { total: entities.length, updated, unchanged: entities.length - updated };
  }
  async backfillAll() {
    const scopes = [null, ...this.store.listProjects().map(project => project.id)];
    const result = { total: 0, updated: 0, unchanged: 0 };
    for (const projectId of scopes) {
      const batch = await this.backfill({ projectId, includeGlobal: false });
      for (const key of Object.keys(result)) result[key] += batch[key];
    }
    return result;
  }
  async search(query, { mode = 'lexical', topK = 10, ...scope } = {}) {
    if (!['lexical', 'hybrid', 'vector'].includes(mode)) throw new Error('mode must be lexical, hybrid, or vector');
    if (!Number.isInteger(topK) || topK < 1 || topK > 1000) throw new Error('topK must be an integer between 1 and 1000');
    const lexical = () => this.store.search(query, { ...scope, topK }).slice(0, topK);
    if (mode === 'lexical') return { mode, degraded: false, reason: null, entities: lexical() };
    const status = this.status(); if (!status.installed) return { mode: 'lexical', degraded: true, reason: status.reason, entities: lexical() };
    try {
      await this.backfill(scope); const q = await this.embed(query);
      const get = this.store.db.prepare('SELECT vector FROM semantic_vectors WHERE entity_id=? AND model=? AND dimension=?');
      const entities = this.store.listEntities({ ...scope, lifecycles: ['active'] }).map(entity => {
        const row = get.get(entity.id, MODEL_ID, EMBEDDING_DIM); if (!row) return null;
        const bytes = Uint8Array.from(row.vector), v = new Float32Array(bytes.buffer);
        if (v.length !== EMBEDDING_DIM || !v.every(Number.isFinite)) throw new Error('invalid cached vector');
        let dot = 0, a = 0, b = 0; for (let i = 0; i < v.length; i++) { dot += v[i] * q[i]; a += v[i] * v[i]; b += q[i] * q[i]; }
        if (!a) throw new Error('invalid cached vector');
        return { ...entity, score: dot / Math.sqrt(a * b) };
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      if (mode === 'vector') return { mode, degraded: false, reason: null, entities: entities.slice(0, topK) };
      const ranked = new Map();
      for (const list of [entities, lexical()]) list.forEach((e, i) => { const prior = ranked.get(e.id); ranked.set(e.id, { ...e, score: (prior?.score ?? 0) + 1 / (60 + i + 1) }); });
      return { mode, degraded: false, reason: null, entities: [...ranked.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, topK) };
    } catch (error) { return { mode: 'lexical', degraded: true, reason: `local semantic search failed: ${error.message}`, entities: lexical() }; }
  }
}
