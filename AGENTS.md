# AGENTS.md

Canonical instructions for every agent (Codex and Claude) in this repo.
`CLAUDE.md` imports this file; edit it here. Open work is GitHub issues.

## Project

Crime & Crown ("Rule the streets. Claim the crown.") is a tool in the
[VibeTrunk](https://vibetrunk.com) hub; add no coupling to `VBTRNK/home`
beyond its tools-list entry.

- Stack: Vite, React and TypeScript as a static single-page app, plain CSS,
  Vitest (ADR-002, applied in ADR-003). The app is the local first playable.
- Hosting: Vercel project `cnc`, at `https://cnc.vibetrunk.com` once live.
- Backend: the shared VibeTrunk Supabase project, schema `cnc` (not `public`),
  for cloud saves by code; no accounts, nothing shared with other tools'
  users (ADR-009). Row-level security is on for every table; the browser
  only calls the `cnc.get_save` and `cnc.put_save` database functions.
- A hobby project and a deliberate learning project in production-grade
  practice: clear structure, decisions recorded in `docs/decisions.md`.

## Invariants

These must never be violated; security and data integrity win over
convenience.

- No secret in a tracked file, a log or a browser bundle. `.env.example`
  documents the shape only.
- The Content-Security-Policy stays as strict as the app allows; loosen it
  per origin, never with a wildcard.
- Every table has row-level security. Only the publishable key reaches the
  browser; this game has no server and uses no secret key.
- Cloud saves change only through `cnc.put_save`, never by direct client
  writes, and the database stores only a hash of each code. The local save
  comes first; nothing uploads over a code's save without the player's choice.

Changing a rule, invariant or public contract means recording it in
`docs/decisions.md`.

## Commands

- `npm install`, then `npm run verify`: typecheck, Vitest, the hook tests
  and a production build, in one call. `npm run dev` for the dev server.
- `npm run build` then `npm run preview` serves the production build under
  the headers in `vercel.json`; check CSP changes there, never in dev.
  `npm run browser-check` then drives it headlessly (flows, saves, CSP).
- Vitest runs with globals; test files never import `"vitest"` (see
  `vite.config.ts`).

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

## Database

- Migrations live in `supabase/migrations/`, each byte-identical to its entry
  in the `VBTRNK/supabase` catalogue. They reach the hosted project only
  through that repo's `apply-migrations` workflow, approved by the owner
  (ADR-010); never push from this repo. Order: the migration PR here (its
  `catalogue-parity` check stays red), the catalogue PR merged, a fresh KUT
  backup, the workflow dispatched with `cnc_ref` = this PR's head SHA, then
  this PR merged. The commands are in that repo's README.
- New code degrades gracefully against the old schema until its migration is
  live. `tests/saves-sql.test.ts` runs each migration in PGlite.

## Agent safety

- Hooks in `.claude/hooks/` and `.codex/hooks/` block destructive commands
  (forced deletes, force push, remote branch deletion, hard reset, forced
  clean, broad checkout discards, forced branch deletion, downloads piped into
  an interpreter). What they enforce is non-negotiable; changing a guard needs
  a PR the owner asked for. Codex hooks and rules need the repo to be trusted.
- After changing `.codex/rules/project.rules`, run `codex execpolicy check` on
  it: one failing `match` example makes Codex drop the whole file.
- Never auto-allowed: `git commit`, `git push`, state-changing `gh` commands
  (merge, close, comment, rerun, cancel, delete), `supabase functions
  deploy`, real `db push`, `db reset`, `migration repair` and `secrets set`.
- Dependabot waits 5 days after a release; review any manual install in its
  PR diff.

## Documentation map

`README.md` is the current state, `docs/design.md` the game's product and
architecture contract, `docs/decisions.md` the rules and their reasons,
GitHub issues the open work, and the PR description the narrative.
