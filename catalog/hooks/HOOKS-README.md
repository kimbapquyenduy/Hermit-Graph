# Hermit Graph Hooks — Registration Guide

Hooks are copied to your project but need manual registration in each agent's config.

## Claude Code

Add to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/kg-auto-recall.cjs" }]
      }
    ]
  }
}
```

## Cursor

Add to `.cursor/hooks.json`:

```json
{
  "hooks": {
    "onPromptSubmit": [
      { "command": "node .cursor/hooks/kg-auto-recall-cursor.cjs" }
    ],
    "onSessionStart": [
      { "command": "node .cursor/hooks/session-hook-cursor.cjs" }
    ],
    "onSessionEnd": [
      { "command": "node .cursor/hooks/session-hook-cursor.cjs" }
    ]
  }
}
```

## Gemini CLI

Add to `.gemini/settings.json` (project-level) or `~/.gemini/settings.json` (user-level):

```json
{
  "hooks": {
    "BeforeAgent": [
      {
        "hooks": [{
          "type": "command",
          "command": "node .gemini/hooks/kg-auto-recall-gemini.cjs",
          "timeout": 10000
        }]
      }
    ],
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "node .gemini/hooks/session-hook-gemini.cjs"
        }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{
          "type": "command",
          "command": "node .gemini/hooks/session-hook-gemini.cjs"
        }]
      }
    ]
  }
}
```

**Note:** Antigravity IDE does not support hooks. Use Gemini CLI terminal.
```

## Cline

Add to `.clinerules/hooks.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "command": "node .clinerules/hooks/kg-auto-recall-cline.cjs" }
    ],
    "TaskStart": [
      { "command": "node .clinerules/hooks/session-hook-cline.cjs" }
    ],
    "TaskComplete": [
      { "command": "node .clinerules/hooks/session-hook-cline.cjs" }
    ]
  }
}
```

## Notes

- **lib/ directory**: Hook scripts require `./lib/recall-core.cjs` and `./lib/session-core.cjs`. The `lib/` directory must be co-located with hook files.
- **Fail-open**: All hooks exit 0 on error — they never block your prompt.
- **Review hooks**: Always review hook scripts before registering them.
- **Auto-config**: Manual registration only in v4.3. Future versions may auto-configure.
