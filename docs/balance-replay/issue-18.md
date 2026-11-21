# Twelve-goods stock replay

This replay compares the reviewed stock profile for
[the twelve-goods proposal](https://github.com/VBTRNK/cnc/issues/18) with
the profile that shipped in [the goods PR](https://github.com/VBTRNK/cnc/pull/34).
The historical build used the reviewed catalogue first, then trimmed it to
slow progression. One sweep reused an opening market built before it
changed the stock table. Its shipped-profile run opened the Docks with four
tapes and three watches, where the shipped rules give three and two.
See the [investigation](https://github.com/VBTRNK/cnc/issues/37) and
[build checkpoint](https://github.com/VBTRNK/cnc/issues/18#issuecomment-7054499530).

## Inputs and opening checks

The shipped stock rules came from `e89dbe57f5165bf2f582f58c14a75db05bc26872`.
The original replay used the runner and simulation at
`c4ed3281a2ed3587a966efdf5c282220c6b2221c`. The commands below use the
parallel runner on Node v24.22.1 with 12 workers, opening and strategy
report format 1, and card report format 2. The
[candidate patch](issue-18-reviewed-stock.patch) restores
the source and elsewhere quantities from proposal revision 5, table CE6.
It changes only the stock arrays in `src/sim/content.ts`. The existing
day-1 derivation gives the opening described in CE7.

| Good ID | Shipped source / elsewhere | Reviewed source / elsewhere |
| --- | ---: | ---: |
| smokes | 20 / 6 | 20 / 6 |
| tapes | 12 / 3 | 16 / 4 |
| watches | 4 / 1 | 6 / 2 |
| fireworks | 2 / 1 | 3 / 1 |
| gum | 14 / 4 | 20 / 6 |
| soda | 10 / 3 | 16 / 4 |
| alibi | 7 / 2 | 10 / 3 |
| trainers | 3 / 1 | 5 / 1 |
| phones | 2 / 1 | 3 / 1 |
| brie | 1 / 1 | 2 / 1 |
| bingo | 1 / 0 | 2 / 0 |
| ebikes | 1 / 0 | 1 / 0 |

At seed 7919 each place deals in 10 of 12 goods (40 of 48 pairs).
The Docks opens with `20 / 3 / 2 / 0` smokes, tapes, watches and
fireworks on shipped stock and `20 / 4 / 3 / 0` on reviewed stock.
Docks e-bikes have buyers and zero stock. Docks gum is undealt. The full
opening snapshots differ only in stock fields, including the remaining
quantities. The second reviewed checkout reproduced the candidate patch,
opening snapshot, day-2 snapshot and quick JSON byte for byte.

## Reproduce in PowerShell

Start at the revision that introduces this guide's format-2 card runner.
Use a scratch clone for independent review. For an uncommitted review,
apply the full proposed change, including new files, to each worktree
before applying the reviewed stock patch. The commands write worktree
metadata to the clone and keep generated output outside it.

```powershell
$base = git rev-parse HEAD
$patch = (Resolve-Path 'docs/balance-replay/issue-18-reviewed-stock.patch').Path
$replay = Join-Path ([IO.Path]::GetTempPath()) ("cnc-stock-" + [guid]::NewGuid())
$out = Join-Path $replay 'reports'
New-Item -ItemType Directory -Path $out | Out-Null
$profiles = @('shipped', 'reviewed', 'repeat')
foreach ($profile in $profiles) {
    git worktree add --detach (Join-Path $replay $profile) $base
    if ($LASTEXITCODE -ne 0) { throw "Worktree setup failed for $profile" }
}
# In an uncommitted review, apply the proposed change to all three worktrees here.
foreach ($profile in @('reviewed', 'repeat')) {
    $candidate = Join-Path $replay $profile
    git -C $candidate apply --check $patch
    if ($LASTEXITCODE -ne 0) { throw "Patch check failed for $profile" }
    git -C $candidate apply $patch
    if ($LASTEXITCODE -ne 0) { throw "Patch apply failed for $profile" }
    $actual = Join-Path $out "$profile.patch"
    git -C $candidate diff --no-ext-diff --no-color --abbrev=7 --unified=1 "--output=$actual" -- src/sim/content.ts
    if ($LASTEXITCODE -ne 0 -or (Get-FileHash $actual).Hash -ne (Get-FileHash $patch).Hash) {
        throw "Source diff differs for $profile"
    }
}
```

Run the snapshots before any strategies. `Invoke-StockReport` saves exact
JSON and a separate console log. Wall time includes the npm invocation.

```powershell
function Invoke-StockReport($profile, $mode, $count) {
    $env:REPORT = Join-Path $out "$profile-$mode.json"
    $log = Join-Path $out "$profile-$mode.log"
    $clock = [Diagnostics.Stopwatch]::StartNew()
    cmd.exe /d /c "npm run strategies -- 30 $count > ""$log"" 2>&1"
    $exitCode = $LASTEXITCODE
    $clock.Stop()
    Add-Content -LiteralPath $log -Encoding UTF8 -Value ('Command wall time: {0:F2} s' -f $clock.Elapsed.TotalSeconds)
    if ($exitCode -ne 0) { throw "$profile $mode exited $exitCode. See $log" }
}

Remove-Item Env:CARDS,Env:DETAIL,Env:OPENING,Env:REPORT,Env:WORKERS -ErrorAction SilentlyContinue
$env:SEED_START = '1'
$env:WORKERS = '12'
$env:ONLY = 'trader'
$env:OPENING = '1'
foreach ($profile in $profiles) {
    Push-Location (Join-Path $replay $profile)
    try {
        Invoke-StockReport $profile 'opening' 1
        $env:REPORT = Join-Path $out "$profile-day2.json"
        @'
import { writeFileSync } from "node:fs";
import { newGame, step } from "./src/sim/index.ts";
import { marketSnapshot } from "./scripts/strategy-runner.ts";

let state = newGame(7919, "opening");
for (const type of ["callItADay", "startDay"]) {
  const result = step(state, { type });
  if (!result.ok) throw new Error(type + ": " + result.reason);
  state = result.state;
}
writeFileSync(process.env.REPORT, JSON.stringify(marketSnapshot(state), null, 2) + "\n");
'@ | node --input-type=module -
        if ($LASTEXITCODE -ne 0) { throw "Day-2 snapshot failed for $profile" }
    } finally { Pop-Location }
}
Remove-Item Env:OPENING
Get-ChildItem -LiteralPath $out -Filter '*.json' | Get-FileHash | ForEach-Object {
    "$($_.Hash) $(Split-Path $_.Path -Leaf)"
}
```

Compare the hashes case-insensitively with the table below, including the
repeat against the reviewed profile. Inspect `opening.places` for dealt
counts, Docks fresh stock and the expected dealt and undealt pairs. Stop
and investigate any mismatch before continuing.

```powershell
$env:ONLY = 'trader'
$env:SEED_START = '1'
$env:DETAIL = '1'
foreach ($profile in $profiles) {
    Push-Location (Join-Path $replay $profile)
    try { Invoke-StockReport $profile 'quick' 40 } finally { Pop-Location }
}
$repeat = Get-FileHash (Join-Path $out 'repeat-quick.json')
$reviewed = Get-FileHash (Join-Path $out 'reviewed-quick.json')
if ($repeat.Hash -ne $reviewed.Hash) { throw 'Candidate quick reports differ' }

# For confirmation, run both profiles on the same seed indices 1 through 400.
$env:ONLY = 'trader,dailyJob,oddJobsOnly,avoidOps'
foreach ($profile in @('shipped', 'reviewed')) {
    Push-Location (Join-Path $replay $profile)
    try { Invoke-StockReport $profile 'confirmation' 400 } finally { Pop-Location }
}

Remove-Item Env:DETAIL,Env:ONLY,Env:SEED_START,Env:REPORT
```

Run the card comparison on the first 40 and on all 400 trader seeds. Each
report includes the group statistics and measured-mean interval.

```powershell
$env:ONLY = 'trader'
$env:SEED_START = '1'
$env:CARDS = '1'
$env:DETAIL = '1'
foreach ($profile in @('shipped', 'reviewed')) {
    Push-Location (Join-Path $replay $profile)
    try {
        Invoke-StockReport $profile 'cards-quick' 40
        Invoke-StockReport $profile 'cards' 400
    } finally { Pop-Location }
}
Remove-Item Env:CARDS,Env:DETAIL,Env:REPORT,Env:ONLY,Env:SEED_START,Env:WORKERS
Get-ChildItem -LiteralPath $out -Filter '*.json' | Get-FileHash | ForEach-Object {
    "$($_.Hash) $(Split-Path $_.Path -Leaf)"
}
```

For a quick-only review, stop after comparing the two candidate quick
reports. Each strategy and card run uses a horizon of 30 days. Seed
index `i` uses `7919 * i`. Quick uses indices 1–40.
Confirmation uses indices 1–400 with all four listed policies, and the
expanded card comparison uses the same indices with `trader`.

## Results

Wall times are individual observations and vary by machine and concurrent
work.

### Quick check

All 40 requested and eligible trader runs per profile reached the day-30
close. Both reached the Crown in 40 of 40 runs. Each measured 1,160 source
seed-days with zero guards or failures. The values below are p10 / p50 /
p90 except for the arrest counts and wall time.

| Stock | Crown day | Day-30 wealth ($) | Trade ($/h) | Top route share | Arrests / runs | Wall time |
| --- | --- | --- | --- | --- | --- | --- |
| Shipped | 13 / 15 / 19 | 9,253 / 10,781 / 12,059 | 42.18 / 46.43 / 49.91 | 9.05% / 11.89% / 16.37% | 48 / 40 | 2.34 s |
| Reviewed | 11 / 13 / 17 | 10,767 / 12,503 / 14,533 | 51.74 / 55.63 / 60.53 | 10.21% / 14.19% / 19.26% | 44 / 40 | 2.22 s |

The second reviewed checkout took 2.13 s.

### Confirmation

All 400 requested and eligible runs per policy and profile reached the
day-30 close (3,200 runs, zero guards or failures). The shipped confirmation
also matched the S1 confirmation JSON byte for byte. Wall time was
30.28 s on shipped stock and 34.75 s on reviewed stock.

| Stock | Policy | Crown day p10 / p50 / p90 | Crown reached / unreached | Day-30 wealth p10 / p50 / p90 ($) | Arrests / runs |
| --- | --- | --- | --- | --- | --- |
| Shipped | `trader` | 13 / 15 / 19 | 399 / 1 | 9,129 / 10,809 / 12,355 | 343 / 400 |
| Reviewed | `trader` | 11 / 13 / 17 | 400 / 0 | 10,441 / 12,794 / 14,860 | 391 / 400 |
| Shipped | `dailyJob` | 14 / 19 / 25 | 395 / 5 | 6,442 / 8,496 / 10,439 | 1,172 / 400 |
| Reviewed | `dailyJob` | 12 / 17 / 23 | 397 / 3 | 7,318 / 9,429 / 11,568 | 1,139 / 400 |
| Shipped | `oddJobsOnly` | Censored | 0 / 400 | 3,050 / 3,100 / 3,150 | 0 / 400 |
| Reviewed | `oddJobsOnly` | Censored | 0 / 400 | 3,050 / 3,100 / 3,150 | 0 / 400 |
| Shipped | `avoidOps` | 13 / 15 / 19 | 399 / 1 | 9,042 / 10,667 / 12,226 | 111 / 400 |
| Reviewed | `avoidOps` | 11 / 14 / 17 | 400 / 0 | 10,351 / 12,690 / 14,379 | 174 / 400 |

| Trader stock | Trade ($/h), p10 / p50 / p90 | Top route share, p10 / p50 / p90 |
| --- | --- | --- |
| Shipped | 42.18 / 46.17 / 49.96 | 8.99% / 11.65% / 15.31% |
| Reviewed | 51.09 / 56.12 / 61.22 | 10.53% / 13.91% / 19.17% |

Each trader profile measured 11,600 source seed-days. The exact minimum
mean was `11,600 / 11,600 = 1` on both profiles. The shipped minimum
was shared by brie, bingo balls and e-bikes. E-bikes alone reached that
minimum on reviewed stock. Each of these sources has base stock 1, which
always rounds back to one under the 0.7–1.3 stock multiplier. At their
respective sources, tapes went from
139,006 to 184,714 units and watches from 46,384 to 69,437 units over the
same number of seed-days.

The historical reviewed-stock checkpoint used the early launch runner
and reached Crown day 14 with about $12,200 median wealth. Under the
released runner, shipped stock met the historical day 16–19 window
with Crown day 16 and $10,463 median wealth. It also met the minimum
mean fresh stock of 1.
The revised policy gives day 15 on shipped stock and day 13 on the
reviewed patch. Both medians fall before the historical window while
both still meet the source-stock floor. Trimming from reviewed to shipped
stock slowed median Crown progression by two days and reduced
fresh stock at ten goods' sources. This comparison estimates the effect of
the whole stock profile. Shipped stock meets the revised-policy median
Crown target of day 15–18, set by owner delegation on 2026-11-21.
[Historical shipment and targets](https://github.com/VBTRNK/cnc/pull/34) ·
[Released-policy results](../decisions.md#adr-014--twelve-goods-dealt-or-not-and-save-format-4) ·
[Revised targets](../decisions.md#adr-015--revised-trader-balance-targets)

#### Decision 2 — Revised Crown window and stock

**Decided by owner delegation on 2026-11-21.** Keep shipped stock as
measured and set the revised `trader` target to median Crown day 15–18.
The policy change alone moved the median from day 16 to day 15 on shipped
rules, so the revised target shifts the released day 16–19 window one day
earlier. Day 16–19 remains the released-policy target in the historical
results.

Shipped stock meets day 15 with 399 of 400 reached, $46.17/hour against
the $55 cap, $10,809 day-30 wealth against the $11,368 cap, and mean
source-stock floor 1. Reviewed stock reaches the Crown on day 13 with
400 of 400 reached. Its $56.12/hour and $12,794 day-30 wealth both exceed
the caps.

### Card check

#### First 40 seeds

To repeat the revised-policy check, use the card command with 40 seeds.
All 40 requested and eligible parents completed per profile. The table
accounts for the paired attempts from those runs. All requested pairs were
eligible and completed. The runs had zero guards or failures.

| Stock | Pairs | Measured | Outstanding | Cut short | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shipped | 1,368 | 1,308 | 1 | 59 | 8.05 s |
| Reviewed | 1,420 | 1,351 | 1 | 68 | 6.82 s |

The historical $63 basis for Old mate's exception (1,277 measured pairs)
does not hold on the revised policy. On the first 40 seeds, the released
policy on shipped stock measured 144 loans at $68 using the revised
driver. With the driver and stock held fixed, the revised policy
measured 128 loans at −$9.29. With the revised policy held fixed,
reviewed stock measured 139 at +$143.59. The revised shipped and
reviewed p10 / p50 / p90 were −$629 / $56 / $455 and −$595 / $97 / $875.

#### Expanded check across 400 seeds

Both profiles completed all 400 requested and eligible trader parents.
All requested pairs were eligible and completed, with zero guards or
failures. The expanded commands ran in sequence in the scratch clone.

| Stock | Pairs | Measured | Outstanding | Cut short | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shipped | 13,796 | 13,155 | 10 | 631 | 62.54 s |
| Reviewed | 13,456 | 12,733 | 14 | 709 | 51.21 s |

For Old mate, the table shows take minus pass at each group's matched
available close across 360 shipped and 361 reviewed encounters.
Outstanding loans reached the full 14-day cutoff.
Cut-short loans reached the available close before the valuation day.
The 95% intervals use the delta method, clustered by parent seed. The
p10–p90 ranges describe the spread of individual pairs.

| Stock | Loan group | n | Mean ($) | p10 / p50 / p90 ($) | 95% interval for the measured mean ($) |
| --- | --- | ---: | ---: | --- | --- |
| Shipped | Measured | 1,307 | +53.70 | −415 / 65 / 457 | 27.74 to 79.66 |
| Shipped | Outstanding | 10 | −318.95 | −1,147 / −100 / 1,330 | — |
| Shipped | Cut short | 123 | −52.89 | −100 / −100 / 65 | — |
| Reviewed | Measured | 1,293 | +64.80 | −592 / 82 / 657.15 | 29.52 to 100.08 |
| Reviewed | Outstanding | 14 | −215.40 | −1,936 / −100 / 1,746.80 | — |
| Reviewed | Cut short | 137 | −48.25 | −100 / −100 / 84 | — |

The loan group counts, means and percentiles match the original audit.
The new interval endpoints are within $0.65 of the earlier parent-seed
bootstrap intervals ($27.92–$79.40 shipped and $29.41–$99.43 reviewed).
The shipped mean changed from −$9.29 at 40 seeds to +$53.70 at 400.
Both expanded intervals sit above zero and span the historical ~$50 cap.
Combining measured loans with loans still outstanding at the full cutoff
gives +$50.87 across 1,317 pairs on shipped stock and +$61.79 across 1,307
on reviewed stock.
Pooling values at the available closes gives +$42.01 across 1,440 pairs
on shipped stock and +$51.35 across 1,444 on reviewed stock. This
sensitivity check mixes closes with different follow-up, including
cut-short outcomes. Apply the cap to the measured pairs at
the valuation endpoint.

#### Decision 1 — Old mate exception on the revised policy

**Decided by owner delegation on 2026-11-21.** Grant Old mate a loan-only
exception to the approximately $50 cap on shipped stock under the revised
policy. The terms remain $100 lent and $150 plus a tip back. At 400 seeds
the measured mean is $53.70 (n = 1,307).
The once-per-run card's stated $50 cash return accounts for most of that
mean, with wide individual outcomes. Recheck if stock, policy or loan
terms change.

### Exact output checksums

The raw JSON regenerated by the commands carries the full precision,
seed lists, counts and metric details. Wall times are recorded separately.
Repeat opening, day 2 and quick outputs use the reviewed hashes. Before
the card format changed, both parallel card reports and both confirmation
reports matched their format-1 hashes. The confirmations retained those
hashes with the new card format.
[Replay checksums and timings from the parallel-runner prototype](https://github.com/VBTRNK/cnc/issues/40).

| File | SHA-256 |
| --- | --- |
| `issue-18-reviewed-stock.patch` | `51339ad37df9a351b68146bd1a11d189eb61b6eb2a40c6ccada51ef91ce910e2` |
| `shipped-opening.json` | `94754e8366a24a0ec63157a93c3bfc2caaf895bd8609269f11e586782f039b13` |
| `reviewed-opening.json` | `0e78397f2b96864c6454e6a46f22d6a67b5a11ca4039f8560b37239ced7a58c9` |
| `shipped-day2.json` | `3d886e0db428e83cde47f97e1c6fb4f70fab59fa754c406e1287cc4a096e1f0a` |
| `reviewed-day2.json` | `f86251f56ee80fc0dc6cf3bfd3e3dd257c22eb5e67582c8f4e651e61bd7e7db1` |
| `shipped-quick.json` | `74b8f54dfd7969bfd00c7e468391aa3c7fb74874a2aa15875b7becbe8ab9847e` |
| `reviewed-quick.json` | `47f19e7d4baf380d0a54fdab049c993cd54bb597e76fdb3b71ad1f075da56f0a` |
| `shipped-confirmation.json` | `fe469899548b04f6bf85cf6602651c52e32bc6f87e4550e3fbba650bc59b394b` |
| `reviewed-confirmation.json` | `480d395bd2b529766995cffc7a36bedcf032a198cd57d46027ebdc1e776d08f5` |
| `shipped-cards-quick.json` | `80c2fa9df317e1346450c81ba394e2f43640db61f60d6e267dce9d40cf9843be` |
| `reviewed-cards-quick.json` | `52bdbb1f732444f28bedd74303294d15ea99c7d765999901eaec6defbc18276e` |
| `shipped-cards.json` | `061a65b2c7ae4b1ca93fabbd9eceaba87bd4331e8e48dd5881a880c5fca624d8` |
| `reviewed-cards.json` | `8a350e0395767865e5d3054ef1c492c73af72ab2142e8e43c7102405c3a2e11f` |
