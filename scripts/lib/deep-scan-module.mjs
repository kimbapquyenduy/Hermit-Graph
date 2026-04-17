/**
 * deep-scan-module.mjs — MCP tool for deterministic project scanning.
 *
 * Tool: hermit_deep_scan
 * Runs Phase 0-3 deterministic collection, returns structured data
 * for AI agents to execute Phase 4-8 (reasoning-dependent phases).
 */

import { z } from 'zod';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { collectScanData } from './deep-scan-collector.mjs';

const RO = { readOnlyHint: true };

function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

const AI_PHASE_INSTRUCTIONS = `
## AI Phase 4-8 Instructions

Use the structured data above to execute these phases. Follow the deep-scan command protocol for entity naming and observation format.

### Phase 4: Code Patterns & Conventions
Scan 20+ source files for: naming convention, import style, error handling, auth pattern, component structure, state management, API call pattern. Save as PATTERN:ARCH:{ProjectName}:Conventions (pattern-arch) + individual PATTERN:{ProjectName}:{PatternName} (pattern-code) entities.

### Phase 5: Business Logic & Domain Rules
Read key source files identified in architecture. Extract business rules, validation logic, state machines, domain flows. Save as RULE:{ProjectName}:{RuleName} (biz-rule), FLOW:{ProjectName}:{FlowName} (biz-flow), ENTITY:{ProjectName}:{EntityName} (biz-entity).

### Phase 5.5: Tech Decisions
Scan ADR dirs, README sections, code comments (DECISION:/WHY:/CHOSE:), config migrations. Save as TECH:Decision:{ProjectName}:{Topic} (tech-decision).

### Phase 6: Integrations & Config
Scan external service configs, SDK inits, webhook handlers, queue consumers. Save as PATTERN:INT:{ProjectName}:{ServiceName} (pattern-integration) + TECH:{ProjectName}:Config:{ConfigArea} (tech-config).

### Phase 6.5: Incidents & Gotchas
Scan HACK/FIXME/WORKAROUND comments, git reverts, skipped tests, changelog. Save as INCIDENT:{ProjectName}:{BugDesc} (incident-bug) + GOTCHA:{ProjectName}:{Description} (incident-gotcha).

### Phase 7: Relations (40+ types, zero-orphan goal)
Connect ALL entities with typed relations. Categories: BIZ hub, business logic, code patterns, tech decisions, tech config, integrations, incidents, people, data corpus, architecture internal.

### Phase 7.5: ScanMeta Update
Save TECH:{ProjectName}:ScanMeta with LAST_SCAN, GIT_HEAD, DIR counts, phase list, entity/relation counts.

### Phase 8: Summary Report
Output coverage table for all 13 entity types. List impact-ready entities and unresolved questions.

### Observation Format
All observations MUST use: [{confidence}|{YYYY-MM-DD}] PREFIX: content
Follow the Observation Lifecycle Protocol for incremental scans.
`.trim();

export function register(server, ctx) {
  const { brainPath, log } = ctx;

  server.tool(
    'hermit_deep_scan',
    'Scan project for KG knowledge. Phase 0-3 deterministic. Returns structured data for AI Phase 4-8.',
    {
      cwd: z.string().optional().describe('Project root directory to scan'),
      force: z.boolean().optional().default(false).describe('Force full rescan ignoring ScanMeta'),
    },
    RO,
    async ({ cwd, force }) => {
      const workDir = cwd ? resolve(cwd) : process.cwd();

      if (!existsSync(workDir)) {
        return fail(`Directory not found: ${workDir}`);
      }

      try {
        const result = collectScanData(workDir, brainPath, { force });

        if (result.scanType === 'no-changes') {
          return ok([
            `## Deep Scan: No Changes`,
            `Project: ${result.projectName}`,
            `Last scan: ${result.lastScan}`,
            `No changes detected since last scan. Use force=true for full rescan.`,
          ].join('\n'));
        }

        // Build structured response
        const lines = [
          `## Deep Scan: ${result.scanType} scan`,
          `Project: ${result.projectName}`,
          `AI Phases to run: ${result.phasesToRun.join(', ')}`,
          '',
        ];

        if (result.identity) {
          lines.push('### Phase 1: Project Identity');
          lines.push('```json');
          lines.push(JSON.stringify(result.identity, null, 2));
          lines.push('```');
          lines.push('');
        }

        if (result.dataOutput) {
          lines.push('### Phase 1.5: Data Output');
          lines.push(`Directories: ${result.dataOutput.dirs.map(d => `${d.name} (${d.fileCount} files, ${d.dominantExt})`).join(', ')}`);
          if (result.dataOutput.samples.length) {
            lines.push(`Samples: ${result.dataOutput.samples.length} files sampled`);
            for (const s of result.dataOutput.samples.slice(0, 5)) {
              lines.push(`  - ${s.dir}/${s.file} (${s.lines} lines)`);
            }
          }
          lines.push('');
        }

        if (result.architecture) {
          lines.push('### Phase 2: Architecture');
          lines.push(`Entry points: ${result.architecture.entryPoints.join(', ') || 'none detected'}`);
          lines.push(`Config files: ${result.architecture.configFiles.join(', ') || 'none'}`);
          lines.push(`Routing dirs: ${result.architecture.routingDirs.join(', ') || 'none'}`);
          lines.push(`Directory structure (${result.architecture.dirs.length} dirs):`);
          for (const d of result.architecture.dirs.slice(0, 30)) {
            lines.push(`  ${d}`);
          }
          lines.push('');
        }

        if (result.apiSurface) {
          lines.push('### Phase 3: API Surface');
          lines.push(`Routes: ${result.apiSurface.routes.length} endpoints detected`);
          for (const r of result.apiSurface.routes.slice(0, 30)) {
            lines.push(`  ${r.method} ${r.path} (${r.file})`);
          }
          if (result.apiSurface.models.length) {
            lines.push(`Models: ${result.apiSurface.models.length}`);
            for (const m of result.apiSurface.models.slice(0, 15)) {
              lines.push(`  ${m.name} (${m.file})`);
            }
          }
          if (result.apiSurface.schemas.length) {
            lines.push(`Schema files: ${result.apiSurface.schemas.join(', ')}`);
          }
          lines.push('');
        }

        lines.push('---');
        lines.push('');
        lines.push(AI_PHASE_INSTRUCTIONS);

        return ok(lines.join('\n'));
      } catch (err) {
        return fail(`Scan failed: ${err.message}`);
      }
    }
  );

  log('deep-scan-module: 1 tool registered');
}
