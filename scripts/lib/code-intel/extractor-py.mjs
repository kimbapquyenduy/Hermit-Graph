/**
 * Python symbol + relation extraction via ast-grep patterns.
 * Extracts: functions, classes, methods, imports.
 * Relations: CALLS, IMPORTS, EXTENDS, MEMBER_OF.
 */

import { shouldResolveMemberCall } from './resolution/known-names.mjs';

// ── Symbol extraction ──

/**
 * Extract all symbols from a Python AST root.
 * @param {object} root — SgNode (ast-grep root)
 * @param {string} file — relative file path
 * @returns {object[]} Symbol entries
 */
export function extractSymbolsPy(root, file) {
  const symbols = [];

  // Top-level function definitions: def foo():
  for (const node of root.findAll({ rule: { kind: 'function_definition' } })) {
    // Skip methods (inside class_definition)
    if (isInsideClass(node)) continue;
    const name = node.field('name')?.text();
    if (!name || name.startsWith('_')) continue; // skip private helpers
    symbols.push(makeSymbol(file, name, 'function', node));
  }

  // Class definitions
  for (const node of root.findAll({ rule: { kind: 'class_definition' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    symbols.push(makeSymbol(file, name, 'class', node));
    // Extract methods
    extractMethods(node, file, name, symbols);
  }

  return symbols;
}

// ── Relation extraction ──

/**
 * Extract relations from a Python AST root.
 * @param {object} root
 * @param {string} file
 * @param {Map<string, string>} symbolMap — name → symbolId
 * @returns {object[]} Relation entries
 */
export function extractRelationsPy(root, file, symbolMap) {
  const relations = [];

  // import statements: import foo, from foo import bar
  for (const node of root.findAll({ rule: { kind: 'import_from_statement' } })) {
    const modNode = node.field('module_name') || node.children().find(c => c.kind() === 'dotted_name');
    const modName = modNode?.text();
    if (!modName) continue;
    relations.push({
      _v: 1, _type: 'relation', from: file, to: modName, kind: 'IMPORTS', line: line(node),
    });
  }

  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const modNode = node.children().find(c => c.kind() === 'dotted_name');
    const modName = modNode?.text();
    if (!modName) continue;
    relations.push({
      _v: 1, _type: 'relation', from: file, to: modName, kind: 'IMPORTS', line: line(node),
    });
  }

  // CALLS — function invocations: foo(), self.method()
  for (const node of root.findAll({ rule: { kind: 'call' } })) {
    const callee = node.field('function');
    if (!callee) continue;
    const caller = findEnclosingFunction(node);
    if (!caller) continue;
    const callerSymId = symbolMap.get(caller.name);
    if (!callerSymId) continue;

    const calleeText = callee.text();
    // Direct call: foo()
    if (callee.kind() === 'identifier') {
      const targetId = symbolMap.get(calleeText);
      if (targetId && targetId !== callerSymId) {
        relations.push({ _v: 1, _type: 'relation', from: callerSymId, to: targetId, kind: 'CALLS', line: line(node) });
      }
    }
    // Method call: obj.method() — guarded so `d.get(k)` / `os.path.join(...)`
    // don't resolve to unrelated user symbols named get / join.
    if (callee.kind() === 'attribute') {
      const method = callee.field('attribute')?.text();
      if (method) {
        const targetId = symbolMap.get(method);
        const receiver = callee.field('object')?.text();
        if (targetId && targetId !== callerSymId
            && shouldResolveMemberCall(receiver, method, targetId, file)) {
          relations.push({ _v: 1, _type: 'relation', from: callerSymId, to: targetId, kind: 'CALLS', line: line(node) });
        }
      }
    }
  }

  // EXTENDS — class inheritance: class Foo(Bar):
  for (const node of root.findAll({ rule: { kind: 'class_definition' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    const superclasses = node.field('superclasses');
    if (!superclasses) continue;
    for (const arg of superclasses.children()) {
      if (arg.kind() === 'identifier') {
        const superName = arg.text();
        if (superName && superName !== 'object') {
          relations.push({
            _v: 1, _type: 'relation',
            from: `${file}::${name}`, to: symbolMap.get(superName) || superName,
            kind: 'EXTENDS', line: line(node),
          });
        }
      }
    }
  }

  return relations;
}

// ── Helpers ──

function makeSymbol(file, name, kind, node) {
  const range = node.range();
  return {
    _v: 1, _type: 'symbol',
    id: `${file}::${name}`,
    kind, name, file,
    line: [range.start.line + 1, range.end.line + 1],
    exported: !name.startsWith('_'),
    parent: null,
    params: countParams(node),
    lang: 'python',
  };
}

function extractMethods(classNode, file, className, symbols) {
  const body = classNode.field('body');
  if (!body) return;
  for (const member of body.children()) {
    if (member.kind() !== 'function_definition') continue;
    const name = member.field('name')?.text();
    if (!name || name.startsWith('__')) continue; // skip dunder methods
    const sym = makeSymbol(file, name, 'method', member);
    sym.id = `${file}::${className}.${name}`;
    sym.parent = className;
    symbols.push(sym);
  }
}

function isInsideClass(node) {
  let current = node.parent();
  while (current) {
    if (current.kind() === 'class_definition') return true;
    if (current.kind() === 'function_definition') return false; // nested function, not method
    current = current.parent();
  }
  return false;
}

function line(node) {
  return node.range().start.line + 1;
}

function countParams(node) {
  const params = node.field('parameters');
  if (!params) return 0;
  return params.children().filter(c =>
    c.kind() !== '(' && c.kind() !== ')' && c.kind() !== ','
    && c.kind() !== 'self' && c.text() !== 'self'
  ).length;
}

function findEnclosingFunction(node) {
  let current = node.parent();
  while (current) {
    if (current.kind() === 'function_definition') {
      return { name: current.field('name')?.text() };
    }
    current = current.parent();
  }
  return null;
}
