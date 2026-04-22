/**
 * Java symbol + relation extraction via ast-grep patterns.
 * Extracts: classes, interfaces, methods, constructors, fields, imports.
 * Relations: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, MEMBER_OF.
 *
 * Design notes:
 * - Methods inside classes/interfaces tagged with parent=<ClassName>, symbol id uses `file::ClassName.methodName`
 * - Fields only emitted if public/protected (private = implementation detail, not refactor surface)
 * - Generics erased for identity — `List<User>` stored as method signature length only (count of type args not tracked)
 * - Framework annotations (@Service, @Controller, @RestController) captured as `annotations: string[]` on the class symbol for downstream framework-bound detection
 */

// ── Symbol extraction ──

/**
 * Extract all Java symbols from an AST root.
 * @param {object} root — SgRoot
 * @param {string} file — project-relative path
 * @returns {object[]}
 */
export function extractSymbolsJava(root, file) {
  const symbols = [];

  // Classes (top-level + nested)
  for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    const sym = makeSymbol(file, name, 'class', node);
    sym.annotations = extractAnnotations(node);
    symbols.push(sym);
    extractMembers(node, file, name, symbols);
  }

  // Interfaces (including nested)
  for (const node of root.findAll({ rule: { kind: 'interface_declaration' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    const sym = makeSymbol(file, name, 'interface', node);
    sym.annotations = extractAnnotations(node);
    symbols.push(sym);
    extractMembers(node, file, name, symbols);
  }

  // Top-level enums (rare but valid)
  for (const node of root.findAll({ rule: { kind: 'enum_declaration' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    symbols.push(makeSymbol(file, name, 'enum', node));
  }

  return symbols;
}

// ── Relation extraction ──

export function extractRelationsJava(root, file, symbolMap) {
  const relations = [];

  // IMPORTS — `import com.foo.Bar;` or `import com.foo.*;`
  for (const node of root.findAll({ rule: { kind: 'import_declaration' } })) {
    const id = findScopedIdentifier(node);
    if (!id) continue;
    relations.push({
      _v: 1, _type: 'relation', from: file, to: id, kind: 'IMPORTS', line: line(node),
    });
  }

  // CALLS — method invocations
  for (const node of root.findAll({ rule: { kind: 'method_invocation' } })) {
    const nameNode = node.field('name');
    if (!nameNode) continue;
    const methodName = nameNode.text();
    if (!methodName) continue;

    const enclosing = findEnclosingMethod(node);
    if (!enclosing) continue;
    const callerId = symbolMap.get(enclosing.qualifiedName) || symbolMap.get(enclosing.name);
    if (!callerId) continue;

    const targetId = symbolMap.get(methodName);
    if (targetId && targetId !== callerId) {
      relations.push({
        _v: 1, _type: 'relation', from: callerId, to: targetId, kind: 'CALLS', line: line(node),
      });
    }
  }

  // EXTENDS — `class Foo extends Bar`
  for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    const superclass = node.field('superclass');
    if (!superclass) continue;
    const superType = superclass.children().find(c => c.kind() === 'type_identifier');
    const superName = superType?.text();
    if (!superName) continue;
    relations.push({
      _v: 1, _type: 'relation',
      from: `${file}::${name}`, to: symbolMap.get(superName) || superName,
      kind: 'EXTENDS', line: line(node),
    });
  }

  // IMPLEMENTS — `class Foo implements IFoo, IBar`
  for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    const ifaces = node.field('interfaces');
    if (!ifaces) continue;
    for (const t of ifaces.findAll({ rule: { kind: 'type_identifier' } })) {
      const ifaceName = t.text();
      if (!ifaceName) continue;
      relations.push({
        _v: 1, _type: 'relation',
        from: `${file}::${name}`, to: symbolMap.get(ifaceName) || ifaceName,
        kind: 'IMPLEMENTS', line: line(node),
      });
    }
  }

  // Interface inheritance — `interface Foo extends IBar`
  for (const node of root.findAll({ rule: { kind: 'interface_declaration' } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    // Interface extends uses extends_interfaces field
    const extendsNode = node.children().find(c => c.kind() === 'extends_interfaces');
    if (!extendsNode) continue;
    for (const t of extendsNode.findAll({ rule: { kind: 'type_identifier' } })) {
      const parentName = t.text();
      if (!parentName) continue;
      relations.push({
        _v: 1, _type: 'relation',
        from: `${file}::${name}`, to: symbolMap.get(parentName) || parentName,
        kind: 'EXTENDS', line: line(node),
      });
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
    exported: hasModifier(node, 'public'),
    parent: null,
    params: kind === 'class' || kind === 'interface' || kind === 'enum' ? 0 : countParams(node),
    lang: 'java',
  };
}

/** Walk class/interface body; emit methods, constructors, public/protected fields, nested types. */
function extractMembers(classNode, file, parentName, symbols) {
  const body = classNode.field('body');
  if (!body) return;

  for (const member of body.children()) {
    const kind = member.kind();

    if (kind === 'method_declaration') {
      const name = member.field('name')?.text();
      if (!name) continue;
      const sym = makeSymbol(file, name, 'method', member);
      sym.id = `${file}::${parentName}.${name}`;
      sym.parent = parentName;
      sym.annotations = extractAnnotations(member);
      symbols.push(sym);
    } else if (kind === 'constructor_declaration') {
      const name = member.field('name')?.text() || parentName;
      const sym = makeSymbol(file, name, 'constructor', member);
      sym.id = `${file}::${parentName}.<init>`;
      sym.parent = parentName;
      symbols.push(sym);
    } else if (kind === 'field_declaration') {
      if (!hasModifier(member, 'public') && !hasModifier(member, 'protected')) continue;
      // Field can declare multiple variables: `public int a, b;`
      for (const varNode of member.findAll({ rule: { kind: 'variable_declarator' } })) {
        const name = varNode.field('name')?.text();
        if (!name) continue;
        const sym = makeSymbol(file, name, 'field', member);
        sym.id = `${file}::${parentName}.${name}`;
        sym.parent = parentName;
        symbols.push(sym);
      }
    } else if (kind === 'class_declaration' || kind === 'interface_declaration' || kind === 'enum_declaration') {
      // Nested types — scope their name under outer parent for disambiguation
      const name = member.field('name')?.text();
      if (!name) continue;
      const nestedKind = kind === 'class_declaration' ? 'class'
        : kind === 'interface_declaration' ? 'interface' : 'enum';
      const sym = makeSymbol(file, `${parentName}.${name}`, nestedKind, member);
      sym.id = `${file}::${parentName}.${name}`;
      sym.parent = parentName;
      sym.annotations = extractAnnotations(member);
      symbols.push(sym);
      // Recurse — methods of nested classes still accessible
      extractMembers(member, file, `${parentName}.${name}`, symbols);
    }
  }
}

/** Extract annotation names from `modifiers` child. Returns `['Service', 'Transactional']`. */
function extractAnnotations(node) {
  const modifiers = node.children().find(c => c.kind() === 'modifiers');
  if (!modifiers) return [];
  const names = [];
  for (const ann of modifiers.children()) {
    const k = ann.kind();
    if (k === 'marker_annotation' || k === 'annotation') {
      const nameNode = ann.field('name') || ann.children().find(c => c.kind() === 'identifier');
      const name = nameNode?.text();
      if (name) names.push(name);
    }
  }
  return names;
}

/** True if `modifiers` child contains the keyword (`public`, `private`, `static`, etc.) */
function hasModifier(node, keyword) {
  const modifiers = node.children().find(c => c.kind() === 'modifiers');
  if (!modifiers) return false;
  return modifiers.children().some(c => c.kind() === keyword);
}

function countParams(node) {
  const params = node.field('parameters');
  if (!params) return 0;
  return params.children().filter(c =>
    c.kind() === 'formal_parameter' || c.kind() === 'spread_parameter'
  ).length;
}

/** Find `com.foo.Bar` scoped identifier inside an import_declaration. */
function findScopedIdentifier(node) {
  for (const child of node.children()) {
    if (child.kind() === 'scoped_identifier' || child.kind() === 'identifier') {
      return child.text();
    }
  }
  return null;
}

/**
 * Find enclosing method/constructor for a call-site. Returns method name + qualified `ClassName.methodName`.
 */
function findEnclosingMethod(node) {
  let current = node.parent();
  while (current) {
    const k = current.kind();
    if (k === 'method_declaration' || k === 'constructor_declaration') {
      const name = current.field('name')?.text();
      if (!name) return null;
      // Walk up to find enclosing class for qualified lookup
      let p = current.parent();
      while (p) {
        if (p.kind() === 'class_declaration' || p.kind() === 'interface_declaration') {
          const cls = p.field('name')?.text();
          return { name, qualifiedName: cls ? `${cls}.${name}` : name };
        }
        p = p.parent();
      }
      return { name, qualifiedName: name };
    }
    current = current.parent();
  }
  return null;
}

function line(node) {
  return node.range().start.line + 1;
}
