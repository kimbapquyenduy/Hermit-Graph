/**
 * In-memory code graph — symbols + relations with adjacency lists.
 * Supports query (callers/callees), mutation (add/remove by file),
 * and serialization to flat JSONL entries.
 */

export class CodeGraph {
  constructor() {
    this.symbols = new Map();   // symbolId → Symbol
    this.relations = [];        // Relation[]
    this.callers = new Map();   // symbolId → Set<symbolId> (reverse/upstream)
    this.callees = new Map();   // symbolId → Set<symbolId> (forward/downstream)
    this.fileIndex = new Map(); // filePath → Set<symbolId>
    this.nameIndex = new Map(); // symbol.name → Symbol[] (lazy — see _ensureNameIndex)
    this._nameIndexBuilt = false;
    this.meta = { commit: null, files: 0, symbols: 0, relations: 0, indexedAt: null };
  }

  /**
   * Build the symbol-name index lazily on first query. Framework resolvers
   * call findByName 10000s of times during scan; pre-indexing turns each
   * lookup from O(N) symbols → O(1) average.
   */
  _ensureNameIndex() {
    if (this._nameIndexBuilt) return;
    this.nameIndex.clear();
    for (const s of this.symbols.values()) {
      const arr = this.nameIndex.get(s.name);
      if (arr) arr.push(s);
      else this.nameIndex.set(s.name, [s]);
    }
    this._nameIndexBuilt = true;
  }

  /**
   * Fast name lookup. Returns array (could be multiple symbols sharing a name).
   * O(1) average. Lazily builds the index on first call.
   * @param {string} name
   * @returns {object[]}
   */
  findByName(name) {
    this._ensureNameIndex();
    return this.nameIndex.get(name) || [];
  }

  /** Mark name index dirty so it rebuilds on next query (after mutations). */
  _invalidateNameIndex() { this._nameIndexBuilt = false; }

  /** Build graph from parsed JSONL entries. */
  static fromEntries(symbols, relations, meta) {
    const g = new CodeGraph();
    if (meta) g.meta = { ...g.meta, ...meta };
    g.addSymbols(symbols);
    g.addRelations(relations);
    return g;
  }

  // ── Mutation ──

  addSymbols(syms) {
    for (const s of syms) {
      this.symbols.set(s.id, s);
      if (!this.fileIndex.has(s.file)) this.fileIndex.set(s.file, new Set());
      this.fileIndex.get(s.file).add(s.id);
    }
    this._invalidateNameIndex();
  }

  addRelations(rels) {
    for (const r of rels) {
      this.relations.push(r);
      this._addAdjacency(r);
    }
  }

  /** Remove all symbols + relations belonging to a file (for incremental reindex). */
  removeByFile(filePath) {
    const ids = this.fileIndex.get(filePath);
    if (!ids || ids.size === 0) return;
    for (const id of ids) this.symbols.delete(id);
    // Filter relations that reference removed symbols
    this.relations = this.relations.filter(r => !ids.has(r.from) && !ids.has(r.to));
    this.fileIndex.delete(filePath);
    this._rebuildAdjacency();
    this._invalidateNameIndex();
  }

  // ── Query ──

  getSymbol(id) { return this.symbols.get(id) || null; }

  getSymbolsByFile(filePath) {
    const ids = this.fileIndex.get(filePath);
    if (!ids) return [];
    return [...ids].map(id => this.symbols.get(id)).filter(Boolean);
  }

  getSymbolsByKind(kind) {
    return [...this.symbols.values()].filter(s => s.kind === kind);
  }

  /** Find symbols whose name matches a query (case-insensitive substring). */
  searchSymbols(query) {
    const q = query.toLowerCase();
    return [...this.symbols.values()].filter(s =>
      s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    );
  }

  /** Get upstream callers of a symbol. */
  getCallers(symbolId) {
    const ids = this.callers.get(symbolId);
    if (!ids) return [];
    return [...ids].map(id => this.symbols.get(id)).filter(Boolean);
  }

  /** Get downstream callees of a symbol. */
  getCallees(symbolId) {
    const ids = this.callees.get(symbolId);
    if (!ids) return [];
    return [...ids].map(id => this.symbols.get(id)).filter(Boolean);
  }

  /** Get all relations for a symbol (both directions). */
  getRelationsFor(symbolId) {
    return this.relations.filter(r => r.from === symbolId || r.to === symbolId);
  }

  /** Get all indexed file paths. */
  getFiles() { return [...this.fileIndex.keys()]; }

  // ── Serialization ──

  /** Convert to arrays for JSONL serialization. */
  toEntries() {
    const meta = {
      ...this.meta,
      files: this.fileIndex.size,
      symbols: this.symbols.size,
      relations: this.relations.length,
      indexedAt: new Date().toISOString(),
    };
    return {
      meta,
      symbols: [...this.symbols.values()],
      relations: this.relations,
    };
  }

  // ── Internal ──

  _addAdjacency(r) {
    // Phase 03 wave 2 — RENDERS is treated as a directional usage edge:
    // a component's "callers" include the files / components that render it.
    // EXTENDS treated same way so class hierarchy flows into impact.
    if (r.kind === 'CALLS' || r.kind === 'IMPORTS' || r.kind === 'RENDERS' || r.kind === 'EXTENDS') {
      if (!this.callees.has(r.from)) this.callees.set(r.from, new Set());
      this.callees.get(r.from).add(r.to);
      if (!this.callers.has(r.to)) this.callers.set(r.to, new Set());
      this.callers.get(r.to).add(r.from);
    }
  }

  _rebuildAdjacency() {
    this.callers.clear();
    this.callees.clear();
    for (const r of this.relations) this._addAdjacency(r);
  }
}
