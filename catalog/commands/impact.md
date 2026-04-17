---
description: Phân tích ảnh hưởng trước khi sửa code
context: inline
---

# Impact Check

Unified impact analysis: CodeGraph blast radius + KG business rules + BUSINESS.md chains.

## Arguments

`$ARGUMENTS` = symbol name or description of the change to analyze.

## Procedure

### Step 1 — CodeGraph blast radius + KG business rules

Call `hermit_impact({target: "$ARGUMENTS", direction: "upstream"})`.

This returns:
- **Code impact**: d1 (WILL_BREAK), d2 (LIKELY_AFFECTED), d3 (MAY_NEED_TESTING)
- **Business Rules at Risk**: matched RULE: entities from KG (auto-joined via file paths)
- **Flows Affected**: matched FLOW: entities from KG

If hermit_impact is unavailable or target not found, fall back to manual file analysis.

### Step 2 — BUSINESS.md chain awareness

If `BUSINESS.md` exists in the project root, read it and find impact chains whose files overlap with the affected files from Step 1.

If `BUSINESS.md` does not exist, skip this step and note: "No BUSINESS.md found — run `/biz-init` to create one."

### Step 3 — Synthesize unified report

Combine all 3 sources into one report using the output format below.

### Step 4 — Wait for user confirmation

**Always wait for user to confirm** before proceeding with any code changes.

## Output Format

```
## Impact Analysis: [target]

### Code Impact (CodeGraph)
[paste hermit_impact d1/d2/d3 sections]

### Business Rules at Risk
| Rule | Confidence | Affected File | Depth |
|------|-----------|---------------|-------|
| RULE:X | 0.8 | src/foo.js | d=1 WILL_BREAK |

If no rules: "No KG business rules matched. Run /deep-scan to discover rules."

### Impact Chains (BUSINESS.md)
- Chain: [name] — [description]
  - Affected: [files in chain that overlap with code impact]

If no BUSINESS.md: "No BUSINESS.md found — run /biz-init"

### Required Tests
1. [from BUSINESS.md MUST TEST sections]
2. [from RULE: entity observations]
3. [from affected d1 files]

### Risk Summary
- Code blast radius: [d1 count] direct, [d2 count] indirect
- Business rules at risk: [count]
- Impact chains triggered: [count]
- Overall risk: LOW / MEDIUM / HIGH / CRITICAL
```

## Fallback Behavior

- **No CodeGraph index**: Skip code impact section, note "Run hermit_index to enable code-level analysis"
- **No KG RULE entities**: Skip business rules section, note "Run /deep-scan to discover business rules"
- **No BUSINESS.md**: Skip chains section, note "Run /biz-init to create BUSINESS.md"
- **All 3 missing**: Perform manual analysis by reading git diff and project structure

After output → **WAIT for user confirm** before coding.
