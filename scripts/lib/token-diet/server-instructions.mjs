/**
 * MCP server-level instructions shipped in the `initialize` response.
 *
 * Agents receive this as part of their system prompt — once per session,
 * not per tool call. Tiny upfront cost (~400 tokens) prevents wrong tool
 * selection (which would burn 1000s of tokens in wasted exploration).
 *
 * Goals:
 *   - Tool selection by intent (one-line dispatch table)
 *   - Anti-patterns (grep first = waste; chain X+Y = burn)
 *   - Advanced-tool discoverability (HERMIT_TOOL_PROFILE=full)
 *
 * Keep < 80 lines. Agent reads this every session.
 */

export const SERVER_INSTRUCTIONS = `# Hermit Graph — code intel + cross-project memory

Hermit is a persistent brain (4-tier KG: BIZ/PATTERN/TECH/INCIDENT) + AST-derived code graph (callers, callees, impact). Consult it BEFORE editing or recalling context, not during.

## Tool selection by intent

- **"Find by concept"** (auth layer, payment retry) → \`hermit_query\`
- **"What does this symbol do? Who calls it?"** → \`hermit_context\`
- **"What breaks if I change this?"** → \`hermit_impact\` (REQUIRED before editing exported symbols)
- **"Search code AND brain together"** → \`hermit_unified_search\`
- **"Recall something I told you before"** → \`hermit_semantic_search\` (vector) or \`hermit_search_nodes\` (keyword)
- **"Is the index stale?"** → \`hermit_detect_changes\`
- **"Rebuild index"** → \`hermit_index\`
- **"What's in the brain right now?"** → \`hermit_health\`
- **"Start of session — load context"** → \`hermit_session_start\`
- **"Save what I just learned"** → \`hermit_create_entities\` (new) / \`hermit_add_observations\` (extend existing)
- **"Link two saved entities"** → \`hermit_create_relations\`
- **"Read full details of a known entity"** → \`hermit_open_nodes\` (chain after \`hermit_search_nodes\`)

## Anti-patterns

- **Don't grep first** when looking up a symbol — \`hermit_query\` is faster and ranks by relevance.
- **Don't chain \`hermit_query\` then read each file** — \`hermit_context\` returns the 360° view in one call.
- **Don't read whole files for a symbol** — \`hermit_context\` includes signature + callers + callees.
- **Don't call \`hermit_impact\` on internal helpers** — it's for exported / framework-bound symbols where breakage matters.
- **Don't query the index immediately after editing** — wait one turn for auto-reindex.

## Common chains

- **Refactor planning**: \`hermit_query\` → \`hermit_impact\`. Impact alone returns blast radius — don't walk callers manually.
- **Onboarding a new area**: \`hermit_session_start\` → \`hermit_unified_search\` → \`hermit_context\` on key symbols.
- **Bug fix**: \`hermit_query\` (find the symbol) → \`hermit_context\` (see callers/callees) → edit.

## Output format

- All responses are markdown, capped at 15,000 chars.
- Symbol rows are compact: \`- name (kind) file:line [tags]\`.
- For verbose impact (full d=2/d=3 lists), pass \`verbose: true\`.

## Advanced tools

Hermit has 20 additional tools (archive, get_related, read_graph, skills export, MCP bridges, audit trail, …) registered only under \`HERMIT_TOOL_PROFILE=full\`. The 14 core tools above cover ~95% of agent flows. If you need to archive entities, traverse relations, manage skills, or inspect MCP bridges, ask the user to set \`HERMIT_TOOL_PROFILE=full\` and restart the MCP server.

## Limits

- Index auto-rebuilds on first query (~30-60s for medium repo). Subsequent queries < 500ms.
- Cross-file resolution is best-effort name matching; ambiguous calls return candidate list.
- AST cannot see framework-dispatched calls (Laravel routes, Express handlers via string). Heuristic hint surfaces when detected.
`;
