/**
 * MyBatis XML mapper extractor.
 *
 * Purpose: bridge Java interface methods <-> XML <select|insert|update|delete>
 * statements. Editing a Java interface method without updating the bound XML
 * id silently breaks at runtime — this extractor makes that link visible to
 * hermit's call graph.
 *
 * Detection: file is a MyBatis mapper if it contains `<mapper namespace="..."`
 * AND at least one of `<select>`, `<insert>`, `<update>`, `<delete>`.
 *
 * Symbol model (unified with Java in code-symbols.jsonl):
 *   kind='mybatis-statement', name=<id>, parent=<short class name>, file=<xml path>
 *
 * Relation model:
 *   MEMBER_OF: <mapper>.<statementId> -> <mapper>   (Java interface class)
 *   CALLS:     statement -> included fragment       (<include refid="..."/>)
 */

'use strict';

import { XMLParser } from 'fast-xml-parser';

const STATEMENT_TAGS = new Set(['select', 'insert', 'update', 'delete', 'sql']);

/**
 * Quick detector — only do full XML parse for files that look like MyBatis mappers.
 * Reads up to 2KB of content to check for namespace declaration + at least one statement tag.
 * @param {string} content — raw XML text
 * @returns {boolean}
 */
export function isMybatisMapper(content) {
  if (!content || typeof content !== 'string') return false;
  const head = content.slice(0, 2000);
  // Both signals required to reduce false positives on other <mapper> schemas
  if (!/<mapper\b[^>]*\bnamespace\s*=/.test(head)) return false;
  // Need at least one statement tag (check whole content, not just head)
  return /<(select|insert|update|delete|sql)\b/i.test(content);
}

/**
 * Parse a MyBatis mapper XML and emit symbols + relations.
 * @param {string} content — XML source
 * @param {string} file — relative path (used in symbol id + file field)
 * @returns {{ symbols: object[], relations: object[] }}
 */
export function extractMybatisMapper(content, file) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: true,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    // Security: never resolve entities (prevents XXE)
    processEntities: true,
  });

  let parsed;
  try {
    parsed = parser.parse(content);
  } catch {
    return { symbols: [], relations: [] };
  }

  // preserveOrder gives an array form: [{ mapper: [...], ':@': { '@_namespace': '...' } }]
  const mapperNode = findMapperNode(parsed);
  if (!mapperNode) return { symbols: [], relations: [] };

  const namespace = getAttr(mapperNode, 'namespace');
  if (!namespace) return { symbols: [], relations: [] };

  // Short class name (last segment of FQN: com.foo.UserMapper -> UserMapper)
  const shortName = namespace.split('.').pop();

  const symbols = [];
  const relations = [];

  // Each child of <mapper> in preserveOrder form is an object with single-key shape
  // e.g. { select: [...], ':@': { '@_id': 'findById', '@_resultType': '...' } }
  const children = mapperNode.mapper || [];
  let linesEstimated = estimateLineMap(content);

  for (const childWrapper of children) {
    const tagName = Object.keys(childWrapper).find(k => k !== ':@');
    if (!tagName || !STATEMENT_TAGS.has(tagName.toLowerCase())) continue;

    const id = getAttr(childWrapper, 'id');
    if (!id) continue;

    const line = findTagLine(linesEstimated, tagName, id) || 1;

    const sym = {
      _v: 1, _type: 'symbol',
      id: `${file}::${shortName}.${id}`,
      kind: 'mybatis-statement',
      name: id,
      file,
      line: [line, line],
      exported: true,
      parent: shortName,
      params: 0,
      lang: 'mybatis-xml',
      sqlOp: tagName.toLowerCase(),
    };
    symbols.push(sym);

    // MEMBER_OF to the Java interface class (resolved cross-language during post-link)
    relations.push({
      _v: 1, _type: 'relation',
      from: sym.id,
      to: shortName,  // symbol resolver will match this to Java interface/class symbol id
      kind: 'MEMBER_OF',
      line,
    });

    // <include refid="..."/> — extract inner references as CALLS edges
    const innerIncludes = findIncludes(childWrapper[tagName]);
    for (const refid of innerIncludes) {
      relations.push({
        _v: 1, _type: 'relation',
        from: sym.id,
        to: `${file}::${shortName}.${refid}`,
        kind: 'CALLS',
        line,
      });
    }
  }

  return { symbols, relations };
}

// ── Helpers ──

/** Locate the <mapper> root in preserveOrder parse output. */
function findMapperNode(parsed) {
  if (!Array.isArray(parsed)) return null;
  for (const node of parsed) {
    if (node && typeof node === 'object' && node.mapper) return node;
  }
  return null;
}

/** Extract attribute value from preserveOrder node (attrs live under ':@' key). */
function getAttr(node, name) {
  const attrs = node[':@'];
  if (!attrs) return null;
  return attrs[`@_${name}`] || null;
}

/**
 * Recursively find all <include refid="..."/> inside a statement body.
 * @param {Array} children — array of child nodes
 * @returns {string[]} refid values
 */
function findIncludes(children) {
  const refs = [];
  if (!Array.isArray(children)) return refs;
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const tag = Object.keys(child).find(k => k !== ':@');
    if (!tag) continue;
    if (tag === 'include') {
      const refid = getAttr(child, 'refid');
      if (refid) refs.push(refid);
    }
    // Recurse into nested tags (e.g. <where>, <if>, <foreach>)
    const inner = child[tag];
    if (Array.isArray(inner)) refs.push(...findIncludes(inner));
  }
  return refs;
}

/**
 * Build a line-number map for statement tags so we can report real line locations.
 * Simple approach: scan raw content for `<tagName id="ID"` and map to line.
 */
function estimateLineMap(content) {
  const map = new Map();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/<(select|insert|update|delete|sql)\b[^>]*\bid\s*=\s*["']([^"']+)["']/i);
    if (m) {
      map.set(`${m[1].toLowerCase()}::${m[2]}`, i + 1);
    }
  }
  return map;
}

function findTagLine(map, tagName, id) {
  return map.get(`${tagName.toLowerCase()}::${id}`);
}
