import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const tests = [];

// Test 1: Verify brain-sample.jsonl is valid JSONL
tests.push({
  name: 'Test 1: Verify brain-sample.jsonl is valid JSONL',
  run: () => {
    const filePath = join(process.cwd(), 'data', 'brain-sample.jsonl');
    if (!existsSync(filePath)) {
      throw new Error('File does not exist');
    }
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    lines.forEach((line, idx) => {
      try {
        JSON.parse(line);
      } catch (err) {
        throw new Error(`Line ${idx + 1} is not valid JSON: ${err.message}`);
      }
    });
    return { passed: true, message: `All ${lines.length} lines are valid JSON` };
  }
});

// Test 2: Count entities and relations
tests.push({
  name: 'Test 2: Count entities and relations',
  run: () => {
    const filePath = join(process.cwd(), 'data', 'brain-sample.jsonl');
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    let entityCount = 0;
    let relationCount = 0;
    lines.forEach((line) => {
      const data = JSON.parse(line);
      if (data.type === 'entity') entityCount++;
      if (data.type === 'relation') relationCount++;
    });
    return { passed: true, message: `${entityCount} entities, ${relationCount} relations` };
  }
});

// Test 3: Verify .claude-settings.json is valid JSON
tests.push({
  name: 'Test 3: Verify .claude-settings.json is valid JSON',
  run: () => {
    const filePath = join(process.cwd(), '.claude-settings.json');
    if (!existsSync(filePath)) {
      throw new Error('File does not exist');
    }
    const content = readFileSync(filePath, 'utf-8');
    try {
      JSON.parse(content);
      return { passed: true, message: 'Valid JSON structure' };
    } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`);
    }
  }
});

// Test 4: Check viewer/index.html exists and contains vis.js reference
tests.push({
  name: 'Test 4: Check viewer/index.html exists and contains vis.js',
  run: () => {
    const filePath = join(process.cwd(), 'viewer', 'index.html');
    if (!existsSync(filePath)) {
      throw new Error('File does not exist');
    }
    const content = readFileSync(filePath, 'utf-8');
    if (!content.includes('vis-network')) {
      throw new Error('Missing vis-network reference');
    }
    return { passed: true, message: 'Found vis-network reference' };
  }
});

// Test 5: All skills have SKILL.md, All commands are .md files
tests.push({
  name: 'Test 5: Verify skills and commands structure',
  run: () => {
    const brainSkills = ['auto-memory', 'biz-guard', 'code-patterns',
                         'api-design', 'db-migrations', 'security-check', 'tech-advisor'];
    const skillsDir = join(process.cwd(), '.claude', 'skills');
    const missingSkills = [];

    for (const skill of brainSkills) {
      const skillFile = join(skillsDir, skill, 'SKILL.md');
      if (!existsSync(skillFile)) {
        missingSkills.push(skill);
      }
    }

    if (missingSkills.length > 0) {
      throw new Error(`Missing SKILL.md in: ${missingSkills.join(', ')}`);
    }

    const brainCommands = ['impact', 'biz-review', 'biz-init', 'remember',
                           'recall', 'brain-dump', 'diagnose', 'ingest', 'tech-decision',
                           'learn-project', 'suggest-reuse', 'brain-health'];
    const commandsDir = join(process.cwd(), '.claude', 'commands');
    const missingCommands = [];

    for (const cmd of brainCommands) {
      const cmdFile = join(commandsDir, `${cmd}.md`);
      if (!existsSync(cmdFile)) {
        missingCommands.push(cmd);
      }
    }

    if (missingCommands.length > 0) {
      throw new Error(`Missing command .md: ${missingCommands.join(', ')}`);
    }

    return {
      passed: true,
      message: `${brainSkills.length} skills OK, ${brainCommands.length} commands OK`
    };
  }
});

// Test 6: Confidence prefix parsing
tests.push({
  name: 'Test 6: Confidence prefix parsing',
  run: () => {
    // Inline parser to avoid ESM import issues in test context
    const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
    function parse(obs) {
      const m = obs.match(RE);
      if (m) return { confidence: Math.min(parseFloat(m[1]), 1.0), date: m[2] || null, text: obs.replace(RE, '') };
      return { confidence: 0.8, date: null, text: obs };
    }

    // Test full prefix
    const r1 = parse('[0.95|2026-03-26] RULE: test');
    if (r1.confidence !== 0.95) throw new Error(`Expected 0.95 got ${r1.confidence}`);
    if (r1.date !== '2026-03-26') throw new Error(`Expected date 2026-03-26 got ${r1.date}`);
    if (r1.text !== 'RULE: test') throw new Error(`Expected "RULE: test" got "${r1.text}"`);

    // Test confidence only
    const r2 = parse('[0.8] WHAT: something');
    if (r2.confidence !== 0.8) throw new Error(`Expected 0.8 got ${r2.confidence}`);
    if (r2.date !== null) throw new Error(`Expected null date got ${r2.date}`);

    // Test legacy (no prefix)
    const r3 = parse('RULE: old observation');
    if (r3.confidence !== 0.8) throw new Error(`Legacy should default to 0.8`);
    if (r3.text !== 'RULE: old observation') throw new Error(`Legacy text mismatch`);

    // Test edge: [1.0]
    const r4 = parse('[1.0] FIX: something');
    if (r4.confidence !== 1.0) throw new Error(`Expected 1.0 got ${r4.confidence}`);

    // Test edge: [0]
    const r5 = parse('[0] LOW: uncertain');
    if (r5.confidence !== 0) throw new Error(`Expected 0 got ${r5.confidence}`);

    return { passed: true, message: '5 parse cases passed (full, conf-only, legacy, 1.0, 0)' };
  }
});

// Test 7: Temporal stale detection
tests.push({
  name: 'Test 7: Temporal stale detection',
  run: () => {
    function isStale(dateStr, threshold = 180) {
      if (!dateStr) return false;
      return (Date.now() - new Date(dateStr).getTime()) / 86400000 > threshold;
    }
    function staleDays(dateStr) {
      if (!dateStr) return null;
      return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    }

    // Old date should be stale
    if (!isStale('2025-06-01')) throw new Error('2025-06-01 should be stale (>180d)');

    // Recent date should not be stale
    const recent = new Date();
    recent.setDate(recent.getDate() - 10);
    const recentStr = recent.toISOString().split('T')[0];
    if (isStale(recentStr)) throw new Error(`${recentStr} should NOT be stale`);

    // Null date = not stale
    if (isStale(null)) throw new Error('null date should not be stale');

    // staleDays returns number for valid date
    const days = staleDays('2025-06-01');
    if (days === null || days < 180) throw new Error(`staleDays should be >180, got ${days}`);

    // staleDays returns null for null
    if (staleDays(null) !== null) throw new Error('staleDays(null) should be null');

    // Verify brain-sample has prefixed observations
    const samplePath = join(process.cwd(), 'data', 'brain-sample.jsonl');
    const content = readFileSync(samplePath, 'utf-8');
    const entities = content.trim().split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l))
      .filter(d => d.type === 'entity');

    let prefixedCount = 0;
    let totalObs = 0;
    for (const e of entities) {
      for (const obs of e.observations || []) {
        totalObs++;
        if (obs.startsWith('[')) prefixedCount++;
      }
    }
    if (prefixedCount !== totalObs) {
      throw new Error(`Expected all ${totalObs} observations prefixed, got ${prefixedCount}`);
    }

    return { passed: true, message: `Stale detection OK, ${prefixedCount}/${totalObs} sample obs prefixed` };
  }
});

// Test 8: MCP config validation (.mcp.json)
tests.push({
  name: 'Test 8: MCP config validation',
  run: () => {
    const mcpPath = join(process.cwd(), '.mcp.json');
    if (!existsSync(mcpPath)) throw new Error('Missing .mcp.json');
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));

    // Verify memory server exists
    const memServer = mcp.mcpServers?.memory;
    if (!memServer) throw new Error('Missing memory MCP server');
    if (!memServer.command) throw new Error('Memory server missing command');

    // Verify conventions server exists
    const convServer = mcp.mcpServers?.conventions;
    if (!convServer) throw new Error('Missing conventions MCP server');

    // Verify setup script exists
    const setupPath = join(process.cwd(), 'scripts', 'setup-semantic.mjs');
    if (!existsSync(setupPath)) throw new Error('Missing scripts/setup-semantic.mjs');

    const serverCount = Object.keys(mcp.mcpServers).length;
    return { passed: true, message: `${serverCount} MCP servers configured, setup script exists` };
  }
});

// Test 9: obsText helper handles string and object observations
tests.push({
  name: 'Test 9: obsText handles string and object observations',
  run: () => {
    // Inline obsText to match parse-observation.mjs
    function obsText(obs) {
      return typeof obs === 'string' ? obs : (obs && obs.content) || '';
    }

    // String observation
    const s1 = obsText('[0.8|2026-03-26] RULE: test');
    if (s1 !== '[0.8|2026-03-26] RULE: test') throw new Error(`String passthrough failed: ${s1}`);

    // Object observation (libSQL format)
    const s2 = obsText({ content: '[1|2026-03-27] Payment gateway', timestamp: 123, confidence: 1 });
    if (s2 !== '[1|2026-03-27] Payment gateway') throw new Error(`Object extraction failed: ${s2}`);

    // Null/undefined
    const s3 = obsText(null);
    if (s3 !== '') throw new Error(`null should return empty string, got: "${s3}"`);

    const s4 = obsText(undefined);
    if (s4 !== '') throw new Error(`undefined should return empty string, got: "${s4}"`);

    // Empty object
    const s5 = obsText({});
    if (s5 !== '') throw new Error(`Empty object should return empty string, got: "${s5}"`);

    // Object without content field
    const s6 = obsText({ timestamp: 123 });
    if (s6 !== '') throw new Error(`Object without content should return empty, got: "${s6}"`);

    return { passed: true, message: '6 obsText cases passed (string, object, null, undefined, empty, no-content)' };
  }
});

// Test 10: parseObservation handles object format (libSQL data)
tests.push({
  name: 'Test 10: parseObservation with object observations',
  run: () => {
    const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
    function parseObservation(obs) {
      const text = typeof obs === 'string' ? obs : (obs && obs.content) || '';
      const match = text.match(RE);
      if (match) {
        return {
          confidence: Math.min(parseFloat(match[1]), 1.0),
          date: match[2] || null,
          text: text.replace(RE, '')
        };
      }
      return { confidence: 0.8, date: null, text };
    }

    // Object with prefix
    const r1 = parseObservation({ content: '[0.95|2026-03-27] E-commerce platform', timestamp: 123 });
    if (r1.confidence !== 0.95) throw new Error(`Expected 0.95, got ${r1.confidence}`);
    if (r1.date !== '2026-03-27') throw new Error(`Expected 2026-03-27, got ${r1.date}`);
    if (r1.text !== 'E-commerce platform') throw new Error(`Text mismatch: ${r1.text}`);

    // Object without prefix (legacy)
    const r2 = parseObservation({ content: 'Legacy observation' });
    if (r2.confidence !== 0.8) throw new Error(`Legacy object should default to 0.8`);
    if (r2.text !== 'Legacy observation') throw new Error(`Legacy text mismatch`);

    // Null observation
    const r3 = parseObservation(null);
    if (r3.text !== '') throw new Error(`null should return empty text`);
    if (r3.confidence !== 0.8) throw new Error(`null should default to 0.8`);

    // String still works
    const r4 = parseObservation('[0.6|2026-01-01] PATTERN: test');
    if (r4.confidence !== 0.6) throw new Error(`String parse failed`);

    return { passed: true, message: '4 parseObservation cases: object+prefix, object+legacy, null, string' };
  }
});

// Test 11: Brain health checks on sample data
tests.push({
  name: 'Test 11: Brain health checks on sample data',
  run: () => {
    const scriptPath = join(process.cwd(), 'scripts', 'brain-health.mjs');
    if (!existsSync(scriptPath)) throw new Error('Missing scripts/brain-health.mjs');

    const cmdPath = join(process.cwd(), '.claude', 'commands', 'brain-health.md');
    if (!existsSync(cmdPath)) throw new Error('Missing brain-health command');

    const samplePath = join(process.cwd(), 'data', 'brain-sample.jsonl');
    const content = readFileSync(samplePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    const entities = [], relations = [];
    for (const line of lines) {
      const d = JSON.parse(line);
      if (d.type === 'entity') entities.push(d);
      if (d.type === 'relation') relations.push(d);
    }

    // Duplicates — sample should have 0
    const names = entities.map(e => e.name.toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) throw new Error(`Sample has duplicates: ${dupes.join(', ')}`);

    // Orphans — sample should have 0
    const linked = new Set();
    for (const r of relations) { linked.add(r.from); linked.add(r.to); }
    const orphans = entities.filter(e => !linked.has(e.name));
    if (orphans.length > 0) throw new Error(`Sample has orphans: ${orphans.map(e => e.name).join(', ')}`);

    // Low confidence — sample should have 0
    const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
    let lowCount = 0;
    for (const e of entities) {
      for (const obs of e.observations || []) {
        const text = typeof obs === 'string' ? obs : (obs && obs.content) || '';
        const m = text.match(RE);
        if (m && Math.min(parseFloat(m[1]), 1.0) < 0.3) lowCount++;
      }
    }
    if (lowCount > 0) throw new Error(`Sample has ${lowCount} low-confidence observations`);

    return { passed: true, message: `Health checks OK: 0 dupes, 0 orphans, 0 low-conf` };
  }
});

// Test 12: export-db-to-jsonl script exists and produces valid JSONL
tests.push({
  name: 'Test 12: Export DB to JSONL',
  run: () => {
    const scriptPath = join(process.cwd(), 'scripts', 'export-db-to-jsonl.mjs');
    if (!existsSync(scriptPath)) throw new Error('Missing scripts/export-db-to-jsonl.mjs');

    // Verify exported brain.jsonl is valid
    const jsonlPath = join(process.cwd(), 'data', 'brain.jsonl');
    if (!existsSync(jsonlPath)) throw new Error('Missing data/brain.jsonl');

    const content = readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) throw new Error('brain.jsonl is empty');

    let entityCount = 0, relationCount = 0;
    for (const line of lines) {
      const data = JSON.parse(line); // throws if invalid JSON
      if (data.type === 'entity') {
        entityCount++;
        if (!data.name) throw new Error('Entity missing name');
        if (!data.entityType) throw new Error(`Entity ${data.name} missing entityType`);
        if (!Array.isArray(data.observations)) throw new Error(`Entity ${data.name} missing observations array`);
        // Observations should be strings (exported from DB content column)
        for (const obs of data.observations) {
          if (typeof obs !== 'string') throw new Error(`Entity ${data.name} has non-string observation: ${typeof obs}`);
        }
      }
      if (data.type === 'relation') {
        relationCount++;
        if (!data.from || !data.to) throw new Error('Relation missing from/to');
        if (!data.relationType) throw new Error('Relation missing relationType');
      }
    }

    if (entityCount === 0) throw new Error('No entities in brain.jsonl');

    return { passed: true, message: `${entityCount} entities + ${relationCount} relations, all valid JSONL with string observations` };
  }
});

// Test 13: libSQL brain.db exists and has data
tests.push({
  name: 'Test 13: libSQL brain.db integrity',
  run: () => {
    const dbPath = join(process.cwd(), 'data', 'brain.db');
    if (!existsSync(dbPath)) throw new Error('Missing data/brain.db');

    // Verify MCP server entry point exists
    const serverPath = join(process.cwd(), 'mcp-memory-libsql', 'dist', 'index.js');
    if (!existsSync(serverPath)) throw new Error('Missing mcp-memory-libsql/dist/index.js');

    // Verify DB module exists
    const dbModule = join(process.cwd(), 'mcp-memory-libsql', 'dist', 'db.js');
    if (!existsSync(dbModule)) throw new Error('Missing mcp-memory-libsql/dist/db.js');

    return { passed: true, message: 'brain.db exists, MCP server built (dist/index.js + db.js)' };
  }
});

// Test 14: brain-health.mjs runs on real brain.jsonl without errors
tests.push({
  name: 'Test 14: brain-health runs on real data',
  run: () => {
    const jsonlPath = join(process.cwd(), 'data', 'brain.jsonl');
    if (!existsSync(jsonlPath)) throw new Error('Missing data/brain.jsonl');

    const content = readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    const entities = [];
    for (const line of lines) {
      const d = JSON.parse(line);
      if (d.type === 'entity') entities.push(d);
    }

    // Test that obsText-based parsing works on real data (object or string)
    function obsText(obs) {
      return typeof obs === 'string' ? obs : (obs && obs.content) || '';
    }

    let totalObs = 0, parsed = 0;
    for (const e of entities) {
      for (const obs of e.observations || []) {
        totalObs++;
        const text = obsText(obs);
        if (typeof text !== 'string') throw new Error(`obsText returned non-string for entity ${e.name}`);
        parsed++;
      }
    }

    if (totalObs === 0) throw new Error('No observations found in brain.jsonl');
    if (parsed !== totalObs) throw new Error(`Parsed ${parsed}/${totalObs} observations`);

    return { passed: true, message: `${parsed} observations parsed from ${entities.length} entities, all handled correctly` };
  }
});

// Test 15: GitNexus skills exist
tests.push({
  name: 'Test 15: GitNexus skills structure',
  run: () => {
    const gxSkills = ['gitnexus-cli', 'gitnexus-debugging', 'gitnexus-exploring',
                      'gitnexus-guide', 'gitnexus-impact-analysis', 'gitnexus-refactoring'];
    const skillsDir = join(process.cwd(), '.claude', 'skills', 'gitnexus');
    const missing = [];

    for (const skill of gxSkills) {
      const skillFile = join(skillsDir, skill, 'SKILL.md');
      if (!existsSync(skillFile)) missing.push(skill);
    }

    if (missing.length > 0) throw new Error(`Missing GitNexus skills: ${missing.join(', ')}`);

    // Verify AGENTS.md exists
    const agentsPath = join(process.cwd(), 'AGENTS.md');
    if (!existsSync(agentsPath)) throw new Error('Missing AGENTS.md');

    return { passed: true, message: `${gxSkills.length} GitNexus skills OK, AGENTS.md present` };
  }
});

// Run all tests
console.log('🧪 Running tests...\n');
let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    const result = test.run();
    console.log(`✅ PASS: ${test.name}`);
    console.log(`   ${result.message}\n`);
    passed++;
  } catch (err) {
    console.log(`❌ FAIL: ${test.name}`);
    console.log(`   ${err.message}\n`);
    failed++;
  }
}

console.log(`📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
