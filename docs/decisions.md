# Decisions — Crime & Crown

Short records of rules and why: context, decision, consequences, about 20
lines each. Newest last. Undecided setup questions live in the "Open setup
decisions" issue until they are settled here.

## ADR-001 — Scaffold

Date: 2026-11-16

- Scaffolded by the `vibetrunk-new-tool` skill, whose templates were refreshed
  from `VBTRNK/kut` and `VBTRNK/home` (commits listed in the skill's
  `PROVENANCE.md`).
- Safety layers: allow lists without commit or push and with read-only `gh`
  commands only; a PreToolUse hook per agent that denies destructive
  commands; gitleaks on every PR as the required `scan` check; Dependabot with
  a 5-day cooldown (security updates exempt).
- A merge to `main` deploys through Vercel's Git integration. The merge
  authorizes that deploy only.
- The CSP starts strict (no scripts, `connect-src 'self'`, no form posts,
  no framing) and is loosened per origin as the app needs it.
- Stack and backend are not decided yet; they are open setup decisions.
