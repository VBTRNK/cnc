# Design — Crime & Crown

The game's current product and architecture contract. Rewrite this file as decisions
change; don't append history. The repo's rules and their reasons are in
[`decisions.md`](decisions.md) and [`AGENTS.md`](../AGENTS.md). Open design questions are
tracked as GitHub issues.

## The game

- A single-player crime business sim in the browser. Each player has one world. No
  multiplayer.
- The main loop is crime and dealing: buying, selling, travelling and other ways to earn,
  within limited hours per day. Events, relationships and character traits are a layer on
  top of that loop.
- The destination is a crime family that controls territory and verticals, in the manner of
  a dynasty strategy game. The first release is solo, with no employees.
- The signature character is a recurring comic detective. He watches the player's habits,
  forms theories, some of them wrong, and runs investigations that change the game.
- Two difficulty directions exist, forgiving and hard. Their rules, recovery consequences
  and tuning are still to be designed; forgiving comes first, and the first release does not
  promise two separately balanced rule sets.
- Other games are inspiration for mechanics only: no names, characters, art or text from
  them.

## How it plays

- Time is discrete. The player picks an action, it resolves against a shared in-game clock,
  and the player picks again. The world advances only when the player acts; closing the
  game pauses it. Individual time costs and the rules at midday and day end are decided in
  loop design.
- Phone first: portrait, one hand, touch only, short sessions that can stop at any point. A
  desktop browser gets the same screens in a wider layout, usable by keyboard.
- Screens: Street (where you are, stock, prices, actions), City (neighbourhoods and travel)
  and Me (character and upgrades). People (the detective and the cast) becomes a tab in the
  persistent MVP.
- A decision and what it costs or risks are shown together. Routine actions give a short
  inline result. Cards that block are for dilemmas and significant outcomes; plain news can
  be dismissed, and an ordinary opportunity can be ignored without penalty.
- The interface is ordinary HTML: menus, lists and cards. No canvas. No pannable map in the
  MVP.
- Portraits are pre-made image files for the authored characters, never generated while
  playing.
- English only. All text has stable keys, so another language stays possible.
- Accessibility is part of done: semantic controls, visible focus, focus kept inside an open
  sheet and restored after it, adequate touch targets, readable contrast, no colour-only
  cues, text zoom, reduced motion, and no essential message that dismisses itself.

## Release steps

1. **Local first playable:** the solo loop, upgrades and recovery, minimal news, a local
   save, the install manifest. No account. A prototype, not a release.
2. **Persistent MVP:** adds the detective's chain (habit, theory, warned operation,
   consequence, resolution), a modest pool of authored events, a small cast with authored
   personalities, the newspaper as the story of the run, and sign-in with a cloud save. It
   has no general scheme system, no general opinion system and no earned-trait system.
3. **After the MVP:** the relationship and trait layer, which is planned. A timed scheme
   slot for the player is the first candidate. Starting the game without a network.
4. **Later:** the crime family: employees, rivals, territory, verticals.

## How it is built

- A static single-page app built with Vite, React and TypeScript and plain CSS files,
  served by Vercel on its Hobby plan. There is no Vercel application server.
- The simulation is a pure TypeScript module with no UI imports: state plus an action gives
  new state plus events. Randomness is seeded and its position is part of the state. It
  never reads the wall clock, and drawing a screen never advances the world.
- Events are typed data with a small fixed set of conditions and effects. No scripting
  language.
- The Content-Security-Policy keeps the scaffold's strict baseline. Scripts and styles load
  from this origin only; the one added connection is the Supabase project's HTTPS origin.
  Allowances are per origin, never a wildcard. Motion uses CSS classes; nothing may inject
  styles at runtime.
- Tests run the simulation without a browser. Focused checks cover what those cannot: save
  handling, sign-in and sync, browser flows, and the production build under its real
  headers.
- The game ships a web app manifest and icons, so supporting browsers can install it.
  Installing does not by itself make the game start without a network.

## Saves

- A save is one versioned JSON document: format version, run identity, in-game clock,
  random-generator state, pending decisions, progression and a capped news log. Content is
  referenced by stable IDs.
- The game saves on the device after every action and whenever a pending decision appears
  or is resolved. Reopening never rerolls or skips a decision. A second tab is read-only.
- Loading validates the data, migrates older formats while keeping the original, and
  refuses newer formats without overwriting them. Corrupt data falls back to the last valid
  snapshot, and that and any storage failure are shown to the player.
- Playing needs no account. Guests can export and import their save.
- Saves are editable by the player. That is accepted; there are no leaderboards.

## Accounts and cloud saves

- The backend is the shared VibeTrunk Supabase project: sign-in, and one save row per
  player in schema `cnc` under row-level security. The browser talks to Supabase directly
  with the public key. A narrowly scoped database function is allowed if atomic saves need
  one.
- Sign-in is a username and password for an existing VibeTrunk account; the same account
  works across VibeTrunk tools. The game has no sign-up and no password reset.
- **Writing.** Every local candidate save remembers the cloud revision it descends from and
  presents it on upload. Fetching a newer cloud save never changes that. The database
  accepts the write and advances the revision in one atomic operation, only if that base is
  still current. A first save cannot overwrite an existing one. The database enforces the
  revision order and a size cap.
- **When.** The device save comes first. While signed in, uploads follow committed actions,
  coalesced and one at a time, with a retry on reconnect and on return to the foreground.
  The unsent save is kept until the server confirms it. After an unclear result the game
  fetches and compares; it never overwrites blindly, and it recognises a retry that was
  already accepted.
- **Conflicts.** There is no merging. On a conflict, or when a guest save meets an existing
  cloud save, the player chooses, comparing run, day, progress within the day and a short
  summary. The displaced save is kept as a recovery copy. A fresh default world is never
  uploaded before the account's cloud save has been checked. Signing out or switching
  accounts never attaches one account's save to another. A reset starts a new run identity.
- **Status.** The game shows whether the save is local only, synced, pending or failed, and
  never claims cloud protection before the server has confirmed a write.

## Not decided here

- The look and feel (#2).
- The economy and its numbers, the action list and its time costs (#3).
- The timing rules around midday and day end (#4).
- The difficulty rules (#5).
- The detective's events and the cast (#6).
- The later layers, and whether the territory phase gets a map (#7).
