@AGENTS.md

# Claude-specific notes

- Permissions and hooks for Claude live in `.claude/settings.json` and
  `.claude/hooks/`; the Codex equivalents are under `.codex/`, and
  Antigravity's hook is under `.agents/`. Antigravity has no repo-checked
  permission file, so its allow list lives in `~/.gemini/config/config.json`
  (`userSettings.globalPermissionGrants`). Keep the three hook scripts and the
  three allow lists in sync.
