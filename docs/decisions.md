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

## ADR-002 — Design, stack and backend chosen

Date: 2026-11-16

- Context: a design session settled the points that drive the stack. The game
  is a phone-first, menu-and-card interface around a simulation that runs on
  the player's device. [`design.md`](design.md) holds the full contract.
- Stack: Vite, React and TypeScript, built as a static single-page app with
  plain CSS files. The simulation is a pure TypeScript module without UI
  imports, tested headlessly. No Vercel application server.
- Rejected: Next.js (server and framework concepts the game does not need),
  plain JavaScript without a UI library (a growing interactive UI is harder
  to maintain), Astro and a game engine (poor fits for a full-screen HTML
  game).
- Backend: yes. The shared VibeTrunk Supabase project provides sign-in and one
  save row per player in schema `cnc` under row-level security. The browser
  talks to it directly with the publishable key; no service-role key is used
  by this repo. A narrowly scoped database function is allowed for atomic
  saves.
- Sign-in only, no sign-up: the shared project keeps public sign-ups off, and
  that setting is project-wide. Cloud saves therefore reach existing VibeTrunk
  account holders; everyone else plays as a guest with a local save.
- Hosted migration route: a catalogued migration in `VBTRNK/supabase` with a
  byte-identical copy here, applied by an owner-run push from that repo. Its
  automated workflow serves another tool only.
- Consequences: applying these is separate work, tracked in the "Open setup
  decisions" issue: the stack before any app code, the backend addon with the
  cloud-save work. The CSP then moves from `script-src 'none'` to
  `script-src 'self'`, and `connect-src` gains the Supabase project's origin
  and nothing else.

## ADR-003 — Stack applied

Date: 2026-11-17

- Context: ADR-002 chose the stack; this applies it, with no game code yet.
- Vite 8, React 19 and TypeScript 7 in strict mode, built to `dist/` as a
  static single-page app with plain CSS. Vitest 5 runs headlessly in Node.
  Dependencies are pinned to exact versions; Dependabot's npm block, with
  the same 5-day cooldown, now updates them.
- `vercel.json` names the Vite build (`npm ci`, `npm run build`, `dist`), so
  the deploy doesn't depend on the project's dashboard settings. Node 24.
- CSP: `script-src` moves from `'none'` to `'self'`; everything else stays.
  Vite emits the bundle and stylesheet as same-origin files, and assets are
  never inlined, so no `data:` or inline allowance is needed.
  `tests/csp.test.ts` fails if a script or style source other than `'self'`,
  an `'unsafe-*'` keyword or a wildcard appears.
- Verified under the real headers: `vite preview` serves the production build
  with the headers from `vercel.json`; headless Edge rendered the app with no
  CSP violation, and the same build under `script-src 'none'` was blocked.
- Vitest runs with globals because, on Windows, a session started in `c:\`
  loaded a second copy of Vitest and every suite failed.
- Known advisory: GHSA-fc5q-39xc-vjpf (picomatch ReDoS, no patched version)
  reaches only build and test tooling; `npm audit --omit=dev` is clean.
