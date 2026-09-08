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
import { zBoolean } from './zod-coerce.mjs';

const RO = { readOnlyHint: true };

function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

const AI_PHASE_INSTRUCTIONS = `
## AI Phase 4-8 Instructions

Use the structured data above to execute these phases. The "Phase 4-6 File Hints" section lists candidate files detected deterministically — READ these files to extract knowledge.

### Phase 4: Code Patterns & Conventions
Read 20+ source files from the sourceFiles hint list. Detect:
- Naming convention (camelCase/snake_case/PascalCase — >80% = 0.9, 60-80% = 0.7)
- Import style (ESM/CJS/mixed, barrel exports)
- Error handling (try-catch, Result<T>, error middleware chain)
- Auth pattern (JWT/session/OAuth — where check lives)
- Component structure, state management, API call pattern

Save as: \`PATTERN:ARCH:{ProjectName}:Conventions\` (pattern-arch)

### Phase 5: Business Logic & Domain Rules
**Read files from these hint categories:** services, validators, constants, policies, testFiles, businessMd.
Extract one entity per discovered rule:

\`\`\`
RULE:{ProjectName}:{RuleName} (biz-rule) — 4 obs minimum:
  [0.8|date] RULE: {description}
  [0.8|date] CONTEXT: {when/where applies}
  [0.8|date] VIOLATION: {error msg, status code on violation}
  [0.8|date] FILES: {file:line where implemented}
\`\`\`

Extract flows:
\`\`\`
FLOW:{ProjectName}:{FlowName} (biz-flow) — 3 obs minimum:
  [0.8|date] FLOW: {step1 → step2 → step3}
  [0.8|date] TRIGGER: {what starts this flow}
  [0.8|date] SIDE_EFFECTS: {emails, notifications, webhooks}
\`\`\`

Also scan test files for behavioral specs (\`it('should...'\`), and source files for business rule comments (\`// BUSINESS RULE:\`, \`// RULE:\`, \`// CONSTRAINT:\`, \`// IMPORTANT:\`).

### Phase 5.5: Tech Decisions
Scan ADR dirs, README sections, code comments (DECISION:/WHY:/CHOSE:). Save as TECH:Decision:{ProjectName}:{Topic} (tech-decision).

### Phase 6: Integrations & Config
**Read files from hint categories:** webhooks, queues, sdkClients, envFiles.
Save as: \`PATTERN:INT:{ProjectName}:{ServiceName}\` (pattern-integration) with SERVICE, PROTOCOL, AUTH, ENDPOINTS_USED, ERROR_HANDLING observations.

### Phase 6.5: Incidents & Gotchas
Scan HACK/FIXME/WORKAROUND comments, git reverts, skipped tests. Save as INCIDENT:{ProjectName}:{BugDesc} (incident-bug).

### Phase 7: Relations
Connect ALL entities with typed relations. Zero-orphan goal. Key relation types: uses_pattern, has_entity, has_rule, has_flow, uses_tech, decided_for, found_in.

### Phase 7.5: ScanMeta Update
Save TECH:{ProjectName}:ScanMeta with LAST_SCAN, GIT_HEAD, DIR counts, entity/relation counts.

### Phase 8: Summary Report
Output coverage table for all 13 entity types. List impact-ready entities, key findings, and unresolved questions.

### Observation Format
All observations MUST use: [{confidence}|{YYYY-MM-DD}] PREFIX: content
All inferred knowledge must be saved as lifecycle=candidate in the scanned project scope; activation requires explicit review. Never append scanner inference to active reviewed knowledge.
Follow Observation Lifecycle Protocol for incremental scans (dedup by PREFIX).
`.trim();

export function register(server, ctx) {
  const { store, log } = ctx;

  server.tool(
    'hermit_deep_scan',
    'Scan project for KG knowledge. Phase 0-3 deterministic. Returns structured data for AI Phase 4-8.',
    {
      cwd: z.string().optional().describe('Project root directory to scan'),
      force: zBoolean().optional().default(false).describe('Force full rescan ignoring ScanMeta'),
    },
    RO,
    async ({ cwd, force }) => {
      const projectRoot=cwd||ctx.memoryService?.sessionRootPath||ctx.service?.sessionRootPath;
      if(!projectRoot)return fail('Explicit project cwd or started session required');
      const workDir = resolve(projectRoot);

      if (!existsSync(workDir)) {
        return fail(`Directory not found: ${workDir}`);
      }

      try {
        const result = collectScanData(workDir, {store, force});

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

        // Phase 4-6 file hints for AI
        if (result.bizHints) {
          lines.push('### Phase 4-6: File Hints for AI');
          const h = result.bizHints;
          if (h.businessMd) lines.push(`BUSINESS.md: exists (read first for Phase 5)`);
          if (h.sourceFiles.length) lines.push(`Source files (Phase 4 conventions, ${h.sourceFiles.length}): ${h.sourceFiles.slice(0, 15).join(', ')}${h.sourceFiles.length > 15 ? `, ... +${h.sourceFiles.length - 15} more` : ''}`);
          if (h.services.length) lines.push(`Service/domain files (Phase 5 rules, ${h.services.length}): ${h.services.join(', ')}`);
          if (h.validators.length) lines.push(`Validator/DTO files (Phase 5 rules, ${h.validators.length}): ${h.validators.join(', ')}`);
          if (h.constants.length) lines.push(`Constants/enum files (Phase 5, ${h.constants.length}): ${h.constants.join(', ')}`);
          if (h.policies.length) lines.push(`Policy/middleware files (Phase 5, ${h.policies.length}): ${h.policies.join(', ')}`);
          if (h.testFiles.length) lines.push(`Test files (Phase 5 behavioral specs, ${h.testFiles.length}): ${h.testFiles.slice(0, 10).join(', ')}${h.testFiles.length > 10 ? `, ... +${h.testFiles.length - 10} more` : ''}`);
          if (h.webhooks.length) lines.push(`Webhook/callback files (Phase 6, ${h.webhooks.length}): ${h.webhooks.join(', ')}`);
          if (h.queues.length) lines.push(`Queue/worker files (Phase 6, ${h.queues.length}): ${h.queues.join(', ')}`);
          if (h.sdkClients.length) lines.push(`SDK/API client files (Phase 6, ${h.sdkClients.length}): ${h.sdkClients.join(', ')}`);
          if (h.envFiles.length) lines.push(`Env files (Phase 6 cross-ref): ${h.envFiles.join(', ')}`);

          const total = h.services.length + h.validators.length + h.constants.length
            + h.policies.length + h.testFiles.length + h.webhooks.length
            + h.queues.length + h.sdkClients.length;
          if (total === 0 && !h.businessMd) {
            lines.push('No business-rule or integration files detected by pattern matching.');
            lines.push('AI should grep for: BUSINESS RULE, RULE:, CONSTRAINT:, IMPORTANT: comments in source files.');
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
