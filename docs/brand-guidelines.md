# Brand Guidelines v1.0 — Hermit Graph

## Quick Reference
- **Primary Color:** #6366F1 (Indigo — the lantern glow)
- **Secondary Color:** #818CF8 (Light Indigo)
- **Accent Color:** #10B981 (Emerald — health/success)
- **Background:** #0F172A (Dark Slate — the cave)
- **Primary Font:** system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif
- **Mono Font:** 'JetBrains Mono', 'Fira Code', ui-monospace, monospace
- **Voice:** Technical, Honest, Understated, Developer-First
- **Mascot:** Hermit crab with knowledge-graph shell

## 1. Color Palette

### Primary Colors
| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Indigo | #6366F1 | rgb(99,102,241) | Primary brand, CTAs, links, accent |
| Light Indigo | #818CF8 | rgb(129,140,248) | Hover states, secondary accent |
| Dark Slate | #0F172A | rgb(15,23,42) | Primary background, hero sections |

### Secondary Colors
| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Emerald | #10B981 | rgb(16,185,129) | Success, health score, positive states |
| Amber | #F59E0B | rgb(245,158,11) | Warnings, stale knowledge, d2 impact |
| Red | #EF4444 | rgb(239,68,68) | Errors, broken, d1 impact |
| Blue | #3B82F6 | rgb(59,130,246) | Info, d3 impact, code links |

### Neutral Palette
| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Slate 900 | #0F172A | rgb(15,23,42) | Primary background |
| Slate 800 | #1E293B | rgb(30,41,59) | Card backgrounds, panels |
| Slate 700 | #334155 | rgb(51,65,85) | Borders, dividers |
| Slate 400 | #94A3B8 | rgb(148,163,184) | Secondary text, captions |
| Slate 100 | #F1F5F9 | rgb(241,245,249) | Primary text on dark bg |
| White | #FFFFFF | rgb(255,255,255) | Text on dark, light bg text |

### Accessibility
- Slate 100 on Slate 900: 15.4:1 (WCAG AAA)
- Indigo on Slate 900: 4.6:1 (WCAG AA)
- Emerald on Slate 900: 7.2:1 (WCAG AAA)

### Impact Color System
| Depth | Color | Hex | Meaning |
|-------|-------|-----|---------|
| d=1 | Red | #EF4444 | WILL_BREAK — direct callers |
| d=2 | Amber | #F59E0B | LIKELY_AFFECTED — indirect |
| d=3 | Blue | #3B82F6 | MAY_NEED_TESTING — transitive |

## 2. Typography

### Font Stack
```css
--font-heading: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
--font-body: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
```

### Type Scale
| Element | Font | Weight | Size (Desktop/Mobile) | Line Height |
|---------|------|--------|----------------------|-------------|
| H1 | system-ui | 700 | 48px / 32px | 1.2 |
| H2 | system-ui | 600 | 36px / 28px | 1.25 |
| H3 | system-ui | 600 | 28px / 24px | 1.3 |
| Body | system-ui | 400 | 16px / 16px | 1.5 |
| Code | JetBrains Mono | 400 | 14px / 14px | 1.6 |
| Small | system-ui | 400 | 14px / 14px | 1.5 |
| Badge | system-ui | 600 | 12px / 12px | 1.0 |

## 3. Logo Usage

### Concept
The hermit crab mascot carries a glowing knowledge graph as its shell — nodes and edges forming a spiral shell shape. The lantern metaphor: illuminating hidden truths in your codebase.

### Variants
- **Full Logo:** Hermit crab icon + "hermit-graph" wordmark (horizontal)
- **Icon Only:** Crab with graph shell (favicons, npm, social avatars)
- **Monochrome:** Single-color Indigo or White
- **Light Background:** Dark crab + dark text on white/light bg
- **Dark Background:** Light/Indigo crab + light text on dark bg

### Style Direction
- Minimalist geometric, flat vector
- GitHub Octocat level of abstraction — recognizable but clean
- NOT cartoon, NOT photorealistic
- Graph nodes glow Indigo #6366F1
- Shell formed by connected nodes + edges in spiral pattern

### Clear Space
Minimum clear space = height of crab icon on all sides

### Minimum Size
- Digital: 32px width (icon), 120px width (full logo)
- Print: 10mm width (icon), 40mm width (full logo)

### Don'ts
- Don't rotate or skew the crab
- Don't change graph node colors outside brand palette
- Don't add drop shadows or 3D effects
- Don't separate the crab from its graph shell
- Don't place on busy backgrounds without contrast overlay

## 4. Voice & Tone

### Brand Personality
**Technical Precision:** We say exactly what we mean. No hand-waving, no buzzwords. If it's 30 MCP tools, we say 30 — not "dozens."

**Honest Pragmatism:** We acknowledge limitations. If semantic search needs setup, we say so. If something is auto-detected at 0.6 confidence, we flag it.

**Understated Confidence:** We don't oversell. The product speaks through demo, not hype. "Your agents remember" not "REVOLUTIONARY AI MEMORY!!!"

**Developer-First Empathy:** We know the pain because we live it. Re-explaining architecture to Claude for the 10th time is the problem. We fix it.

### Voice Chart
| Trait | We Are | We Are Not |
|-------|--------|------------|
| Technical | Specific, measurable, concrete | Vague, buzzwordy, hand-wavy |
| Honest | Acknowledging trade-offs, transparent | Overselling, hiding limitations |
| Understated | Confident through proof, calm | Hype-driven, exclamation-heavy |
| Developer-First | Empathetic, practical, useful | Corporate, marketing-speak, generic |

### Tone by Context
| Context | Tone | Example |
|---------|------|---------|
| README | Direct, technical, proof-first | "Full index ~2s. Queries <10ms." |
| Error Messages | Helpful, specific, actionable | "MCP config invalid — check MEMORY_FILE_PATH is absolute" |
| Social/Reddit | Conversational, peer-to-peer | "I got tired of re-explaining my architecture to Claude every session" |
| Release Notes | Factual, structured, no fluff | "CodeGraph Viewer — WebGL viewer for code symbols with file tree sidebar" |

### Prohibited Terms
- "Revolutionary" (overpromises)
- "Game-changing" (cliche)
- "AI-powered" when describing non-AI features (misleading)
- "Blazing fast" (vague — use actual numbers)
- "Synergy" (corporate speak)
- "Best-in-class" (unsubstantiated)
- "Seamless" (every product claims this)
- Excessive exclamation marks (one per page maximum)

### Taglines
- **Primary:** "Your AI agents remember everything now."
- **Sub-tagline:** "One memory. Seven agents. Zero repeats."
- **Technical:** "Persistent memory + code intelligence for AI coding agents."
- **Comparison:** "Free, offline, knows your code — not just a fact store."

## 5. Imagery Guidelines

### Brand Aesthetic
- Dark-mode first (Slate 900 backgrounds)
- Terminal/code aesthetic — monospace text, command-line UI
- Graph visualizations — nodes and edges, network diagrams
- Indigo glow as the signature visual element

### Photography Style
- Not applicable (developer tool, no lifestyle photography)
- Screenshots: dark theme terminals, graph viewers, code editors

### Illustrations
- Style: Geometric, minimal, flat vector
- Colors: Brand palette only (Indigo + Emerald + Slate)
- Hermit crab mascot for personality and recognition
- Graph/network motifs for technical credibility

### Screenshots
- Always use dark theme
- Show populated data (not empty states)
- Terminal screenshots: use a clean font, show actual command output
- Graph viewer: show enough nodes to demonstrate value (15-30 nodes)

### Social Media Images
| Platform | Size | Content |
|----------|------|---------|
| GitHub Social Preview | 1280x640 | Logo + tagline + badge row |
| OG Image | 1200x630 | Logo + tagline + feature highlights |
| Twitter Header | 1500x500 | Logo + tagline + agent badges |
| Reddit Post | 1200x675 | Comparison table or feature highlight |

## 6. Mascot — The Hermit Crab

### Character
- A hermit crab that carries a knowledge graph as its shell
- Graph nodes glow Indigo, edges connect in spiral shell pattern
- Small lantern metaphor — illuminates hidden code truths
- Personality: wise, patient, carries accumulated wisdom

### Usage
- Logo mark (primary brand identifier)
- Social media avatar
- Documentation illustrations
- Error pages and empty states ("The hermit hasn't learned this yet")
- Release announcements ("The hermit learned new tricks in v6.3")

### Don'ts
- Don't anthropomorphize beyond the logo (no talking crab comics)
- Don't make it cute/childish — maintain technical credibility
- Don't use without the graph shell (the shell IS the product)
