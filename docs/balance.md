# Balance changes

Use the game's simulation and strategy runner while designing and while
building. Run a quick check for changes to prices, stock, demand, travel,
payouts, costs, risk, progression or the measurement code. Confirm when a
change affects a fixed target, a material trade-off, or the policy or metric
used to judge the change.

## Prepare a comparison

1. Record the base revision, Node version, runner revision, intended rule
   changes, metrics and endpoints. Use the same runner on both rules profiles.
   If a policy or metric changes, run the old and revised runner on unchanged
   rules first. Keep that comparison with the results.
2. Create a clean scratch Git worktree for each profile from the recorded
   base. Change the candidate's rule source and save its diff as a patch. Run
   each profile in a fresh Node process so module initialization sees the
   patch. Apply the candidate patch to a second clean worktree for an
   independent reproduction. The [twelve-goods replay](balance-replay/issue-18.md)
   gives the commands and expected outputs.
3. Before simulation, inspect the opening snapshot against the authored
   fixture and expected derived values. Check the affected stock, demand,
   prices and quotes, plus dealt counts, sources and scheduled events. Use a
   seeded day-2 snapshot when the change affects fresh market rolls. Check
   the full snapshot against the second candidate checkout before trusting
   matching aggregates. The checked-in [opening and day-2 fixture](../tests/fixtures/strategy-markets.txt)
   is checked by the snapshot assertion in [tests/strategies.test.ts](../tests/strategies.test.ts).
4. Keep horizon, policies and seed indices matched across profiles. Seed
   index `i` uses `7919 * i`. Matching seeds pair the starting conditions.
   Later actions and market draws can consume the random stream differently.
   Change one lever at a time for a claim about that lever. Test combinations
   separately if an interaction matters.

## Run quick and confirmation checks

Run each PowerShell block from a profile's worktree root. Each writes JSON
to a new output folder outside the checkout. Node 24 runs the simulation
directly, so the strategy command needs no npm install. The console shows
Node version, Git revision, checkout status, worker count and simulation
time. See the
[replay](balance-replay/issue-18.md#reproduce-in-powershell) for console
logs and total command wall time.

```powershell
$out = Join-Path ([IO.Path]::GetTempPath()) ("cnc-balance-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $out | Out-Null
Remove-Item Env:CARDS,Env:DETAIL -ErrorAction SilentlyContinue
$env:SEED_START = '1'
$env:ONLY = 'trader'
$env:OPENING = '1'
$env:REPORT = Join-Path $out 'opening.json'
cmd.exe /d /c 'npm run strategies -- 30 1 2>&1'
$status = $LASTEXITCODE
Remove-Item Env:OPENING,Env:REPORT,Env:ONLY,Env:SEED_START
if ($status -ne 0) { throw "Opening snapshot failed ($status)" }
$out
```

Compare the snapshot with the fixture's day-1 rows before continuing. In an
installed checkout, run the base fixture regression with
`npm exec -- vitest run tests/strategies.test.ts -t 'captures every pair'`.
On an intentional fixture change, review the differences against the proposed
rules and update the explicit assertions and fixture when those rules ship.
The quick check is 40 seeds across 30 days with `trader`. Shorten the
horizon only when it still covers the affected endpoint and follow-up.

```powershell
$out = Join-Path ([IO.Path]::GetTempPath()) ("cnc-balance-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $out | Out-Null
Remove-Item Env:CARDS,Env:OPENING -ErrorAction SilentlyContinue
$env:ONLY = 'trader'
$env:SEED_START = '1'
$env:DETAIL = '1'
$env:REPORT = Join-Path $out 'quick.json'
cmd.exe /d /c 'npm run strategies -- 30 40 2>&1'
$status = $LASTEXITCODE
Remove-Item Env:DETAIL,Env:REPORT,Env:ONLY,Env:SEED_START
if ($status -ne 0) { throw "Quick check failed ($status)" }
$out
```

Confirmation uses 400 seeds across 30 days, including the quick check's first
40. Use `trader` and the relevant comparison policies. Include `dailyJob`
and `oddJobsOnly` for earning paths and `avoidOps` for risk or operations.

```powershell
$out = Join-Path ([IO.Path]::GetTempPath()) ("cnc-balance-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $out | Out-Null
Remove-Item Env:CARDS,Env:OPENING -ErrorAction SilentlyContinue
$env:ONLY = 'trader,dailyJob,oddJobsOnly,avoidOps'
$env:SEED_START = '1'
$env:DETAIL = '1'
$env:REPORT = Join-Path $out 'confirmation.json'
cmd.exe /d /c 'npm run strategies -- 30 400 2>&1'
$status = $LASTEXITCODE
Remove-Item Env:DETAIL,Env:REPORT,Env:ONLY,Env:SEED_START
if ($status -ne 0) { throw "Confirmation failed ($status)" }
$out
```

Use `CARDS=1` when a change affects choice value or delayed outcomes. Start
with the first 40 trader seeds. Expand both profiles to 400 for a close
target, thin sample or material tail.

```powershell
$out = Join-Path ([IO.Path]::GetTempPath()) ("cnc-balance-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $out | Out-Null
Remove-Item Env:OPENING,Env:DETAIL -ErrorAction SilentlyContinue
$env:ONLY = 'trader'
$env:SEED_START = '1'
$env:CARDS = '1'
$env:REPORT = Join-Path $out 'cards.json'
cmd.exe /d /c 'npm run strategies -- 30 40 2>&1'
$status = $LASTEXITCODE
Remove-Item Env:CARDS,Env:REPORT,Env:ONLY,Env:SEED_START
if ($status -ne 0) { throw "Card check failed ($status)" }
$out
```

A nonzero exit leaves the report available for diagnosis if it got as far as
writing one. Resolve incomplete runs before relying on a confirmation. For a
close target, rare outcome, thin sample or material tail, extend both
profiles with disjoint seeds or a longer horizon. For example,
`$env:SEED_START = '401'` with 400 seeds covers indices 401–800. For a longer
horizon, repeat both profiles at that horizon and report the endpoint.

## Read strategy reports

`npm run strategies -- <days> <seeds>` defaults to 20 days and 400 seeds.
`ONLY` selects comma-separated policies, `DETAIL=1` expands the console
summary, and `REPORT` saves exact JSON. Strategy and card runs use the
available CPU parallelism, capped at the number of seeds. Runs with fewer
than four seeds default to serial execution. Set `$env:WORKERS = '1'` for
serial execution or set another positive integer to limit worker count.
Reports merge in seed order and have identical bytes across worker counts.
Report p10, p50 and p90 alongside denominators and endpoint counts when
they matter to a decision.

- **Endpoints and percentiles.** The runner records the committed state on
  the requested day's `dayEnded` event. Wealth is cash plus FIFO inventory
  cost plus upgrade purchase cost. Days 5 and 10 use the last day for shorter
  runs. A percentile is the sorted value at zero-based index
  `floor(q * n)`. An unbought Crown counts among completed runs and sorts
  after observed purchase days. A censored percentile is JSON `null`. Each
  arrest at least five days before the horizon has its own recovery threshold,
  the last non-arrest closing wealth. Recovery is the first later close at or
  above that threshold.
- **Trade.** Profit is market-sale proceeds minus FIFO lot cost plus net
  earnings on card sales. Trade hours are committed sale and travel hours.
  Divide each run's profit by its trade hours, with a minimum denominator of
  one, then take percentiles of those ratios. Each run's top route share is
  its largest positive net market route profit divided by the sum of its
  positive net route profits, or zero without a profitable route. A route is
  the purchase place, sale place and good. The trip forecast uses last-seen
  prices and neutral remote demand. The split-sales policy forecasts bulk
  sales and splits them on arrival.
- **Fresh stock.** Divide each good's total fresh stock at its source by the
  reported seed-days on days 2 through the horizon. Fresh stock is the roll
  before events and trades change available units. Under the current
  0.7–1.3 stock multiplier and rounding, a source with base stock 1
  produces exactly one unit on every roll.
- **Choices.** Each eligible non-last choice has four paired attempts per
  encounter. Take and pass use the same initial generator position and
  continuation seed. Value is take minus the last choice, using cash, held
  goods at usual price and upgrades at cost. Compare at the close of the
  next day, or the close of the day after Old mate repays. Both branches stay
  within the run horizon and the loan's 14-day cutoff. Count outstanding
  loans observed through the full cutoff and pairs cut short by a limit
  separately from measured pairs. A completed pair reached the available
  endpoint on both branches. A measured pair reached the valuation endpoint.
  Card report format 2 gives each choice's distinct seed-and-day encounter
  count. Its `diff.measured`, `diff.outstanding` and `diff.cutShort` groups
  give n, mean and p10/p50/p90 at their respective endpoints. Empty groups
  have n = 0 and null statistics. Use the measured group for the cap.
  The `measuredMean95` interval is the measured mean ± 1.96 standard
  errors. To estimate the standard error, sum the deviations from the
  mean within each contributing seed, square those sums, and add them.
  Multiply by G/(G−1) for G contributing seeds, take the square root and
  divide by the number of measured pairs. This delta-method calculation
  keeps forks from the same parent seed together. The interval is null
  with fewer than two contributing seeds. The normal approximation can
  understate uncertainty when few seeds contribute.
- **Incomplete work.** Check requested, eligible and completed runs and
  card comparisons. A guard or refusal that leaves a run or branch stuck is
  listed with its reason, excluded from endpoint metrics and causes a
  nonzero exit. Keep those failures distinct from an unreached milestone
  or a censored choice in an otherwise completed run.

## Carry decisions from design into review

In the issue or proposal, name each fixed target with its metric, policy,
horizon and threshold. List exploratory observations, the knobs and ranges
the build may tune, and outstanding owner decisions. If a fixed target is
missed, a change needs to leave the agreed range, or two fixed targets trade
off, bring matched options and their measured costs to the owner before
the build proceeds.

Copy this block into an issue or proposal.

```text
Fixed targets | metric | policy | seed count and horizon | threshold
Exploratory observations | result | evidence | follow-up
Tunable knobs | current value | allowed range | coupled constraints
Owner decisions | decision and status | matched options and costs | approval
PR result table | metric and target | control | candidate | n and reach |
                  interval or percentiles | failures or censoring | disposition
PR evidence | commands and report | validation | accepted exceptions
```

### Twelve-goods example

- **Fixed targets.** Under the released `trader` policy, 400 seeds to
  day 30, median Crown day 16–19, median trade profit at most $55/hour,
  and median day-30 wealth at most $11,368. Mean fresh stock at each
  source is at least 1 on days 2–30. That floor is automatic for base-1
  sources. The choice cap is about $50 mean take-minus-pass value at the
  matched card endpoint. Decision 2 sets the revised-policy Crown target.
- **Exploratory observation.** With the revised policy at 400 seeds,
  reviewed stock advances the median Crown from day 15 to day 13 relative
  to shipped stock while both profiles clear the stock floor.
- **Tunable knobs.** Source and elsewhere quantities. The replay tests the
  two recorded profiles, for example tapes 12/3 shipped through 16/4 reviewed
  and watches 4/1 through 6/2. The historical trim had to preserve the
  fresh-stock floor. Decision 2 keeps the shipped quantities.
- **Decision 1 — Old mate exception.** Decided by owner delegation on
  2026-11-21. Grant a loan-only exception on shipped stock under the
  revised policy. Keep the terms of $100 lent and $150 plus a tip back.
  ADR-014's $63 basis belongs to the released policy. On the first 40
  shipped-stock seeds, the released policy measured 144 loans at $68 and
  the revised policy measured 128 at −$9.29. The revised policy on reviewed
  stock measured 139 at +$143.59. The 400-seed shipped result is $53.70
  (bootstrap 95% interval $27.92–$79.40, n = 1,307). Recheck if stock,
  policy or loan terms change.
- **Decision 2 — Revised Crown window and stock.** Decided by owner
  delegation on 2026-11-21. Keep shipped stock as measured and set the
  revised `trader` target to median Crown day 15–18. The revised policy
  moved the median on unchanged rules from day 16 to day 15. The released
  policy's target was day 16–19. Shipped meets the revised Crown target,
  both earnings caps, and the stock floor. Reviewed stock misses the
  Crown target and both earnings caps.

| Metric and target | Shipped control | Reviewed candidate | n and reach | p10 / p50 / p90 (shipped → reviewed) | Failures or censoring | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| Trader Crown day, revised target 15–18 | 15 | 13 | 400 each, 399 → 400 reached | 13 / 15 / 19 → 11 / 13 / 17 | 0 failures, 1 → 0 unreached | Shipped meets target, reviewed misses (Decision 2) |
| Median trade profit, at most $55/hour | $46.17 | $56.12 | 400 each | $42.18 / $46.17 / $49.96 → $51.09 / $56.12 / $61.22 | 0 failures | Shipped meets cap, reviewed exceeds it |
| Median day-30 wealth, at most $11,368 | $10,809 | $12,794 | 400 each | $9,129 / $10,809 / $12,355 → $10,441 / $12,794 / $14,860 | 0 failures | Shipped meets cap, reviewed exceeds it |
| Minimum mean fresh source stock, at least 1 | 1 | 1 | 11,600 source seed-days each | Base-1 sources always roll 1 | 0 failures | Both clear the floor |
| Old mate mean, cap ~$50 | $53.70 | $64.80 | 1,307 → 1,293 measured | 95% mean intervals $27.74–$79.66 → $29.52–$100.08 | 0 failures, 10 → 14 outstanding, 123 → 137 cut short | Loan-only exception on shipped stock (Decision 1) |

The [replay](balance-replay/issue-18.md) carries the commands, reports and
verification. [ADR-014](decisions.md#adr-014--twelve-goods-dealt-or-not-and-save-format-4)
records the historical exception. [ADR-015](decisions.md#adr-015--revised-trader-balance-targets)
records the revised target and loan exception.

Before review, check the following.

- The patch and opening checks show what ran. Exact commands name the base,
  runner and rules revisions, Node, seed set, policies, horizon and reports.
- The short PR table shows the matched results against targets, counts,
  relevant percentiles and failures or censoring. Include the validation
  performed and any accepted exception. Link the full report.
- Reviewers can reproduce the proposed profile from its patch in a clean
  worktree. Run `npm run verify` on the work you intend to ship.
- Play on a phone if the change affects what players can see, discover or
  understand, the day's pacing, or how a choice feels. The scripted policy
  approximates player knowledge and planning quality. It measures outcomes
  for those choices and seeds. Phone play checks comprehension and feel.

## Cities and regions measurement brief

Start with today's city as the control. On the candidate rules, compare a
policy that trades locally with policies that travel selectively and
routinely. Define what each policy knows about other cities before choosing
when to travel. Keep a local-only policy on the candidate to measure what
the new market and unlock rules do to a player who stays.

The runner already reports Crown progression and per-run top-route share.
Extend it to record trip-level margin and time, trip counts, road outcomes,
shares by origin and destination, and progress for each new unlock. Define
fares, travel time and road risk in the intercity design before measuring
those metrics.

- Record net trade margin after fares and other trip costs, travel time and
  time available to trade, and exposure to road stops, arrests and losses.
  Show both totals and per-trip or per-run rates with their denominators.
- Report trade profit share by origin and destination and concentration of
  profitable routes within each origin and destination. Include trip counts
  so an infrequent route's share can be interpreted.
- Record Crown and each unlock's day distribution, reach count or rate at the
  horizon, and censored counts. Use p10, p50 and p90 where progression or
  route concentration drives a decision.
- For a claim about price gaps, travel costs or road risk, vary that lever
  while holding route and unlock rules fixed. Agree on the targets and
  candidate policies in the issue before tuning. On a phone, play an early
  trip and an unlock decision once the design is playable, including what
  the burner phone reveals before departure.

[Cities and regions issue](https://github.com/VBTRNK/cnc/issues/19).
