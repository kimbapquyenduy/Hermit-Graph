/**
 * Phase 03 — knownNames Set pre-filter.
 *
 * Pre-filters references whose name has zero candidates in the graph. The
 * cascade (framework → import → name) would waste time on those; this Set
 * gives O(1) rejection.
 *
 * Populated at index time from extracted symbols.
 */

/**
 * Build a Set of all known symbol names from a graph.
 * @param {import('../graph.mjs').CodeGraph} graph
 * @returns {Set<string>}
 */
export function buildKnownNames(graph) {
  const names = new Set();
  for (const s of graph.symbols.values()) {
    if (s.name) names.add(s.name);
    // Also index qualified Class.method forms for ClassName.methodName lookups.
    if (s.parent && s.name) names.add(`${s.parent}.${s.name}`);
  }
  return names;
}

/**
 * Built-in / host globals used as call receivers. `someSet.add(x)` must never
 * resolve to a user symbol named `add`, so any call whose receiver is one of
 * these is dropped outright.
 */
export const BUILTIN_RECEIVERS = new Set([
  'Set', 'Map', 'WeakSet', 'WeakMap', 'Array', 'Object', 'JSON', 'Math',
  'Promise', 'Date', 'String', 'Number', 'Boolean', 'RegExp', 'Error',
  'Symbol', 'Reflect', 'Proxy', 'BigInt', 'Intl', 'globalThis',
  'console', 'process', 'Buffer', 'URL', 'URLSearchParams',
  'document', 'window', 'navigator', 'localStorage', 'sessionStorage',
  // Python stdlib modules / builtins used as receivers
  'os', 'sys', 'json', 're', 'time', 'datetime', 'math', 'random', 'logging',
  'subprocess', 'shutil', 'pathlib', 'collections', 'itertools', 'functools',
  'typing', 'dict', 'list', 'tuple', 'str', 'int', 'float', 'bytes',
  // Java statics
  'System', 'Objects', 'Arrays', 'Collections', 'Optional', 'Files', 'Paths',
  'Integer', 'Long', 'Double', 'Character', 'StringBuilder', 'LocalDate',
]);

/**
 * Member names that are overwhelmingly built-in collection / promise /
 * console methods. A cross-file bare-name match on one of these is far more
 * likely to be a coincidence than a real call edge, so it needs corroborating
 * evidence (receiver is `this`, receiver matches the owning class, or the
 * candidate lives in the same file).
 *
 * Deliberately narrow: names that are commonly real domain methods (run, init,
 * close, read, write, save, load) are NOT listed — dropping those would cost
 * real edges.
 */
export const GENERIC_MEMBER_METHODS = new Set([
  // Collections
  'add', 'get', 'set', 'has', 'delete', 'clear', 'size',
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'join',
  'keys', 'values', 'entries', 'indexOf', 'lastIndexOf', 'includes',
  'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
  'sort', 'reverse', 'flat', 'flatMap', 'fill',
  // Promises
  'then', 'catch', 'finally', 'all', 'race', 'resolve', 'reject',
  // Console / logging primitives
  'log', 'warn', 'info', 'debug', 'trace',
  // Object / string / regex primitives
  'toString', 'valueOf', 'toJSON', 'hasOwnProperty',
  'trim', 'split', 'replace', 'replaceAll', 'match', 'matchAll', 'test',
  'exec', 'padStart', 'padEnd', 'startsWith', 'endsWith', 'repeat',
  'toLowerCase', 'toUpperCase', 'charAt', 'charCodeAt', 'substring', 'substr',
  // Function primitives
  'call', 'apply', 'bind',
  // Python collection / string primitives
  'append', 'extend', 'items', 'update', 'copy', 'setdefault', 'format',
  'lower', 'upper', 'strip', 'lstrip', 'rstrip', 'rsplit', 'splitlines',
  'encode', 'decode', 'count', 'insert', 'remove', 'index',
  // Java collection primitives
  'put', 'putAll', 'isEmpty', 'contains', 'containsKey', 'containsValue',
  'equals', 'hashCode', 'stream', 'collect', 'iterator', 'addAll', 'toArray',
  'println', 'printf', 'append',
]);

/**
 * Decide whether a `receiver.method()` call should produce a CALLS edge.
 *
 * The extractor resolves member calls by bare method name against a flat
 * name→id map (last writer wins), which produced edges like
 * `checkMissingRelations → McpClientPool.add` for a plain `Set.add()` call.
 * Precision matters more than recall here: a wrong edge gives wrong blast
 * radius, which is worse than a missing one.
 *
 * @param {string} receiverText - source text of the receiver expression
 * @param {string} method - member name being called
 * @param {string} targetId - resolved symbol id (`file::Parent.name`)
 * @param {string} fromFile - file containing the call
 * @returns {boolean} true when the edge is trustworthy enough to record
 */
export function shouldResolveMemberCall(receiverText, method, targetId, fromFile) {
  const receiver = String(receiverText || '');

  // Gate 1 — built-in receiver: never a user symbol.
  const rootReceiver = receiver.split(/[.[(]/)[0].trim();
  if (BUILTIN_RECEIVERS.has(rootReceiver)) return false;

  // Non-generic member name — a bare-name match is good enough evidence.
  if (!GENERIC_MEMBER_METHODS.has(method)) return true;

  // Gate 2 — generic name needs corroboration.
  const [targetFile, qualified = ''] = String(targetId).split('::');

  // Same file: the match is local, so it is very likely correct.
  if (targetFile && targetFile === fromFile) return true;

  // `this.x()` / `self.x()` inside the owning class.
  if (receiver === 'this' || receiver.startsWith('this.')) return true;
  if (receiver === 'self' || receiver.startsWith('self.')) return true;

  // Receiver names the owning class, or is a lowerCamel instance of it
  // (`ParsePool` / `parsePool` / `pool` for `ParsePool.add`).
  const parent = qualified.includes('.') ? qualified.split('.')[0] : '';
  if (parent) {
    const r = rootReceiver.toLowerCase();
    const p = parent.toLowerCase();
    if (r === p || p.endsWith(r) || r.endsWith(p)) return true;
  }

  return false;
}

/**
 * Quick check whether a reference name is known.
 * @param {Set<string>} knownNames
 * @param {string} name
 * @returns {boolean}
 */
export function isKnownName(knownNames, name) {
  if (!name) return false;
  if (knownNames.has(name)) return true;
  // Allow loose match for Class.method when only method is known (or vice versa).
  if (name.includes('.')) {
    const [, method] = name.split('.');
    if (method && knownNames.has(method)) return true;
  }
  return false;
}
