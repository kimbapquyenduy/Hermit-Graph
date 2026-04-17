# Contributing to Hermit Graph

Thanks for your interest in contributing! This guide will help you get started.

## Quick Start

```bash
git clone https://github.com/kimbapquyenduy/hermit-graph.git
cd hermit-graph
npm install
npm test
```

## Development Setup

- **Node.js 20+** required
- No build step — pure ESM JavaScript
- Tests: `npm test` (unit), `npm run test:e2e` (end-to-end)

## How to Contribute

### Bug Reports

- Use the [bug report template](https://github.com/kimbapquyenduy/hermit-graph/issues/new?template=bug_report.yml)
- Include: Node version, OS, agent (Claude/Cursor/etc.), error output
- Minimal reproduction steps are highly appreciated

### Feature Requests

- Use the [feature request template](https://github.com/kimbapquyenduy/hermit-graph/issues/new?template=feature_request.yml)
- Describe the use case, not just the solution
- Check existing issues first to avoid duplicates

### Pull Requests

1. Fork the repo and create a branch from `master`
2. Make your changes
3. Add/update tests if applicable
4. Run `npm test && npm run test:e2e` — all tests must pass
5. Use [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`
6. Open a PR with a clear description of what and why

### Code Style

- Pure ESM (`import`/`export`, no CommonJS)
- Kebab-case file names
- Keep files under 200 lines — split into modules if larger
- Descriptive variable names over comments

## Project Structure

```
scripts/          # CLI + MCP server + tools
scripts/lib/      # Shared modules
catalog/          # Agent setup templates (Claude, Cursor, Gemini, etc.)
templates/        # Rules and config templates
viewer/           # Browser-based graph viewers
```

## What We're Looking For

- New agent integrations (setup templates in `catalog/`)
- Bug fixes with tests
- Documentation improvements
- Performance optimizations (especially MCP server response time)

## What We're NOT Looking For

- Major architectural changes without prior discussion
- Dependencies that add significant install weight
- Features that only work with a single AI agent

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
