---
description: "Technology stack recommendations with KG-backed decision history"
tags: "tech-stack, comparison, recommendation, decision, framework"
complexity: "moderate"
requires-tools: "mcp"
---
# Tech Advisor — Technology Stack Recommendations and Comparisons

## Purpose
Provide grounded technology recommendations by combining structured pros/cons analysis with decisions already recorded in the knowledge graph, preventing repeated deliberation on settled choices.

## When to Activate
- User is choosing between frameworks, libraries, databases, or cloud services
- User asks "should we use X or Y?" or "what is the best tool for Z?"
- User is revisiting a previous technology decision

---

## Workflow

### Step 1: Search Existing Decisions and Tech Knowledge
```json
search_nodes("DECISION:")
search_nodes("TECH:")
```
If a decision for this exact topic already exists, present it immediately with its rationale before offering further analysis.

### Step 2: Gather Context

Ask (or infer from conversation) before comparing:
- **Project type**: greenfield, migration, extension of existing system?
- **Team size and experience**: how many devs, what is their background?
- **Timeline**: weeks, months, or long-term?
- **Budget constraints**: open-source only, managed services acceptable?
- **Scale requirements**: expected traffic, data volume, team growth?

### Step 3: Build Comparison Matrix

| Criterion | Option A | Option B | Option C |
|---|---|---|---|
| Learning curve | | | |
| Community / ecosystem | | | |
| Performance at target scale | | | |
| Hosting / ops complexity | | | |
| Licensing / cost | | | |
| Long-term maintenance | | | |
| Fit with existing stack | | | |

Weight criteria by the project's stated priorities before scoring.

### Step 4: Check Memory for Past Experience

```json
search_nodes("Option A name")
search_nodes("Option B name")
```

Surface any previous observations, gotchas, or integration patterns already saved for the candidate technologies.

### Step 5: Save the Decision

Once a choice is confirmed:

```json
create_entities([{
  "name": "DECISION:MentorX:VideoTranscoding",
  "entityType": "tech-decision",
  "observations": [
    "DECISION: Use BullMQ + FFmpeg over AWS Elemental MediaConvert",
    "REASON: Cost control (self-hosted), full HLS + AES-128 control, existing Redis infrastructure",
    "TRADEOFF: Ops burden for FFmpeg maintenance; no managed SLA",
    "ALTERNATIVES: AWS Elemental (expensive), Mux (simpler but vendor lock-in)",
    "DATE: 2026-03-26"
  ]
}])
```

Save rejected alternatives if they were significant contenders:

```json
create_entities([{
  "name": "TECH:Mux",
  "entityType": "tech-stack",
  "observations": [
    "Managed video processing SaaS",
    "Rejected for MentorX: cost and vendor lock-in vs self-hosted BullMQ+FFmpeg",
    "Simpler API, good DX, per-minute pricing"
  ]
}])
```

Create relations:

```json
create_relations([
  { "from": "DECISION:MentorX:VideoTranscoding", "to": "TECH:MentorX_MediaEngine", "relationType": "decided_for" },
  { "from": "TECH:Mux", "to": "TECH:MentorX_MediaEngine", "relationType": "alternative_to" }
])
```

### Step 6: Output Recommendation

Structure the response as:

```
## Recommendation: [Chosen Option]

### Rationale
[2-3 sentences on why this fits the stated constraints]

### Comparison Summary
[Filled comparison matrix from Step 3]

### Risks and Mitigations
- Risk: [description] → Mitigation: [action]

### When to Reconsider
[Conditions under which to revisit this decision, e.g., scale threshold, team growth]
```

---

## Entity Naming Reference

```
DECISION:Project:TopicName     → tech-decision (final confirmed choice)
TECH:TechnologyName            → tech-stack (tool, framework, or service)
PATTERN:ARCH:ArchName          → pattern-arch (architecture pattern adopted)
```

## Valid Relations for Decisions

| Relation | Meaning |
|---|---|
| `decided_for` | Decision chose this technology |
| `alternative_to` | This technology was considered but not chosen |
| `depends_on` | Chosen tech requires another tech to function |
| `used_in` | Technology is actively used in this project |
