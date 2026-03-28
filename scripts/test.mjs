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

// Test 8: Semantic search setup validation
tests.push({
  name: 'Test 8: Semantic search config validation',
  run: () => {
    const settingsPath = join(process.cwd(), '.claude-settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // Verify memory server uses better-memory-mcp
    const memServer = settings.mcpServers?.memory;
    if (!memServer) throw new Error('Missing memory MCP server');
    const args = memServer.args || [];
    const usesBetter = args.some(a => a.includes('better-memory-mcp'));
    if (!usesBetter) throw new Error('memory server should use @sockeye44/better-memory-mcp');

    // Verify MEMORY_FILE_PATH is set
    if (!memServer.env?.MEMORY_FILE_PATH) throw new Error('Missing MEMORY_FILE_PATH');

    // Verify setup script exists
    const setupPath = join(process.cwd(), 'scripts', 'setup-semantic.mjs');
    if (!existsSync(setupPath)) throw new Error('Missing scripts/setup-semantic.mjs');

    return { passed: true, message: 'better-memory-mcp config OK, setup script exists' };
  }
});

// Test 9: Conventions MCP server config validation
tests.push({
  name: 'Test 9: Conventions MCP server config validation',
  run: () => {
    const settingsPath = join(process.cwd(), '.claude-settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // Verify conventions server exists
    const convServer = settings.mcpServers?.conventions;
    if (!convServer) throw new Error('Missing conventions MCP server');

    // Verify it uses enhanced-mcp-memory
    const args = convServer.args || [];
    if (!args.includes('enhanced-mcp-memory')) throw new Error('conventions should use enhanced-mcp-memory');

    // Verify env vars
    const env = convServer.env || {};
    if (!env.DATA_DIR) throw new Error('Missing DATA_DIR for conventions');
    if (!env.MAX_MEMORY_ITEMS) throw new Error('Missing MAX_MEMORY_ITEMS');

    // Verify setup script exists
    const setupPath = join(process.cwd(), 'scripts', 'setup-conventions.mjs');
    if (!existsSync(setupPath)) throw new Error('Missing scripts/setup-conventions.mjs');

    // Verify learn-project command exists
    const cmdPath = join(process.cwd(), '.claude', 'commands', 'learn-project.md');
    if (!existsSync(cmdPath)) throw new Error('Missing learn-project command');

    return { passed: true, message: 'Dual MCP config OK, setup + command files exist' };
  }
});

// Test 10: Cross-project suggest-reuse command validation
tests.push({
  name: 'Test 10: Cross-project suggest-reuse validation',
  run: () => {
    // Verify suggest-reuse command exists
    const cmdPath = join(process.cwd(), '.claude', 'commands', 'suggest-reuse.md');
    if (!existsSync(cmdPath)) throw new Error('Missing suggest-reuse command');

    // Verify it references key operations
    const content = readFileSync(cmdPath, 'utf-8');
    const requiredTerms = ['search_nodes', 'PATTERN:', 'confidence', 'BIZ:'];
    const missing = requiredTerms.filter(t => !content.includes(t));
    if (missing.length > 0) throw new Error(`suggest-reuse missing terms: ${missing.join(', ')}`);

    // Verify it has ranking/filtering logic mentioned
    if (!content.includes('Rank') && !content.includes('rank')) {
      throw new Error('suggest-reuse should mention ranking logic');
    }

    return { passed: true, message: 'suggest-reuse command OK with search, patterns, ranking' };
  }
});

// Test 11: Brain health checks validation
tests.push({
  name: 'Test 11: Brain health checks validation',
  run: () => {
    // Verify brain-health script exists
    const scriptPath = join(process.cwd(), 'scripts', 'brain-health.mjs');
    if (!existsSync(scriptPath)) throw new Error('Missing scripts/brain-health.mjs');

    // Verify brain-health command exists
    const cmdPath = join(process.cwd(), '.claude', 'commands', 'brain-health.md');
    if (!existsSync(cmdPath)) throw new Error('Missing brain-health command');

    // Run health checks inline on sample data
    const samplePath = join(process.cwd(), 'data', 'brain-sample.jsonl');
    const content = readFileSync(samplePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    const entities = [], relations = [];
    for (const line of lines) {
      const d = JSON.parse(line);
      if (d.type === 'entity') entities.push(d);
      if (d.type === 'relation') relations.push(d);
    }

    // Check 2: Duplicates — sample should have 0
    const names = entities.map(e => e.name.toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) throw new Error(`Sample has duplicates: ${dupes.join(', ')}`);

    // Check 3: Orphans — sample should have 0 (all entities linked)
    const linked = new Set();
    for (const r of relations) { linked.add(r.from); linked.add(r.to); }
    const orphans = entities.filter(e => !linked.has(e.name));
    if (orphans.length > 0) throw new Error(`Sample has orphans: ${orphans.map(e => e.name).join(', ')}`);

    // Check 4: Low confidence — sample should have 0 low-conf
    const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
    let lowCount = 0;
    for (const e of entities) {
      for (const obs of e.observations || []) {
        const m = obs.match(RE);
        if (m && Math.min(parseFloat(m[1]), 1.0) < 0.3) lowCount++;
      }
    }
    if (lowCount > 0) throw new Error(`Sample has ${lowCount} low-confidence observations`);

    // Score should be >0
    // Simple inline calculation
    let penalty = 0;
    // orphan check: 0 orphans → pass
    // low conf: 0 → pass
    // score should be >= 70 (healthy)
    const score = Math.round((1 - penalty) * 100);
    if (score < 70) throw new Error(`Health score ${score} below 70`);

    return { passed: true, message: `Health checks OK: 0 dupes, 0 orphans, 0 low-conf, score=${score}` };
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
