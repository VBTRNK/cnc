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
- Screens: Street (where you are, stock, prices, actions), City (neighbourhoods and travel),
  People (the detective and the cast) and Me (character and upgrades).
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
phone tune them (ADR-014 for the goods). Places are placeholder names. The player's question is always
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

  Buying, buying an upgrade and ringing round with the phone take 0 h. There is no
  training action and no price-tier choice: experience comes from doing, and every sale is
  at the current price.
- **Goods,** twelve, one pocket each, in three tiers by price: cheap, mid and dear. Each sells
  about the same value an hour (price × rate $80-240), so dear goods sell slowly (an e-bike
  takes two hours); their heat per selling hour sets their character: cool, mild or hot. A
  place sets a price factor per good it deals in; the lowest factor is the good's source.
  Stock never spoils and carries over.

  | Good | Base | Sold/h | Heat/unit | Drift noise | Stock at source / elsewhere | Docks | Old Town | Uptown | Strip |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Untaxed Smokes | $8 | 10 | 0.3 | 10% | 20 / 6 | **0.85** | 1.0 | 1.15 | 1.09 |
  | Banned Bubblegum | $12 | 10 | 0.15 | 18% | 14 / 4 | — | **0.85** | 1.12 | 1.06 |
  | Bootleg Tapes | $15 | 8 | 0.3 | 14% | 12 / 3 | 1.0 | **0.85** | 1.06 | 1.18 |
  | Speakeasy Soda | $20 | 6 | 0.6 | 12% | 10 / 3 | **0.85** | — | 1.06 | 1.18 |
  | Eau d’Alibi | $35 | 5 | 0.2 | 12% | 7 / 2 | 1.0 | **0.85** | 1.18 | — |
  | Swiss-ish Watches | $50 | 4 | 0.6 | 14% | 4 / 1 | **0.85** | 1.0 | 1.18 | 1.03 |
  | Two-Left Trainers | $80 | 3 | 0.4 | 22% | 3 / 1 | — | 1.0 | 1.12 | **0.88** |
  | Fireworks | $100 | 2 | 2.0 | 20% | 2 / 1 | **0.85** | 1.12 | 1.0 | 1.18 |
  | Hot Phones | $150 | 1.5 | 3.3 | 16% | 2 / 1 | 1.12 | 1.0 | — | **0.85** |
  | Back-Alley Brie | $220 | 1 | 2.5 | 12% | 1 / 1 | 1.06 | **0.9** | — | 1.1 |
  | Stolen Bingo Balls | $300 | 0.75 | 8 | 20% | 1 / 0 | 1.18 | 1.06 | **0.85** | — |
  | Pre-Loved E-Bikes | $450 | 0.5 | 6 | 14% | 1 / 0 | 1.1 | — | **0.9** | 1.05 |

  **Bold** is the source; police factors are the Docks 0.7, Old Town 1.0, Uptown 1.4, the
  Strip 1.0. **A place deals in a good or never does** (— above): each place deals in ten.
  An undealt pair has no stock, no buyers and no price; it is never bought, sold, priced,
  tipped, rung round, rumoured or given an event, and a card sells only where the good is
  dealt. A dealt pair may have buyers and no stock (bingo balls and e-bikes away from their
  source). Goods carried into a place that doesn't deal in them stay held.

- **Prices.** Each place and good has one price at a time, used for buying and selling. The
  day-end roll sets tomorrow's baseline: base × place factor × a local drift, which reverts
  halfway to 1 each day plus roughly normal noise (the table's drift noise is its standard
  deviation), clamped to 0.7-1.5. The current price is the
  baseline × any active event's multiplier. Every price, total, bribe and fine is rounded to
  whole dollars, at least $1.
- **Stock and demand** per dealt place and good per day. Stock: the table's, at the source or
  elsewhere, × 0.7-1.3, rounded. Demand: selling rate × 3 × place factor × 0.8-1.2, rounded,
  at least 1. The city's units are split across the goods, so twelve goods don't multiply
  what a day can earn (ADR-014). Trades use them up until the next
  day's roll. A sale's maximum is the least of units held, demand left and what fits in the
  hours left.
- **Events.** A shortage multiplies price by 1.4; a glut by 0.7. When one starts, it changes
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
    sweep, or a harmless line, a third each. Active from 16:00 until 22:00 the next day. In
    the persistent MVP the harmless third becomes an encounter (see "Events").

  At most one event of each slot starts per day; a shortage or glut always on a dealt pair. A
  place and good (or, for a sweep, a place)
  that an active or scheduled event covers can't get an overlapping one; with no free
  candidate the slot stays empty or harmless. Effects end only at 22:00, so anything
  announced can always be reached.
- **No rerolling.** Baselines, stock, demand and the event schedule are rolled once from the
  saved generator. Revisits and reloads see the same values and what is already used up.
- **Upgrades**, on Me, either order, never lost: **big coat** $800 (pockets 20 → 35) and
  **burner phone** $1,200. The phone adds *Call around* to City: it notes every place's
  current price as seen now (not stock or demand) and adds heat, 5 × the call's number
  today (+5, +10, +15, ...; the count restarts each morning). Coppers listen in on a phone
  that is never thrown away. The third purchase is the Crown (see "The first chapter").
- **Skills**, levels 0-5 at 10 / 25 / 45 / 70 / 100 experience: **Patter** sells 10% faster per
  level (+1 per hour of a completed sale); **Nerve** adds 5 points per level to job and
  legging-it odds (+2 per job, +2 per stop); **Savvy** cuts selling heat 8% per level and adds 5
  points per level to rumour truth (+1 per new tip, +1 per Lie low that started above heat 0).
  A new level applies from the next quote.
- **Heat** 0-100, shown as low (0-24), warm (25-44), hot (45-69) or wanted (70+). A sale adds
  units × the good's heat × police factor × Savvy factor. A successful job +8, a failed one +15,
  a bribe +10, a successful run +10. Cooling: Lie low −12, an odd job −3, each voluntarily
  unused hour −1.5, overnight −8. Hours lost to an arrest or injury don't cool.
- **Stops.** Only when a sale or a job is committed, with p per hour = (0.3% + 0.07% × heat) ×
  police factor, for the action 1 − (1 − p)^hours. A stop takes no time and is a saved card
  holding the action and its quote:
  - **Slip him something:** $40 + a quarter of the carried goods' current value (a good not
    dealt here at the city's usual price) + 2 × heat;
    not offered at wanted or when unaffordable. Heat +10 either way. He takes it at 80% + 5
    points per Nerve − 0.3 points per heat, clamped 10-90%, and the action runs. Otherwise
    he is honest: no money changes hands and every carried good is taken, as in *Hand it
    over*.
  - **Leg it:** 50% + 5 points per Nerve − 0.3 points per heat, clamped 10-90%. Success: heat
    +10 and the action runs. Failure: arrest; the action is cancelled.
  - **Hand it over:** certain, every carried good is taken. A sale is called off with no time
    spent; a job still runs.

  The odds are frozen with the stop. The action that follows a stop is never checked again. With empty pockets (only possible
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
  than the player has; heat set to 25; the day ends. The next day starts at 14:00. Upgrades
  and skills are kept. Before the paper, a cells screen (the bars come down) says what was
  taken, the fine, the cash left, the heat and the late start; the paper repeats the fine. **Hurt** ends the day with nothing else lost. There is
  no debt, cash never goes below $0, and odd jobs are always a way back.
- **What the player sees.** Facts are exact: cash, held counts, pockets, hours, prices and
  stock where the player stands, each action's hours, a trade's total. Hints are words: a
  price is cheap at 80% or less of the city's usual (base × the mean factor of the places that
  deal in it) and pricey at 120% or more; heat as its
  word; a place's police mood in its flavour line; odds as words. Every sale and job quote
  carries a stop-risk chip: slight (under 5%), some (5-15%), real (15-30%), high (30%+). City
  shows the prices last seen in each place with their age. Held goods remember what they
  cost, so a sale's quote and its result give the profit or loss, a fact
  ("Sold 12 tapes for $228: $96 profit. The Strip's had its fill."). Outcomes are one line
  that names the cause. The action that ends the day keeps its line above the paper.
- **Tips.** Ask around gives at most two per place per day, and only new ones: today's
  price of one good at a place not seen today that deals in it (the good held most, else the
  dearest), each once. Each day also has one rumour about tomorrow, used once: true with 70% + 5 points per
  Savvy level, it describes tomorrow's scheduled event or says "Nothing big expected
  tomorrow"; otherwise it names a place and good with no event.
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
    scheduled today, so ending early skips nothing and an unseen midday item makes the
    paper (its headline, or a brief under a bigger story); heat cooling, then overnight cooling (after an arrest 25 becomes 17); the Crown's
    takings; events ending today expire; the detective; the roll (tomorrow's baseline, stock,
    demand and midday item, and the morning event after that); the newspaper from committed
    results and scheduled facts; save; "Start day N". Tomorrow's morning event
    activates at 10:00 before any card or action, even when an arrest makes 14:00 the first
    playable hour.
- **Day 1 fixture.** Stock is the base totals without noise, except at the Docks: smokes 20,
  tapes 3, watches 2, fireworks sold out (the source stock, the stock elsewhere, half the
  source stock, none). The first four goods have authored prices; the rest open at base ×
  factor, rounded. The morning line is "Smokes going cheap at the
  Docks. The Strip's gasping." Day 1's midday item is a sweep on the Strip; the evening paper
  announces a fireworks shortage in Old Town for day 2.

  | | Smokes | Tapes | Watches | Fireworks |
  | --- | --- | --- | --- | --- |
  | The Docks | $7 | $15 | $43 | sold out |
  | Old Town | $8 | $13 | $50 | $112 |
  | Uptown | $9 | $16 | $59 | $100 |
  | The Strip | $9 | $18 | $52 | $118 |

- **Difficulty.** The first release (local first playable and persistent MVP) has one
  forgiving mode, with no picker and no mode name; a run never ends and failure costs days.
  Hard mode comes after the persistent MVP, chosen at the start of a run and fixed for it.
- **Measuring.** The simulation's strategy runs (`npm run strategies`) measure these rules;
  their results are in the decisions log and the tracking issue (#8). Play on a phone judges
  the 2-4 minute day, whether stops feel explainable, whether the first purchase is a real
  choice, and whether it is fun.

## The detective, events and cast

The persistent MVP's layer on top of the loop. Every number is provisional: the strategy
runs tune them. Names are placeholders. Nothing here adds to the Street screen. Three ideas
stay separate: local danger is heat and the police factors, the detective's belief is his
tally, and what people feel is in their authored lines.

- **The detective.** Detective Sergeant Percy Pinch: pompous, vain, sees conspiracies in
  everything, can't resist a press statement. He is introduced in day 3's paper.
- **Habit: where he sees you.** Pinch keeps one tally per place. Every hour of a timed
  action there adds 1; travel adds nothing. Each night the tallies halve. He goes by where
  the player is seen, not what they sell, so he can be wrong: hours lying low or on odd
  jobs count like selling. The tally touches no odds.
- **Theory.** At a day end from day 5, with no case open and his rest over, he opens a case
  on the place with the highest tally (a tie is drawn from the generator). The case gets a
  comic label from what the player did most there ("The Uptown Watch Cartel", "The Docks
  Odd-Job Syndicate") and a codename ("Operation Kipper").
- **Warned operation.** He announces it in that evening's paper. The operation runs the day
  after next, from 10:00 for two full days, so there is always one whole day of warning. In
  its place the police factor is doubled, and a stop there is Pinch himself, who can't be
  bribed: *Slip him something* is not offered; *Leg it* and *Hand it over* are. Nothing else
  changes. A sweep can't overlap an operation, under the events' overlap rule.
- **False trail.** On the day between the announcement and the operation, the first card of
  the day comes from Lenny (below), and only when the player can afford it:
  - *Feed him a story:* $150 ($300 once Pinch is promoted). Pinch swallows it with 55% + 5
    points per Savvy level, clamped 10-90%; then the operation moves to the place with his
    lowest tally, and the result line names it. Otherwise the money is gone and nothing
    changes.
  - *Leave it.*

  Being seen elsewhere steers him too; that follows from the tally and needs no rule.
- **Consequence and resolution.** The case is *closed* if the player is arrested or hands
  goods over in a stop inside the operation, that night, and the operation ends with it;
  otherwise it goes *cold* after its second day. Neither adds a
  penalty: the arrest or the seizure is the cost. The paper reports his triumph or his flop,
  the case goes on his board, and he rests three days before the next theory. An arrest
  outside an operation earns only a line in which he takes the credit.
- **Promotion,** once: at the third day end after the player buys the Crown he becomes
  Detective Inspector, so the purchase has three days to be enjoyed. From then on an
  operation covers the two places with the highest tallies. His record of closed and cold
  cases is colour, not a gate.
- **Events.** Blocking choice cards (two or three choices) are for dilemmas: stops, the
  false trail, encounters and the Crown. Everything else is a report or a line in the paper.
  An *encounter* takes the midday slot's harmless third: at 16:00, the first authored card
  whose conditions hold where the player stands, else a harmless line as before. The pool
  is tried narrowest conditions first. A midday item first applied at the day end stays a
  line in the paper. A card rests 10 days after it shows; some show once.
  - Conditions, all of which must hold: day at least n; at a place; holding at least n of a
    good, or any goods; cash at least n; heat at least or at most a band; has or hasn't an
    upgrade or the Crown; the detective's state (case announced, operation on, promoted); a
    flag set or not.
  - Effects: cash up or down; heat; goods gained (up to free pockets, at a stated price so
    profit still works), sold at a factor of the price there, or lost; skill experience;
    hours spent; a price tip; moving the open operation; setting or clearing a flag. A
    chance choice draws once between two effect lists, with odds of a base plus skill
    points, clamped 10-90%. A new kind of effect (a share of cash, Pinch's tally, a market
    event) comes with the first card that needs it.
  - The first pool, ten cards:

    | Card | Where, when | Choices |
    | --- | --- | --- |
    | Terry's van | the Docks | 20 smokes for $90 · Pass |
    | Customs blind eye | the Docks, day 6+ | 10 tapes for $90, heat +5 · Pass |
    | A genuine watch | Uptown, holding watches | Sell one at half as much again, heat +5 · Pass |
    | Double or nothing | the Strip, cash $300+ | 50%: +$100 or −$100 · Pass |
    | The church roof | Old Town, cash $500+ | Give $50, heat −8 · Walk on |
    | No questions asked | anywhere, day 5+ | 3 fireworks for $360, heat +5 · Pass |
    | A mugger | anywhere, cash $300+ | Hand over $50 · Stand up to him (Nerve chance: Nerve +2, or −$120) · Run, 1 h |
    | Trading Standards | anywhere, warm or worse, holding goods | Duck into a doorway, 1 h · Brazen it out (Patter chance: nothing, or lose half of one good) |
    | Old mate | anywhere, cash $400+, once | Lend $100 (a flag) · Not now |
    | Old mate pays up | 4+ days after the loan | A report: +$150 and a tip |

    No card may be a dominant earner: its mean value where it shows stays below a good hour
    of trading (about $50; Old mate's loan is an accepted exception, ADR-014). It is measured by forking the run at each choice encounter
    (`CARDS=1`): every choice against the card's last (Pass, Walk on, Not now, Run, Brazen it
    out), both played on with the same policy and generator to the same game day, the end of
    the next day. Old mate's loan runs instead to the end of the day after the lending fork's
    repayment, cut off at the end of day + 14 and the run's last day; only loans repaid with
    a day to spare count, and those outstanding at the cutoff or cut short by the run's end
    are reported apart. A fork that stops before its endpoint isn't counted. In a lucky state,
    such as a shortage nearby, a card may pay more.
- **Cast,** four people with a portrait and a voice and no numbers. No relationship has a
  mechanical effect in the MVP; lines change with flags and milestones (Lenny's nickname for
  the player, Mags's greeting after an arrest).
  - **Percy Pinch,** the detective.
  - **Lenny Scoop,** crime reporter on *The Crown Courier*: prints anything that sells,
    calls everyone "pal", terrified of his editor. He bylines the headline and sells the
    false trail.
  - **Mags,** who runs the news kiosk and hears everything a day early. She voices the tips
    and rumours from *Ask around*.
  - **Old Reg,** landlord of the Crown & Anchor on the Strip: maudlin, broke, wants out. His
    worries trail the pub's sale in the paper.
- **The newspaper** is the story of the run. One headline, chosen in this order: a
  milestone today; Pinch (a case announced, closed or cold, his promotion); an arrest; an
  unseen midday item; tomorrow's morning event; the day's best sale; a stock line. At most
  three briefs. Pinch appears only at chain events and milestones.
- **Milestones** live in compact state beside the capped news log, so trimming old papers
  loses none: the day of each first (sale, $1,000, coat, phone, job, arrest, escape, case,
  the Crown, promotion), the best day, and the last 100 cases' place, label and outcome,
  with older cases kept as closed and cold totals, so a save stays inside the cloud's size
  cap however long the run.
- **People tab.** Pinch's board on top: each milestone pinned as an exhibit with his
  reading of it ("Exhibit C: a larger coat. *Significant Expansion of Distribution
  Capacity.*"), the open case with its days, and past cases stamped *closed* or *cold*.
  Below it the cast, one current line each.
- **The first chapter: claim the Crown.** The third purchase on Me, shown from day 1: the
  Crown & Anchor, $2,500. Buying it ends chapter one with a front page and a title from
  Lenny ("the Guv'nor"); the run goes on. It takes $75 a night, and Pinch knows where the
  player drinks: each night adds 2 to his tally for the Strip. After the Crown, money buys
  false trails, bribes and a margin; further purchases come with #19 and #7.
- **Measured** with the strategy runs (`DETAIL=1` reports cases, Pinch's stops and each
  card's value per choice; `CARDS=1` each choice's value): every encounter a real choice in
  some state and none a dominant earner, the loan aside (ADR-011, ADR-014). On the current
  rules the results are in ADR-014: a median trader buys the Crown on day 16, about one
  arrest a month, five cases in 30 days; avoiding operations cuts arrests by about 70% at
  little cost in wealth. Earlier rules' results stay in their ADRs.

## Look and feel

- The game looks like a comic crime tabloid on newsprint, kept light: flat paper, thin ink
  rules and plenty of empty space. No screen may feel crowded or heavy. Every screen is built
  from the treatments below; nothing is invented per screen (ADR-013).
- **Colour.** One light theme. Newsprint `#E6E3DA` is the ground and sheet `#F7F5EE` the
  raised surface (the rail, the tabs, sheets, controls, paper). Ink `#16140F` is for text and
  rules, muted ink `#4A463C` for secondary text, the rule tone `#837968` for dividers and
  chip outlines. Red `#A3140D` marks warnings and scarcity, on the thing it warns about.
  Highlighter yellow `#FFD400` is a text-sized mark for what is yours or now: the latest
  result, Here, Yours, the newest exhibit; never a filled block. Manila `#DCC48F`, with stamp
  red `#8E110B`, belongs to the dossier only.
- **Type.** Anton, in capitals, for places, names of things, large counts and the committing
  button. Newsreader for everything people read, the save line included. Courier Prime for
  money, time, chips and kickers. Running text is 16 to 18 px and nothing is smaller than
  14 px. The font files are served from this origin.
- **Weight and spacing.** Side margins are 20 px. Rules are 1.5 px ink, dividers 1 px in the
  rule tone. Corners are square. The only shadow is the dossier's hard offset. A screen has
  at most one filled ink button, the action that commits.
- **Frame.** The status rail is on top: cash, chips for pockets and heat, and the day's hours
  as a bar (used hours filled, the rest tinted) with the hours left beside it. The last
  move's result sits in a strip at the rail's foot, on every screen; the tabs are at the
  bottom. Rail, strip and tabs are on sheet, the screen between them on newsprint, and only
  the screen scrolls. Where the rail would take too much room (the narrow layout, a short
  screen, or more than 40% of the height) it scrolls away and the strip sticks to the top
  on its own; a result too long to pin (over 40% of the space above the tabs) scrolls with
  the page too, read in full there. A focused control always scrolls clear of what sticks
  and of the tabs.
- **Narrow layout.** Below 22.25 rem wide (356 px at default text, or any phone with large
  text) each screen leads with what the player came for, in reading and focus order alike.
  Street: the market right under the place name, each good on two lines, then the moves in
  one column, then the tips and the place's line. City: the price table first, then Call
  around. Me: the Form stacks. Type never shrinks to fit; the layout changes instead. With
  very large text on a small phone, portraits go above their lines, the trade stepper's
  controls narrow to 48 px each, and the tabs sit two by two.
- **Section break.** A 4 px double ink rule with a Courier kicker, a real heading naming the
  section. Only where a screen has sections; never the screen's own name, a count or hours.
- **Group and row.** A list starts on a 1.5 px ink rule and its rows split by dividers, with
  no boxes around rows. A row that opens a sheet ends in a chevron. A held count leads its row
  as a bare Anton numeral, read out as "3 held".
- **Control.** 48 px high, a 1.5 px ink outline on sheet: only controls carry an ink outline.
  The label left in Newsreader, the hours or money right in Courier, and at most one figure
  line below (payout, odds, risk, heat; red when it warns). An action that ends something
  or opens a sheet, like Call it a day, is a row with a chevron, not a box.
- **Chip.** A label, never tappable: 26 px, a 1 px outline in the rule tone, no fill, Courier
  14 px. Solid for a certain effect, dashed with a die for a chance, dashed with a question
  mark for unknown; red when it warns.
- **Paper.** Something to read, not tap: sheet fill, no outline, set apart by space (an
  exhibit, an ad). On the manila dossier, lists are rows with dividers; stamps stay red.
- **Good names.** At most 20 characters, no part over 12 between spaces or hyphens, so a name
  fits two lines in City's goods column on a 390 px phone. A Vitest test holds the catalogue
  to it and the browser check measures it.
- **Street.** The place name, its line, today's tips (the speaker in bold, each dismissable
  by a button named for its tip),
  then Moves and the Market. The moves sit two by two (Ask around, Lie low, Odd job, Pull a
  job), with Call it a day as a row below; a move with too few hours left is not shown. The
  market lists the ten goods the place deals in by name: held count, name, the price in a
  large right-aligned column, at most a one-word hint (cheap, pricey, short, glut, sold out),
  never a figure; then any held good it doesn't deal in, with no price and *no buyers*.
  Tapping a good, sold out or not, opens a sheet from the bottom: the name, the good's
  tagline in one line that wraps at large text, a buy or sell switch,
  a quantity stepper with a maximum shortcut (on its own line when the row doesn't fit), and
  one button that names the trade and its total; for a sale also its hours, with the profit
  and stop-risk chips ("Sell 6 for $288 · 2 h"). For a good nobody here deals in, the sheet
  shows only its tagline, how many are held, what they cost and "No buyers here."
- **City.** With the phone, Call around comes first as a control with its heat figure, and
  tomorrow's word under it. Then the prices: goods down and places across, each place's
  column headed by its name and any warning (Sweep, Pinch), the way there (Go and its hours,
  or the Here mark), and when its prices were seen ("now", "13:00", "day 8", "never"). An
  unseen price is a question mark (read as "not seen"), a pair the place doesn't deal in a
  dash (read as "not dealt here"); under a price, one word for stock or an event, or its
  own age when older than its column's. The goods column (5.75 rem) and the table's least
  width (19.75 rem) are in rem: the head sticks under whatever sticks at the top (the rail,
  or the strip alone) where the table fits; narrower, the table scrolls sideways under a
  fixed goods column, a keyboard stop of its own, the last column in view cut under a fade,
  with the place names again above the last rows (the last four, or the last half of a
  shorter list). Where a whole place column can't fit beside the fixed goods column and the
  fade (very large text on a small phone), the goods column scrolls too and the fade goes.
- **People.** Pinch's file is closed by default: his line, the exhibits' letters (the newest
  marked), the newest exhibit on paper and "Open the file" with the count. Opened, it lists
  every exhibit newest first and his earlier operations with their stamps, and the letters
  hide; focus moves to the first of them. The cast follows, one current line each.
- **Me.** Form: Patter, Nerve and Savvy side by side, each a large level numeral over five
  pips and what it does. The Classifieds: an ad for each upgrade not yet bought, with its
  price and Buy, or how much is short; owned ones as rows marked Yours. The Small print: how
  the run is saved and one button for the cloud, export and a new run.
- **Event card.** The character and the situation sit in a dossier: a manila folder with a
  halftone portrait and a stamp. The choices sit below it on plain paper. Each choice
  carries its effects as chips.
- **Newspaper.** A masthead, one headline with a short story, a few one-line briefs, the
  day's totals as chips, and one button that starts the next day.
- **Portraits** are tabloid-cartoon caricatures on a halftone ground in a thin ink frame:
  brush-ink outlines, Ben-Day dot shadows, sheet and newsprint fills and one spot of red. Each
  outline tells who it is (Pinch's trilby and monocle, Lenny's fedora and press card, Mags's
  curls, Old Reg's tufts and apron, the copper's helmet, a stranger's flat cap).
- **Tone of voice.** Dry, punning tabloid. Text is scarce: a line stays only if it informs a
  decision or adds character. No headings or labels that restate what the screen shows.

## Release steps

1. **Local first playable:** the solo loop, upgrades and recovery, minimal news, a local
   save, the install manifest. No account. A prototype, superseded by step 2.
2. **Persistent MVP,** live at https://cnc.vibetrunk.com: adds the detective's chain (habit, theory, warned operation,
   consequence, resolution), a modest pool of authored events, a small cast with authored
   personalities, the newspaper as the story of the run, and cloud saves by code. It
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
- The interface (`src/ui`) renders snapshots from a session (`src/game/session.ts`) and
  sends it actions; it never advances the world itself. Every line of text is a keyed
  template in `src/ui/text.ts`. The fonts come from pinned Fontsource packages and the
  portraits are SVG files in `src/ui/portraits/`; both are bundled as same-origin files.
- The Content-Security-Policy keeps the scaffold's strict baseline. Scripts and styles load
  from this origin only; the one added connection is the Supabase project's HTTPS origin.
  Allowances are per origin, never a wildcard. Motion uses CSS classes; nothing may inject
  styles at runtime.
- Tests run the simulation without a browser. Focused checks cover what those cannot: save
  handling, cloud sync, and the production build under its real headers in a browser
  (`npm run browser-check`): touch and keyboard flows on a phone and a desktop, old,
  future, corrupt and unwritable saves, and an accessibility audit of every screen and
  sheet (controls at least 48 px high, no text under 14 px, text contrast of 4.5:1 or 3:1
  when large, reflow at 320 px, a visible focus at every stop, no motion when reduced).
- The game ships a web app manifest and icons, so supporting browsers can install it.
  Installing does not by itself make the game start without a network.

## Saves

- A save is one versioned JSON document: format version, run identity, in-game clock,
  random-generator state, pending decisions, progression, milestones and a capped news
  log. Content is
  referenced by stable IDs.
- The game saves on the device after every action and whenever a pending decision appears
  or is resolved. Reopening never rerolls or skips a decision. A second tab is read-only.
- Loading validates the data, migrates older formats while keeping the original, and
  refuses newer formats without overwriting them. Corrupt data falls back to the last valid
  snapshot, and that and any storage failure are shown to the player.
- The snapshot is `{ format, version, state }` (`src/sim/save.ts`). The loader reports a
  save as corrupt, from the future, without a migration path, or invalid, and migrates on
  a copy.
- The local store (`src/game/store.ts`) writes each snapshot to `localStorage` twice, as
  the save and its backup copy. It keeps the text of a save it migrated or couldn't read,
  keeps the save that an import or a new run replaced, and never writes over a save from
  a newer version. The first open tab holds a Web Lock and writes; another tab follows it
  read-only and takes over when the first closes. A browser that can't hold that lock
  plays only the guest game: cloud codes need a single writing tab.
- Playing needs no account. Guests can export and import their save, and start a new run.
- Saves are editable by the player. That is accepted; there are no leaderboards.

## Cloud saves

- There are no accounts. A player keeps a run in the cloud under a cloud code the game
  makes up (16 letters and digits, shown as four groups of four) and enters that code on
  another device to continue it there. Anyone with the code can play the run; a lost code
  can't be recovered, and the run on the device and export and import still work. Nothing
  is shared with other VibeTrunk tools' accounts.
- The backend is the shared VibeTrunk Supabase project, schema `cnc`: one save row per
  code, under row-level security with no client access to the table. The browser calls two
  database functions with the publishable key, one to read the save under a code and one to
  write it. The database stores only a hash of the code.
- **Writing.** Every local candidate save remembers the cloud revision it descends from and
  presents it on upload. Fetching a newer cloud save never changes that. The database
  accepts the write and advances the revision in one atomic operation, only if that base is
  still current. A first save cannot overwrite an existing one. Revision numbers are never
  reused, not even when a code's save is created again after it was deleted, so an old base
  matches nothing. The database enforces the revision order, a size cap, and a limit on how
  many new codes appear.
- **When.** The device save comes first. While a code is in use, uploads follow committed
  actions, coalesced and one at a time, with a retry on reconnect and on return to the
  foreground. An upload is recorded before it is sent and stays pending until the server
  answers; a pending upload is sent again exactly as it was (same id, base and save), which
  the database answers as saved if it had already landed, so a retry never overwrites
  blindly or counts twice.
- **Storage.** What the device knows of the cloud never understates its save: a move is
  marked unsent before it is saved, and isn't saved when that mark can't be stored; the
  base moves only after the run it belongs to is stored. A save counts as written once
  the save itself is; its backup copy follows, best effort, and a failed write leaves the
  previous save and backup in place. A code's slot that opens from its backup copy, or
  without a save, waits for the cloud's run like any stand-in. A step that can't be stored
  changes nothing and says so where the player acted.
- **Conflicts.** There is no merging. On a conflict, or when a guest run meets the run
  under a code, the player chooses, comparing run, day, progress within the day and a short
  summary, or puts the choice off ("Not now"; uploads wait, and the save sheet brings the
  choice back). The displaced save is kept as a recovery copy. A fresh default world is never
  uploaded over a code's save: a code's slot that opens without a playable save waits for
  the cloud's run, takes it if the stand-in is untouched, and asks if not. One code's run
  never lands under another. A new run starts a new run identity under the same code.
- **Status.** The game shows whether the save is local only, synced, pending or failed, and
  never claims cloud protection before the server has confirmed a write.
- **Slots.** A build without cloud settings plays the guest game and leaves the device's
  code and its slot untouched. The guest game and each code used on the device have a
  local slot of their own; only the open code's slot syncs, and only under that code.
  Keeping a run in the cloud moves the guest run under a new code. Using a code resumes
  its slot if the device has one; otherwise the cloud is read first: no save under the
  code, and nothing changes; an untouched guest game, and the code's run is stored with
  its revision and played; a guest run in progress, and the player chooses. A code whose
  save is from a newer game, or can't be read, changes nothing. Stopping on a device
  attempts a final sync and returns to the guest game. The code's slot stays and
  catches up if the code is used there again. The removal option clears the device's
  save and recovery copies without starting another upload. The confirmation warns
  about that loss and offers export. A removal that fails can be retried. A synced
  code whose cloud save disappeared says so and offers to put the run back.
- The table `cnc.saves` and the functions `cnc.get_save` and `cnc.put_save` are in
  `supabase/migrations/`. The cloud layer is `src/game/cloudSaves.ts` (slots, codes,
  linking) and `src/game/sync.ts` (base revision, uploads, conflicts), over the `CloudApi`
  in `src/game/cloud.ts`, which calls the functions with plain `fetch`.

## Not decided here

- The later layers, and whether the territory phase gets a map (#7).
