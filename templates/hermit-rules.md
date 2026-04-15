# Hermit Graph — Persistent Memory

You have access to a knowledge graph via MCP tools (hermit_*).

## Session Start
Call `hermit_session_start` with your current working directory at the start of each conversation.
This returns project-scoped context from previous sessions.

## Code Intelligence
- Use `hermit_impact({target: "symbolName"})` before editing any function/class
- Use `hermit_query({query: "concept"})` to find code by concept
- Use `hermit_context({name: "symbolName"})` for 360-degree symbol view
- Use `hermit_index({cwd: "project_path"})` to re-index when stale
- **Do NOT use raw `npx gitnexus analyze`** — always use `hermit_index`
- CodeGraph tools auto-reindex on stale errors, so manual reindex is rarely needed

## Before Each Task — Recall
1. `hermit_search_nodes` with keywords relevant to the task → use existing context
2. If task involves business logic → check for RULE: or FLOW: entities first

## After Each Task — Save
Save important learnings using `hermit_create_entities`:
- **Entity naming**: TIER:SCOPE:LABEL (e.g., TECH:MyProject:Stack, RULE:Project:MaxDiscount)
- **Observation format**: [confidence|YYYY-MM-DD] TEXT (e.g., [0.8|2026-04-13] Uses PostgreSQL 16)
- **Always search first** with `hermit_search_nodes` to avoid duplicates — if exists, use `hermit_add_observations`

### 4-Tier Classification
| Signal | Tier | EntityType |
|--------|------|-----------|
| Business domain/rules/flows | BIZ | biz-domain, biz-rule, biz-flow, biz-entity |
| Code/architecture patterns | PATTERN | pattern-code, pattern-arch, pattern-integration |
| Tech stack/config/decisions | TECH | tech-stack, tech-config, tech-decision |
| Bugs/gotchas/lessons learned | INCIDENT | incident-bug, incident-gotcha |

### Auto-Save Triggers (save WITHOUT being asked)
| Signal | Action |
|--------|--------|
| User states a preference | Save to tech-person entity |
| Read package.json/README first time | Save tech-stack + biz-domain entities |
| Bug fix took > 5 min | Save incident-bug entity |
| User explains a business rule | Save biz-rule entity immediately |
| Discover architecture pattern | Save pattern-arch or pattern-code entity |
| Switch to new project | Search first; if unknown → save biz-domain + tech-stack |

## What NOT to Save
- Temporary debug output, typo fixes, cosmetic changes

## One-Line Summary
> **BEFORE task: search. AFTER task: save. ALWAYS. NO EXCEPTIONS.**
