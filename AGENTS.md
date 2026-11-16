# AGENTS.md

Canonical instructions for every agent (Codex and Claude) in this repo.
`CLAUDE.md` imports this file; edit it here. Open work is GitHub issues.

## Project

Crime & Crown ("Rule the streets. Claim the crown.") is a tool in the
[VibeTrunk](https://vibetrunk.com) hub; add no coupling to `VBTRNK/home`
beyond its tools-list entry.

- Stack: decided, not applied yet: Vite, React and TypeScript as a static
  single-page app (ADR-002). No app code, only the safety layer.
- Hosting: Vercel project `cnc`, at `https://cnc.vibetrunk.com` once live.
- Backend: decided, not applied yet: the shared VibeTrunk Supabase project,
  schema `cnc` (ADR-002; applying is in the "Open setup decisions" issue).
- A hobby project and a deliberate learning project in production-grade
  practice: clear structure, decisions recorded in `docs/decisions.md`.

## Invariants

These must never be violated; security and data integrity win over
convenience.

- No secret in a tracked file, a log or a browser bundle. `.env.example`
  documents the shape only.
- The Content-Security-Policy stays as strict as the app allows; loosen it
  per origin, never with a wildcard.

Changing a rule, invariant or public contract means recording it in
`docs/decisions.md`.

## Commands

- Not decided yet: there are no install, dev, build or test commands until a
  stack exists. `node --test tests/agent-hooks.test.cjs` tests the safety
  hooks.

## Workspace and branches

- `main` is protected: squash merges only, `scan` (gitleaks) must pass.
  Branch (`feat/`, `fix/`, `docs/`, ...) and open a PR; the owner reviews and
  merges. Branches auto-delete on merge. Use conventional commit prefixes.
- Never commit, push, deploy or change hosted state without the owner's
  authorization for that change.

## Release

A merge to `main` deploys to production through Vercel's Git integration. The
merge authorizes that deploy only; other hosted changes need their own yes.
Never run `vercel deploy` or `vercel --prod` by hand unless asked.

## Agent safety

- Hooks in `.claude/hooks/` and `.codex/hooks/` block destructive commands
  (forced deletes, force push, remote branch deletion, hard reset, forced
  clean, broad checkout discards, forced branch deletion, downloads piped into
  an interpreter). What they enforce is non-negotiable; changing a guard needs
  a PR the owner asked for. Codex hooks and rules need the repo to be trusted.
- After changing `.codex/rules/project.rules`, run `codex execpolicy check` on
  it: one failing `match` example makes Codex drop the whole file.
- Never auto-allowed: `git commit`, `git push`, state-changing `gh` commands
  (merge, close, comment, rerun, cancel, delete).
- Dependabot waits 5 days after a release; review any manual install in its
  PR diff.

## Documentation map

`README.md` is the current state, `docs/design.md` the game's product and
architecture contract, `docs/decisions.md` the rules and their reasons, GitHub issues the open work, and the PR description the narrative.
