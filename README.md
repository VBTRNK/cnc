# Crime & Crown

Rule the streets. Claim the crown. A tool in the
[VibeTrunk](https://vibetrunk.com) hub.

Not live yet.

## What it is now

The first playable with cloud saves: the solo trading loop on Street, City
and Me, police stops, the evening paper, two upgrades, a save on the device
with export and import, an install manifest, and cloud saves by code (no
accounts). The simulation is in `src/sim`, the
session, local store and cloud sync in `src/game`, the screens in `src/ui`,
the database migration in `supabase/migrations`; the game is specified in
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
npm run browser-check  # with preview running: phone flows, saves and CSP in headless Edge
```

Cloud saves need `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see
[`.env.example`](.env.example)) in `.env.local`; without them the build is
guest-only and leaves a device's cloud code and its slot for a build that has them.
A local test server (localhost) builds only with `CNC_LOCAL_CLOUD=1`.

## More

- [`AGENTS.md`](AGENTS.md): instructions for agents and contributors.
- [`docs/design.md`](docs/design.md): what the game is and how it is built.
- [`docs/decisions.md`](docs/decisions.md): the rules and why.
- [`SECURITY.md`](SECURITY.md): reporting a problem.
