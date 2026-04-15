/**
 * JS/TS symbol + relation extraction via ast-grep patterns.
 * Extracts: functions, classes, methods, constants, imports.
 * Relations: CALLS, IMPORTS, EXTENDS, MEMBER_OF.
 */

// ── Symbol extraction ──

/**
 * Extract all symbols from a JS/TS AST root.
 * @param {object} root — SgNode (ast-grep root)
 * @param {string} file — relative file path
 * @param {string} lang — 'javascript' | 'typescript' | 'tsx'
 * @returns {object[]} Symbol entries
 */
export function extractSymbolsJS(root, file, lang) {
  const symbols = [];

  // Named function declarations: function foo() {}
  for (const node of root.findAll({ rule: { kind: 'function_declaration' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    symbols.push(makeSymbol(file, name, 'function', node, lang, isExported(node)));
  }

  // Arrow / function expressions assigned to const/let/var
  for (const node of root.findAll({ rule: { kind: 'lexical_declaration' } })) {
    const declarator = node.children().find(c => c.kind() === 'variable_declarator');
    if (!declarator) continue;
    const value = declarator.field('value');
    if (!value) continue;
    const kind = value.kind();
    if (kind !== 'arrow_function' && kind !== 'function_expression') continue;
    const name = declarator.field('name')?.text();
    if (!name) continue;
    symbols.push(makeSymbol(file, name, 'function', node, lang, isExported(node)));
  }

  // Class declarations
  for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    symbols.push(makeSymbol(file, name, 'class', node, lang, isExported(node)));
    // Extract methods as MEMBER_OF
    extractMethods(node, file, name, lang, symbols);
  }

  // Exported constants (non-function): export const FOO = 'bar'
  for (const node of root.findAll({ rule: { kind: 'lexical_declaration' } })) {
    if (!isExported(node)) continue;
    const declarator = node.children().find(c => c.kind() === 'variable_declarator');
    if (!declarator) continue;
    const value = declarator.field('value');
    if (value && (value.kind() === 'arrow_function' || value.kind() === 'function_expression')) continue;
    const name = declarator.field('name')?.text();
    if (!name || name.length < 2) continue;
    symbols.push(makeSymbol(file, name, 'constant', node, lang, true));
  }

  return symbols;
}

// ── Relation extraction ──

/**
 * Extract relations from a JS/TS AST root.
 * @param {object} root
 * @param {string} file
 * @param {string} lang
 * @param {Map<string, string>} symbolMap — name → symbolId for local+imported symbols
 * @returns {object[]} Relation entries
 */
export function extractRelationsJS(root, file, lang, symbolMap) {
  const relations = [];

  // IMPORTS
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source')?.text()?.replace(/['"]/g, '');
    if (!source || !source.startsWith('.')) continue; // skip bare specifiers (npm packages)
    relations.push({ _v: 1, _type: 'relation', from: `${file}`, to: source, kind: 'IMPORTS', line: line(node) });
  }

  // CALLS — function invocations
  for (const node of root.findAll({ rule: { kind: 'call_expression' } })) {
    const callee = node.field('function');
    if (!callee) continue;
    const calleeText = callee.text();
    // Find the enclosing function to determine caller
    const caller = findEnclosingFunction(node);
    if (!caller) continue;
    const callerName = caller.name;
    const callerSymId = symbolMap.get(callerName);
    if (!callerSymId) continue;

    // Direct call: foo()
    if (callee.kind() === 'identifier') {
      const targetId = symbolMap.get(calleeText);
      if (targetId && targetId !== callerSymId) {
        relations.push({ _v: 1, _type: 'relation', from: callerSymId, to: targetId, kind: 'CALLS', line: line(node) });
      }
    }
    // Method call: obj.method() — resolve if obj is known class instance
    if (callee.kind() === 'member_expression') {
      const method = callee.field('property')?.text();
      if (method) {
        const targetId = symbolMap.get(method);
        if (targetId && targetId !== callerSymId) {
          relations.push({ _v: 1, _type: 'relation', from: callerSymId, to: targetId, kind: 'CALLS', line: line(node) });
        }
      }
    }
  }

  // EXTENDS — class inheritance
  for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
    const name = node.field('name')?.text();
    const heritage = node.children().find(c => c.kind() === 'class_heritage');
    if (!heritage || !name) continue;
    const superName = heritage.children().find(c => c.kind() === 'identifier')?.text();
    if (superName) {
      const fromId = `${file}::${name}`;
      const toId = symbolMap.get(superName) || superName;
      relations.push({ _v: 1, _type: 'relation', from: fromId, to: toId, kind: 'EXTENDS', line: line(node) });
    }
  }

  // Barrel re-exports: export { foo } from './bar'
  for (const node of root.findAll({ rule: { kind: 'export_statement' } })) {
    const source = node.field('source')?.text()?.replace(/['"]/g, '');
    if (!source || !source.startsWith('.')) continue;
    relations.push({ _v: 1, _type: 'relation', from: file, to: source, kind: 'IMPORTS', line: line(node) });
  }

  return relations;
}

// ── Helpers ──

function makeSymbol(file, name, kind, node, lang, exported) {
  const range = node.range();
  return {
    _v: 1, _type: 'symbol',
    id: `${file}::${name}`,
    kind, name, file,
    line: [range.start.line + 1, range.end.line + 1],
    exported: exported || false,
    parent: null,
    params: countParams(node),
    lang,
  };
}

function extractMethods(classNode, file, className, lang, symbols) {
  const body = classNode.field('body');
  if (!body) return;
  for (const member of body.children()) {
    if (member.kind() !== 'method_definition') continue;
    const name = member.field('name')?.text();
    if (!name || name === 'constructor') continue;
    const sym = makeSymbol(file, name, 'method', member, lang, false);
    sym.id = `${file}::${className}.${name}`;
    sym.parent = className;
    symbols.push(sym);
  }
}

function isExported(node) {
  const parent = node.parent();
  return parent?.kind() === 'export_statement';
}

function line(node) {
  return node.range().start.line + 1;
}

function countParams(node) {
  const params = node.field('parameters') || node.children().find(c => c.kind() === 'formal_parameters');
  if (!params) return 0;
  return params.children().filter(c => c.kind() !== '(' && c.kind() !== ')' && c.kind() !== ',').length;
}

/**
 * Walk up the AST to find the enclosing function/method.
 * Returns {name, id} or null if at module scope.
 */
function findEnclosingFunction(node) {
  let current = node.parent();
  while (current) {
    const kind = current.kind();
    if (kind === 'function_declaration') {
      return { name: current.field('name')?.text() };
    }
    if (kind === 'method_definition') {
      return { name: current.field('name')?.text() };
    }
    if (kind === 'variable_declarator') {
      const value = current.field('value');
      if (value && (value.kind() === 'arrow_function' || value.kind() === 'function_expression')) {
        return { name: current.field('name')?.text() };
      }
    }
    current = current.parent();
  }
  return null; // module-level call
}
