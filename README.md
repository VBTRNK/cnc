# Crime & Crown

Rule the streets. Claim the crown. A tool in the
[VibeTrunk](https://vibetrunk.com) hub.

Play it at [cnc.vibetrunk.com](https://cnc.vibetrunk.com): the persistent MVP.

## What it is now

The persistent MVP, live: the solo trading loop on Street, City and Me,
police stops, Detective Sergeant Pinch and his warned operations, authored
encounter cards, the evening paper as the run's story, Pinch's board and the
cast on People with their ink portraits, three purchases ending with the
Crown & Anchor, a save on the device with export and import, an install
manifest, and cloud saves by code (no accounts). The simulation is in
`src/sim`, the session, local store and cloud sync in `src/game`, the screens
and portraits in `src/ui`, the database migration in `supabase/migrations`;
the game is specified in
[`docs/design.md`](docs/design.md). Rewrite this paragraph as the tool
changes; don't append history (that lives in the PRs).

## Local development

Node 24.

```sh
npm install
npm run dev      # dev server
npm run verify   # typecheck, tests, hook tests, production build
npm run preview  # the production build under the real security headers
npm run strategies -- 20 400  # strategy runs: days, seeds (ONLY=trader,... to pick)
npm run browser-check  # with preview running: phone and keyboard flows, saves, CSP and an
                       # accessibility audit of every screen, in headless Edge
```

Cloud saves need `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see
[`.env.example`](.env.example)) in `.env.local`; without them the build is
guest-only and leaves a device's cloud code and its slot for a build that has them.
A local test server (localhost) builds only with `CNC_LOCAL_CLOUD=1`.
The 12-good test build is always guest-only, with or without them: its saves are not
the game's and must never reach a cloud slot.

## More

- [`AGENTS.md`](AGENTS.md): instructions for agents and contributors.
- [`docs/design.md`](docs/design.md): what the game is and how it is built.
- [`docs/decisions.md`](docs/decisions.md): the rules and why.
- [`SECURITY.md`](SECURITY.md): reporting a problem.
