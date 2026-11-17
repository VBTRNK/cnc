# Crime & Crown

Rule the streets. Claim the crown. A tool in the
[VibeTrunk](https://vibetrunk.com) hub.

Not live yet.

## What it is now

A designed game on an applied stack: Vite, React and TypeScript, serving a
placeholder screen. The game itself is specified in
[`docs/design.md`](docs/design.md) and not built yet; the backend is decided
but not applied (see the "Open setup decisions" issue). Rewrite this
paragraph as the tool changes; don't append history (that lives in the PRs).

## Local development

Node 24.

```sh
npm install
npm run dev      # dev server
npm run verify   # typecheck, tests, hook tests, production build
npm run preview  # the production build under the real security headers
```

## More

- [`AGENTS.md`](AGENTS.md): instructions for agents and contributors.
- [`docs/design.md`](docs/design.md): what the game is and how it is built.
- [`docs/decisions.md`](docs/decisions.md): the rules and why.
- [`SECURITY.md`](SECURITY.md): reporting a problem.
