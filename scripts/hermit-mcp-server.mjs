#!/usr/bin/env node
// Legacy JSONL storage is available only through an explicit opt-in.
if (process.env.HERMIT_STORAGE === 'legacy') await import('./hermit-mcp-legacy.mjs');
else await import('./hermit-mcp-v8.mjs');
