# Code Patterns — Detect, Save, and Recall Coding Patterns

## Purpose
Identify reusable coding patterns from the codebase, persist them to the knowledge graph, and surface them on demand to prevent reinvention.

## When to Activate
- User discusses best practices, reusable solutions, or architectural patterns
- User asks "how did we solve X before?" or "is there a pattern for Y?"
- Code review reveals a pattern worth preserving

---

## Workflow

### Step 1: Search Existing Patterns
Before saving anything, check what is already known.

```json
search_nodes("PATTERN:")
```

If a match is found, present it with its observations and any code examples before proceeding.

### Step 2: Classify the New Pattern

| Pattern Type | entityType | Naming Convention |
|---|---|---|
| Code-level (algorithm, utility, data-transform) | `pattern-code` | `PATTERN:PatternName` |
| Architectural (layer, module boundary, design) | `pattern-arch` | `PATTERN:ARCH:Name` |
| Integration (external service, API, webhook) | `pattern-integration` | `PATTERN:INT:ServiceName` |

### Step 3: Collect Required Observations

**pattern-code** (min 4 observations):
- `WHAT:` concise description of the pattern
- `WHEN:` conditions under which to apply it
- `HOW:` implementation steps or code snippet reference
- `USED_IN:` files or modules where it appears

**pattern-arch** (min 4 observations):
- `WHAT:` concise description
- `WHEN:` use cases and triggers
- `HOW:` structure / implementation guide
- `TRADEOFF:` pros and cons

**pattern-integration** (min 5 observations):
- `SERVICE:` name and base URL of external system
- `AUTH:` authentication method and credentials location
- `CALLBACK:` webhook/callback URL and payload format
- `GOTCHA:` known pitfalls or edge cases
- `RETRY:` retry/backoff strategy

### Step 4: Save to Knowledge Graph

```json
create_entities([{
  "name": "PATTERN:ARCH:RepositoryLayer",
  "entityType": "pattern-arch",
  "observations": [
    "WHAT: Abstracts data-access logic behind a repository interface",
    "WHEN: Use when multiple services need the same data queries",
    "HOW: Create a class with findById / findAll / save / delete methods; inject via DI",
    "TRADEOFF: Adds indirection; simplifies testing via mock repositories"
  ]
}])
```

Then link the pattern to its context:

```json
create_relations([
  { "from": "PATTERN:ARCH:RepositoryLayer", "to": "BIZ:ProjectAlpha", "relationType": "used_in" },
  { "from": "PATTERN:ARCH:RepositoryLayer", "to": "PATTERN:ARCH:ServiceLayer", "relationType": "extends" }
])
```

### Step 5: Recall on Request
When user asks for an existing pattern:
1. Run `search_nodes("PATTERN:")` with a relevant keyword
2. Open matched nodes: `open_nodes(["PATTERN:ARCH:RepositoryLayer"])`
3. Present observations + reference to files where the pattern is implemented

---

## Valid Relations for Patterns

| Relation | Meaning |
|---|---|
| `used_in` | Pattern applied in a project or module |
| `extends` | Pattern builds on another pattern |
| `alternative_to` | Pattern can substitute another |

---

## Naming Quick Reference

```
PATTERN:JWTAuth              → pattern-code
PATTERN:ARCH:ServiceLayer    → pattern-arch
PATTERN:INT:VNPay            → pattern-integration
```
