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
- The first release has one mode, forgiving, in which a run never ends. A hard mode comes
  after the persistent MVP (see "Difficulty" below).
- Other games are inspiration for mechanics only: no names, characters, art or text from
  them.

## How it plays

- Time is discrete. The player picks an action, it resolves against a shared in-game clock,
  and the player picks again. The world advances only when the player acts; closing the
  game pauses it. The rules are in "The loop" below.
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

## The loop

Every number in this section is provisional: the simulation's strategy runs and play on a
phone tune them. Goods and places are placeholder names. The player's question is always
the same: what is the best use of my next few hours?

- **Start.** Day 1 begins at 10:00 at the Docks with $250, nothing held, 20 pockets, heat 0,
  no skills, no upgrades and no debt. Day 1 is a fixed market (below); seeded markets start
  on day 2.
- **The day** runs 10:00-22:00 in whole hours; midday is 16:00. A timed action is offered
  only if it fits in the hours left, and shows its hours before the player commits. Call it
  a day is always available. The day ends where the player is; the next starts there.
- **Actions:**

  | Action | Time | Effect |
  | --- | --- | --- |
  | Buy | 0 h | At the current price, up to stock, cash and pockets |
  | Sell | 1 h or more | Hours = units ÷ selling rate, rounded up; up to the demand left |
  | Travel | 1 or 2 h | Along a ring: the Docks, Old Town, Uptown, the Strip. Neighbours 1 h, opposites 2 h; free |
  | Ask around | 1 h | One new tip (see "What the player sees"); offered only when one is left |
  | Lie low | 2 h | Heat −12 |
  | Odd job | 3 h | $30, certain, heat −3; never checked by the police |
  | Pull a job | 4 h | Once a day; see "Jobs" |

  Buying, buying an upgrade and moving goods in or out of the lock-up take 0 h. There is no
  training action and no price-tier choice: experience comes from doing, and every sale is
  at the current price.
- **Goods** (base price, units sold per hour, heat per unit sold), one pocket each: untaxed
  smokes $8, 10, 0.3 · bootleg tapes $15, 8, 0.3 · knock-off watches $50, 4, 0.6 · fireworks
  $100, 2, 2.0. Stock never spoils and carries over.
- **Neighbourhoods** set a price factor per good and a police factor:

  | | Smokes | Tapes | Watches | Fireworks | Police |
  | --- | --- | --- | --- | --- | --- |
  | The Docks | 0.75 (source) | 1.0 | 0.75 (source) | 0.75 (source) | 0.7 |
  | Old Town | 1.0 | 0.75 (source) | 1.0 | 1.2 | 1.0 |
  | Uptown | 1.25 | 1.1 | 1.3 | 1.0 | 1.4 |
  | The Strip | 1.15 | 1.3 | 1.05 | 1.3 | 1.0 |

- **Prices.** Each place and good has one price at a time, used for buying and selling. The
  day-end roll sets tomorrow's baseline: base × place factor × a local drift, which reverts
  halfway to 1 each day plus roughly normal noise (standard deviation 12% for smokes, 18%
  for tapes and watches, 30% for fireworks), clamped to 0.6-1.8. The current price is the
  baseline × any active event's multiplier. Every price, total, bribe and fine is rounded to
  whole dollars, at least $1.
- **Stock and demand** per place and good per day. Stock: at a source smokes 40, tapes 30,
  watches 12, fireworks 5; elsewhere 12, 8, 4, 1; each × 0.7-1.3, rounded. Demand: selling
  rate × 4 × place factor × 0.8-1.2, rounded, at least 1. Trades use them up until the next
  day's roll. A sale's maximum is the least of units held, demand left and what fits in the
  hours left.
- **Events.** A shortage multiplies price by 1.7; a glut by 0.55. When one starts, it changes
  what is left today (R stock, Rd demand) and later days' fresh totals (B stock, D demand):

  | | Stock when it starts | Stock later | Demand when it starts | Demand later |
  | --- | --- | --- | --- | --- |
  | Shortage | ⌊0.3 R⌋ | ⌊0.3 B⌋ | round(1.5 Rd) | round(1.5 D) |
  | Glut | R + B | 2 B | Rd | D |

  A police sweep doubles one place's police factor. Two slots per day:
  - *Morning event*, a shortage or glut on half of all days. It is scheduled two days ahead,
    can be rumoured the day before, is announced in that evening's paper, and is active from
    10:00 for two full days.
  - *Midday item*, rolled the evening before and hidden until 16:00: a shortage or glut, a
    sweep, or a harmless line, a third each. Active from 16:00 until 22:00 the next day.

  At most one event of each slot starts per day. A place and good (or, for a sweep, a place)
  that an active or scheduled event covers can't get an overlapping one; with no free
  candidate the slot stays empty or harmless. Effects end only at 22:00, so anything
  announced can always be reached.
- **No rerolling.** Baselines, stock, demand and the event schedule are rolled once from the
  saved generator. Revisits and reloads see the same values and what is already used up.
- **Upgrades**, on Me, any order, never lost: **big coat** $800 (pockets 20 → 35); **burner
  phone** $1,200 (City shows every place's current prices and low-stock notes, not demand,
  and the midday brief may carry the day's rumour); **lock-up at the Docks** $2,500 (50 units
  across goods, moved in or out only at the Docks; never seized and never counted in a
  bribe).
- **Skills**, levels 0-5 at 10 / 25 / 45 / 70 / 100 experience: **Patter** sells 10% faster per
  level (+1 per hour of a completed sale); **Nerve** adds 5 points per level to job and
  legging-it odds (+2 per job, +2 per stop); **Savvy** cuts selling heat 8% per level and adds 5
  points per level to rumour truth (+1 per new tip, +1 per Lie low that started above heat 0).
  A new level applies from the next quote.
- **Heat** 0-100, shown as low (0-24), warm (25-44), hot (45-69) or wanted (70+). A sale adds
  units × the good's heat × police factor × Savvy factor. A successful job +8, a failed one +15,
  a bribe +10, a successful run +10. Cooling: Lie low −12, an odd job −3, each voluntarily
  unused hour −1.5, overnight −8. Hours lost to an arrest or injury don't cool.
- **Stops.** Only when a sale or a job is committed, with p per hour = (0.5% + 0.1% × heat) ×
  police factor, for the action 1 − (1 − p)^hours. A stop takes no time and is a saved card
  holding the action and its quote:
  - **Slip him something:** certain, $40 + a quarter of the carried goods' current value + 2 ×
    heat, heat +10; not offered at wanted or when unaffordable. The action then runs.
  - **Leg it:** 50% + 5 points per Nerve − 0.3 points per heat, clamped 10-90%. Success: heat
    +10 and the action runs. Failure: arrest; the action is cancelled.
  - **Hand it over:** certain, every carried good is taken. A sale is called off with no time
    spent; a job still runs.

  The action that follows a stop is never checked again. With empty pockets (only possible
  before a job) there is no card, just "Patted down. Nothing on you."
- **Jobs.** Success chance s = 60% + 5 points per Nerve − 0.3 points per heat, clamped
  10-90%. Every outcome takes the job's 4 h and gives Nerve +2.

  | Outcome | Chance | Effect |
  | --- | --- | --- |
  | Success | s | $175-$325, heat +8 |
  | Nothing doing | ½ (1 − s) | Heat +15 |
  | Hurt | ¼ (1 − s) | Heat +15; the day ends when the job does |
  | Arrested | ¼ (1 − s) | Heat +15; arrest when the job ends |

- **Arrest:** carried goods are seized; a fine of 15% of cash, at least $50 but never more
  than the player has; heat set to 25; the day ends. The next day starts at 14:00. Lock-up
  goods, upgrades and skills are kept. **Hurt** ends the day with nothing else lost. There is
  no debt, cash never goes below $0, and odd jobs are always a way back.
- **What the player sees.** Facts are exact: cash, held counts, pockets, hours, prices and
  stock where the player stands, each action's hours, a trade's total. Hints are words: a
  price is cheap at 80% or less of the city's usual and pricey at 120% or more; heat as its
  word; a place's police mood in its flavour line; odds as words. Every sale and job quote
  carries a stop-risk chip: slight (under 5%), some (5-15%), real (15-30%), high (30%+). City
  shows the prices last seen in each place with their age. Outcomes are one line that names
  the cause ("Sold 12 tapes for $228. The Strip's had its fill.").
- **Tips.** Ask around gives at most two per place per day, and only new ones. Without the
  phone: today's price of one good at a place not seen today (the good held most, else the
  dearest), each once. Each day also has one rumour about tomorrow, shared with the phone's
  midday line and used once: true with 70% + 5 points per Savvy level, it describes tomorrow's scheduled event
  or says "Nothing big expected tomorrow"; otherwise it names a place and good with no event.
  The evening paper's line about tomorrow is always true.
- **Timing.**
  - Committing freezes the quote: hours and stop chance; for a sale its units and proceeds;
    for a job its success chance and payout range; and the odds in any stop. Then: the stop
    check, any card, the action as quoted, the clock moves to its end, any scheduled change
    up to that time applies, and any brief shows before the next decision. Nothing
    interrupts an action, and later changes never touch a committed one.
  - The midday brief shows after the action that reaches or passes 16:00. An action ending
    exactly at 16:00 already shows it.
  - A pending card blocks every action, zero-hour ones included, and stops the clock. It is
    saved with its action and quote; its outcome is drawn when the player chooses.
  - Plain news never blocks; stops and dilemmas do.
  - **Day end**, however it comes (22:00, Call it a day, an arrest, an injury): the last
    action and its consequences; the clock runs on to 22:00 and applies anything still
    scheduled today, so ending early skips nothing and an unseen midday item leads the
    paper; heat cooling, then overnight cooling (after an arrest 25 becomes 17); events
    ending today expire; the roll (tomorrow's baseline, stock, demand and midday item, and
    the morning event after that); the detective (persistent MVP); the newspaper from
    committed results and scheduled facts; save; "Start day N". Tomorrow's morning event
    activates at 10:00 before any card or action, even when an arrest makes 14:00 the first
    playable hour.
- **Day 1 fixture.** Stock is the base totals without noise, except at the Docks: smokes 40,
  tapes 8, watches 6, fireworks sold out. The morning line is "Smokes going cheap at the
  Docks. The Strip's gasping." Day 1's midday item is a sweep on the Strip; the evening paper
  announces a fireworks shortage in Old Town for day 2.

  | | Smokes | Tapes | Watches | Fireworks |
  | --- | --- | --- | --- | --- |
  | The Docks | $6 | $15 | $38 | sold out |
  | Old Town | $8 | $11 | $50 | $120 |
  | Uptown | $10 | $16 | $65 | $100 |
  | The Strip | $10 | $20 | $53 | $130 |

- **Difficulty.** The first release (local first playable and persistent MVP) has one
  forgiving mode, with no picker and no mode name; a run never ends and failure costs days.
  Hard mode comes after the persistent MVP, chosen at the start of a run and fixed for it.
- **To verify.** The simulation's strategy runs (`npm run strategies`) measure these rules;
  their results and proposed changes are in the tracking issue (#8). Open after them: the
  lock-up as designed is barely used and doesn't pay for itself, so its effect needs a
  decision. Phone play (S5) checks the 2-4 minute day, whether stops feel explainable,
  whether the first purchase is a real choice, and whether it is fun. After the third
  upgrade there is nothing left to buy; the MVP's first-chapter goal is designed with the
  detective (#6).

## Look and feel

- The game looks like a comic crime tabloid on newsprint, kept light: flat paper, thin ink
  rules and plenty of empty space. No screen may feel crowded or heavy.
- **Colour.** One light theme. Newsprint `#E6E3DA` is the ground and sheet `#F7F5EE` the
  raised surface (sheets, choice buttons). Ink `#16140F` is for text and rules, muted ink
  `#4A463C` for secondary text. Red `#A3140D` marks warnings and scarcity. Highlighter
  yellow `#FFD400` sits behind the latest result or a phrase in a headline. Manila
  `#DCC48F`, with stamp red `#8E110B`, belongs to the dossier only.
- **Type.** Anton, in capitals, for place names, headlines, large counts and the committing
  button. Newsreader for names and running text. Courier Prime for money, time and status
  chips. Running text is 16 to 18 px and nothing is smaller than 14 px. The font files are
  served from this origin.
- **Weight and spacing.** Side margins are 20 px. Rules are 1.5 px ink and dividers 1 px
  muted ink. Corners are square. The only shadow is the dossier's hard offset. A screen has
  at most one filled ink button, the action that commits. Controls are at least 48 px high.
- **Status.** Every play screen starts with cash, slim chips for pockets and heat, and a bar
  showing how much of the day is used, with the hours left beside it.
- **Street.** Goods are a plain list: a large held count (blank when none), the name, the
  price, and at most a one-word price hint, never a figure. A shortage shows as a short red
  note. Tapping a good opens a sheet from the bottom with a buy or sell switch, a quantity
  stepper with a maximum shortcut, and one button that names the trade and its total; for a
  sale also its hours, with the stop-risk chip ("Sell 6 for $288 · 2 h").
- **Event card.** The character and the situation sit in a dossier: a manila folder with a
  halftone portrait and a stamp. The choices sit below it on plain paper. Each choice
  carries its effects as chips: a solid chip is certain, a dashed chip with a die is a
  chance, and a dashed chip with a question mark is unknown.
- **Newspaper.** A masthead, one headline with a short story, a few one-line briefs, the
  day's totals as chips, and one button that starts the next day.
- **Portraits** are ink silhouettes or drawings on a halftone ground.
- **Tone of voice.** Dry, punning tabloid. Text is scarce: a line stays only if it informs a
  decision or adds character. No headings or labels that restate what the screen shows.

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
- The simulation lives in `src/sim`. `step(state, action)` validates the action; a refused
  action changes nothing and draws no random number. Content (goods, places, upgrades,
  skills, events) is referenced by stable IDs from `src/sim/content.ts`, which also holds
  the loop's numbers. Strategy runs drive the same `step` over many seeds; no second
  economy implementation exists.
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
- The snapshot is `{ format, version, state }` (`src/sim/save.ts`). The loader reports a
  save as corrupt, from the future, without a migration path, or invalid, and migrates on
  a copy; the local store (S5) keeps the original and the last valid snapshot.
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

- The detective's events, the cast and the first-chapter goal (#6).
- The later layers, and whether the territory phase gets a map (#7).
