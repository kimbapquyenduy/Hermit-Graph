# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 6.x     | :white_check_mark: |
| < 6.0   | :x:                |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub's private vulnerability reporting](https://github.com/kimbapquyenduy/hermit-graph/security/advisories/new).

You should receive a response within 48 hours. If the issue is confirmed, a patch will be released as soon as possible depending on severity.

## Scope

The following are in scope for security reports:

- **MCP server** (`hermit-mcp-server.mjs`) — command injection, unauthorized access
- **Knowledge graph data** (`brain.jsonl`) — data leakage, corruption
- **CLI tools** (`brain-cli.mjs`) — path traversal, arbitrary code execution
- **Dependencies** — vulnerable transitive dependencies

## Out of Scope

- Issues in user's AI agent configuration (Claude, Cursor, etc.)
- Denial of service against local-only MCP server
- Issues requiring physical access to the machine

## Disclosure Policy

- We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure).
- Credit will be given to reporters in the release notes (unless anonymity is requested).
