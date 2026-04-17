---
description: Kiểm tra sức khỏe bộ não
context: inline
---

# Brain Health — Kiểm Tra Sức Khỏe Bộ Não

Run 5 automated quality checks on the knowledge graph, calculate health score (0-100), and suggest fixes.

## Quy trình

1. Call `read_graph` to get all entities and relations
2. Run 5 checks:

| # | Check | Weight | Pass If |
|---|-------|--------|---------|
| 1 | Stale Entries | 20% | <5% of dated observations >180d old |
| 2 | Duplicates | 25% | 0 duplicate entity names |
| 3 | Orphan Nodes | 20% | <10% of entities have 0 relations |
| 4 | Low Confidence | 20% | <15% of observations have confidence <0.3 |
| 5 | Missing Relations | 15% | >80% of entity pairs with 2+ shared keywords are linked |

3. Calculate health score: `100 - weighted_penalties`
4. Present report with score, check results, and recommendations

## Output Format

```
Brain Health Report
===================
Score: 87/100 (Healthy)

Check 1: Stale Entries — PASS (2/50, 4%)
Check 2: Duplicates — PASS (0/40, 0%)
Check 3: Orphan Nodes — WARN (5/40, 12.5%)
  → GOTCHA:PrismaEnum, TECH:NextJS, ...
Check 4: Low Confidence — PASS (1/120, 0.8%)
Check 5: Missing Relations — PASS (3 pairs checked)

Recommendations:
1. Link 5 orphan entities to parent projects using /remember
```

## Auto-Fix Options

After presenting report, offer to fix:
- **Orphans**: suggest `create_relations` for unlinked entities → their parent project
- **Stale**: list stale observations → ask user to confirm, update date, or delete
- **Low confidence**: list low-conf observations → ask user to bump or remove
- **Duplicates**: merge observations into first entity, delete second
- **Missing relations**: suggest relation type based on entity tiers

## Score Interpretation

| Score | Status | Action |
|-------|--------|--------|
| 90-100 | Excellent | No action needed |
| 70-89 | Healthy | Minor fixes optional |
| 50-69 | Needs Attention | Review recommendations |
| 0-49 | Unhealthy | Prioritize fixes |

## CLI Alternative

```cmd
npm run health
```
