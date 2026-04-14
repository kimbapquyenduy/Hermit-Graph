---
description: "Guide API endpoint design with consistency checks and naming conventions"
tags: "api, rest, graphql, endpoints, routes, design"
complexity: "moderate"
requires-tools: "file-ops, mcp"
paths: "**/api/**, **/routes/**, **/endpoints/**, **/controllers/**"
---
# API Design — Consistent Endpoint Design and Review

## Purpose
Guide API endpoint design with consistency checks against existing patterns, naming conventions, and error-handling standards already stored in memory.

## When to Activate
- User is designing new API endpoints
- User asks for a review of existing API routes
- User is choosing between REST, GraphQL, or RPC approaches

---

## Workflow

### Step 1: Search Existing API Patterns
```json
search_nodes("PATTERN:API")
search_nodes("PATTERN:ARCH:")
```
Load what the project has already established before suggesting anything new.

### Step 2: Apply Naming Conventions

**REST:**
- Resources: nouns, plural (`/users`, `/orders`, `/products`)
- Sub-resources: `/users/:id/orders`
- Actions that are not CRUD: use verb sub-routes (`/orders/:id/cancel`)
- No verbs in resource paths

**GraphQL:**
- Types: PascalCase (`User`, `Order`)
- Queries: camelCase (`getUser`, `listOrders`)
- Mutations: camelCase verb-noun (`createOrder`, `cancelOrder`)

### Step 3: Consistency Checklist

Run through these for every endpoint:

- [ ] HTTP method matches intent (GET=read, POST=create, PUT=replace, PATCH=partial, DELETE=remove)
- [ ] Status codes correct (200, 201, 204, 400, 401, 403, 404, 409, 422, 500)
- [ ] Error response format matches project standard (check memory for existing shape)
- [ ] Pagination consistent with existing endpoints (cursor vs offset)
- [ ] Auth header / middleware applied
- [ ] Rate-limit headers included if applicable
- [ ] CORS policy defined
- [ ] Input validation and sanitization present
- [ ] Response envelope consistent (`{ data, meta, error }` or project convention)

### Step 4: Save New API Pattern

When a new pattern is established (response envelope, versioning, error format):

```json
create_entities([{
  "name": "PATTERN:ARCH:APIErrorFormat",
  "entityType": "pattern-arch",
  "observations": [
    "WHAT: Standard JSON error envelope for all API endpoints",
    "WHEN: Use for every non-2xx response",
    "HOW: { error: { code: string, message: string, details?: object } }",
    "TRADEOFF: Verbose for simple errors; enables consistent client error handling"
  ]
}])
```

Link to the project:

```json
create_relations([{
  "from": "PATTERN:ARCH:APIErrorFormat",
  "to": "BIZ:ProjectAlpha",
  "relationType": "used_in"
}])
```

### Step 5: Output

Deliver two artefacts:

1. **API Design Checklist** — the completed checklist from Step 3
2. **Consistency Report** — list of deviations from existing patterns found in memory, with recommended fixes

---

## Entity Naming Reference

```
PATTERN:ARCH:APIErrorFormat     → error envelope pattern
PATTERN:ARCH:APIPagination      → pagination strategy
PATTERN:ARCH:APIVersioning      → versioning approach (header vs URL)
PATTERN:INT:ThirdPartyName      → external API integration
```
