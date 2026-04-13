# Hermit Graph — Persistent Memory

You have access to a knowledge graph via MCP tools (hermit_*).

## Session Start
Call `hermit_session_start` with your current working directory at the start of each conversation.
This returns project-scoped context from previous sessions.

## Saving Knowledge
After completing tasks, save important learnings:
- Use `hermit_search_nodes` FIRST to check for existing entities
- Use `hermit_create_entities` to save new knowledge
- Entity naming: TIER:SCOPE:LABEL (e.g., TECH:MyProject:Stack, RULE:MyProject:MaxDiscount)
- Observation format: [confidence|YYYY-MM-DD] TEXT (e.g., [0.8|2026-04-13] Uses PostgreSQL 16)

## What to Save
- Business rules and domain knowledge
- Architecture decisions and patterns
- Tech stack details and configurations
- Bug fixes and gotchas (lessons learned)

## What NOT to Save
- Temporary debug output, typo fixes, cosmetic changes
