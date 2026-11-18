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
- (Superseded by ADR-009: no accounts, cloud saves by code.)
  Sign-in only, no sign-up: the shared project keeps public sign-ups off, and
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

## ADR-005 — The simulation and its save

Date: 2026-11-17

- Context: the loop rules (design.md, "The loop") left a few details open;
  building the simulation settled them. Numbers stay provisional.
- Rounding: bribes and fines round up to whole dollars; heat is kept
  unrounded and shown as its word. Sale hours and the most units that fit
  use Patter's rate in exact tenths, so no floating-point drift.
- Day 1 uses the authored prices with a drift of 1; day 2 rolls from there.
- Ask around gives the day's rumour first, then price tips. A price tip's
  good is the one held most, else the dearest, falling back to the next
  good when no unseen place is left for it. Only Ask around earns Savvy
  experience; the phone's midday line spends the rumour without it.
- Reservations: a market event blocks another on the same place and good,
  a sweep another sweep on the same place, over overlapping lifetimes.
- An action that reaches 22:00 leaves the day's remaining activations to the
  day end, so a midday item nobody saw leads the paper.
- The generator is mulberry32: its whole position is one 32-bit integer in
  the state. A refused action draws nothing.
- Saves are `{ format, version, state }`, validated by a hand-written check
  (no schema library in the bundle). Migrations run per version on a copy.
- Scripts run with Node's own TypeScript support, so imports carry `.ts` and
  the code uses erasable syntax only (`allowImportingTsExtensions`,
  `erasableSyntaxOnly`).

## ADR-006 — No lock-up in the first playable

Date: 2026-11-17

- Context: the loop rules made a lock-up at the Docks ($2,500, 50 units) the
  third upgrade. The strategy runs (PR #14 and its follow-up) found that a
  trader runs short of hours and buyers, never of stock or pocket space, so
  storage adds little.
- Measured (400 seeds × 30 days, bought around day 15, wealth with the
  upgrade at cost): Docks-only, $10.8k against $10.9k without it, with a
  median of 6 units stored. Stash where you stand (50 units across the
  city, collected where left): $10.5k when hoarding anything cheap, $10.6k
  in gluts only, and $11.0k when hoarded goods were sold only where pricey,
  with more arrests in every variant.
- Decision: the first playable ships two upgrades, the coat and the phone.
  The later purchase is designed with the first-chapter goal (#6, S7), where
  what money is for after day 8 is already open.
- Consequences: no lock-up state, actions or save fields; the content ID
  `lockup` is free. A future storage upgrade should first show a gain in
  the strategy runs.

## ADR-007 — The local first playable

Date: 2026-11-17

- Context: S5 puts the simulation in front of a player on a phone, with a
  save on the device and no account (design.md, "Saves").
- Store: `localStorage` behind a `SaveStore` interface, so a cloud layer can
  wrap it. Each write stores the snapshot twice (save and backup), so a
  damaged save falls back without losing a move. A state the loader would
  refuse is never written. IndexedDB waits for a measured need.
- One writer: the first tab holds a Web Lock for its lifetime; others
  follow the `storage` event read-only and take over when the lock frees.
  Without the Locks API every tab writes.
- Text: keyed templates in one module with named values; no i18n library.
- Fonts: Fontsource packages (Anton, Newsreader, Courier Prime, Latin
  subsets), pinned and bundled, so `font-src 'self'` holds. The CSP is
  unchanged; the production build runs under it with no violation.
- Effects use block bodies: Chromium's `scrollTo` returns a promise, which
  React would call as a cleanup.

## ADR-008 — Phone-play feedback: the phone, bribes and costs

Date: 2026-11-18

- Context: the first phone play of the local playable found the burner phone
  too strong (every price, live, for free), the bribe a sure thing, and
  sales without their profit.
- Phone: an active *Ring round* (0 h) that notes every place's price now,
  for heat 5 × the call's number today. Measured (400 seeds × 20 days,
  median wealth on day 20): no phone $5.8k; one call a day $6.5k; two
  $6.0k; a call before every move $4.2k. The phone pays when used sparingly.
  Its midday rumour is gone (supersedes that line of ADR-005); the rumour
  stays with Ask around, which now gives price tips with the phone too.
- Rejected for the phone, simplest first: losing it on arrest or ditching it
  to cool off (candidates for hard mode), working only some days or for two
  or three days (chance without a choice), interception arrests (a second
  stop rule; heat already raises the stop chance).
- Bribe: refused at the usual odds formula from 80%; refused, he takes the
  goods. Heat +10 either way, so handing over stays the safe choice. It
  costs the trader about 2.5%.
- Costs: held goods carry what they cost (`paid`), so a sale names its
  profit. Day logs record the fine and units seized, for the cells screen
  and the paper.
- Save format 2 adds `paid`, `calls`, the stop's `bribeOdds` and the log's
  `fine` and `seized`; version 1 saves migrate (goods held then count at the
  city's usual price).

## ADR-009 — Cloud saves by code, no accounts

Date: 2026-11-18

- Context: S6 applies ADR-002's backend. The owner decided that the game's
  cloud saves must be separate from FLUT/KUT accounts. This replaces ADR-002's
  sign-in-only point: there is no sign-in at all.
- Model: a run is kept in the cloud under a random code (16 Crockford base32
  characters, 80 bits), entered on another device to continue it. No
  recovery: a lost code loses the cloud copy, not the device save. Rejected:
  an own Supabase project with username sign-up (a second project, passwords
  without reset); sign-up into the shared project (it would need a server
  piece and expose KUT's grants to strangers); device-bound anonymous
  accounts (lost with the device, so no better than the local save); an
  auto-assigned name (public, so it needs a password: a code with extra steps).
- Database: `cnc.saves` keyed by the code's SHA-256; row-level security with
  no policy, so no client role reads or writes the table. Only `anon` may call
  `cnc.get_save` and `cnc.put_save` (security definer, empty search path).
  `put_save` accepts a save only while the presented base revision is current,
  sets revision and time itself, answers a retry (same upload id, base and
  save) as saved and refuses an upload id reused for anything else. Revisions
  come from one sequence: a save created again under a code after deletion
  (restore, pruning) never repeats a number, so no device's old base matches
  it. Rejected: a fresh code on restore (other devices would lose the code)
  and a separate row id beside the revision (one more field in every call).
  Every refusal is SQLSTATE 22023. Tested in an in-process Postgres (PGlite).
- Shared project: the owner decided (2026-11-18, review 3) to keep cnc on the
  shared project, accepting the residual load the public functions put on
  KUT's database; a dedicated project was the alternative.
- Shared capacity (provisional caps): 64 KiB a save (a 200-day run is about
  22 KB), 60 new codes an hour and 2000 in all. Every save is created on one
  path, under an advisory lock after the caps, so neither concurrent calls nor
  rows deleted meanwhile get past them. That bounds stored saves to
  125 MiB of JSON before overhead. At a cap, new codes are refused (`busy`)
  and existing ones keep working; raising a cap or deleting stale rows (by
  `updated_at`) is a later migration; pruning deletes rows, never resets
  the revision sequence, and spares saves created within the last hour (both
  caps count the saves still stored, so deleting a newer one would free
  hourly room). Request volume itself is not limited
  in SQL: anyone holding the public key can already send requests to the
  shared Data API, and limiting it per request would mean writing per
  request. The project's gateway limits apply.
- Slots: the guest game keeps the first keys, each code gets `cnc.c.<code>`.
  Only the open code's slot syncs, under that code; a closed slot's sync
  changes nothing, even when an earlier call answers late. Only a build that
  can sync opens a code's slot: without settings, or without a held Web Lock
  keeping one writing tab, the game plays the guest game and leaves the code
  and its slot for a build that can. Rules: `design.md`.
- Sync: an upload (id, base, text) is stored before it is sent and stays
  pending until settled; a pending upload is sent again exactly as it was, so
  a late commit and its retry are one revision. Later moves follow it.
  Uploads wait 2 s to coalesce moves and flush at day end and on page hide.
  No automatic retry loop: the next move, reconnecting or returning to the
  foreground tries again. A synced code whose cloud save disappears says so
  and is put back only when the player asks.
- Storage: ordered, checked writes rather than one record or a journal. The
  rule: the sync record never understates the save. A move is marked unsent
  before it is saved and isn't saved if that fails; the base moves only after
  its run is stored, and the cloud's run is taken only into a session that
  stores it. The save itself is the commit point; its backup copy is
  refreshed after it, best effort, so a failed write never touches the only
  readable copy. Any leftover (a run stored, its new base not) makes the next
  check adopt again or ask, never upload over the cloud. A code's slot that
  opens without its own save (missing, unreadable or recovered from the
  backup) waits for the cloud's run before uploading; if that can't even be
  recorded, the slot doesn't sync that time. Replacing a run is all or
  nothing and keeps the run in play as the recovery copy; keeping this
  device's run in a conflict first stores it; an upload that couldn't be
  recorded is not sent; a choice or removal that can't be stored says so.
- Removing a code from this device clears its local slot. The confirmation
  explains the local loss and offers export because cloud presence can change.
- Client: two `fetch` calls with a 15 s deadline, no supabase-js. A new-format
  publishable key goes only in `apikey`, never as a bearer token. Replies are
  checked field by field; a malformed one counts as no reply (a write as
  unclear). The build refuses a key that isn't publishable or anon, and a URL
  that isn't a bare origin in `connect-src` (`scripts/public-env.ts`); a
  loopback test server only for the dev server or with `CNC_LOCAL_CLOUD=1`.
  A build without `VITE_SUPABASE_*` is guest-only. CSP: `connect-src` gains
  the project's HTTPS origin only.
- Migration route: catalogued in `VBTRNK/supabase`, applied by the owner's
  terminal push from there; its workflow refuses non-KUT migrations.
- Agent rules: the backend addon's denies are merged for both agents. Its two
  read-only allows (`migration list`, `db push --dry-run`) are left for the
  owner to add: an agent does not grant itself permissions.
