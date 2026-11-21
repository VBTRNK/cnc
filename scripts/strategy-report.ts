import { CARDS, GOODS, UPGRADES, type CardId, type GoodId } from "../src/sim/index.ts";
import { perGood } from "../src/sim/market.ts";
import { BINS } from "./strategy-policy.ts";
import { cardRuns, FORKS, LOAN_CUTOFF, strategyRuns, type CardSample, type Selection } from "./strategy-runner.ts";

type Run = ReturnType<typeof strategyRuns>[number][number];

const sum = <T>(items: readonly T[], value: (item: T) => number) => items.reduce((total, item) => total + value(item), 0);
const ratio = (n: number, d: number) => d === 0 ? null : n / d;
const mean = (values: number[]) => ratio(sum(values, (v) => v), values.length);

function quantiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.floor(q * sorted.length)] ?? null;
  return { n: sorted.length, p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

function workCounts(attempts: Pick<Run, "seed" | "outcome">[], requested: number) {
  const incomplete = attempts.flatMap(({ seed, outcome }) => outcome.end === "endpoint" ? [] : [{ seed, ...outcome }]);
  return {
    requested, eligible: attempts.length, completed: attempts.length - incomplete.length,
    guard: incomplete.filter((r) => r.end === "guard").length,
    failed: incomplete.filter((r) => r.end === "failed").length,
    incomplete,
  };
}

/** Aggregate exact committed endpoints. A stuck run contributes only to the work counts. */
export function summarizePolicy(name: string, days: number, attempts: Run[], requested = attempts.length) {
  const runs = attempts.filter((r) => r.outcome.end === "endpoint");
  const n = runs.length;
  const perRun = (pick: (r: Run) => number) => ratio(sum(runs, pick), n);
  const endOfDay = (day: number) => ({
    day, cash: quantiles(runs.map((r) => r.cash[day]!)),
    wealth: quantiles(runs.map((r) => r.wealth[day]!)),
  });
  const upgrades = UPGRADES.map((id) => {
    const bought = runs.flatMap((r) => r.upgradeDay[id] ?? []);
    const unreached = n - bought.length;
    // Unbought upgrades rank after every observed day, so a censored percentile is null.
    const { p10, p50, p90 } = quantiles([...bought, ...Array<number>(unreached).fill(Infinity)]);
    const dayOrNull = (value: number | null) => value !== Infinity ? value : null;
    return { id, bought: bought.length, unreached, day: { p10: dayOrNull(p10), p50: dayOrNull(p50), p90: dayOrNull(p90) } };
  });
  const earnings = {
    trade: sum(runs, (r) => r.earned.trade),
    job: sum(runs, (r) => r.earned.job),
    odd: sum(runs, (r) => r.earned.odd),
  };
  const jobs: Record<string, number> = {};
  const cards: Record<string, { n: number; value: number }> = {};
  const marketProfit = perGood(() => 0);
  const taggedProfit = Object.fromEntries(["nocoat", "coat", ...BINS.map(([tag]) => tag)].map((tag) => [tag, perGood(() => 0)]));
  const stock = perGood(() => 0);
  for (const r of runs) {
    for (const [outcome, count] of Object.entries(r.jobs)) jobs[outcome] = (jobs[outcome] ?? 0) + count;
    for (const [key, c] of r.cards) {
      const aggregate = cards[key] ?? { n: 0, value: 0 };
      aggregate.n += c.n;
      aggregate.value += c.value;
      cards[key] = aggregate;
    }
    for (const [key, value] of r.routes) marketProfit[key.split(":")[1] as GoodId] += value;
    for (const [key, value] of r.tagged) {
      const [tag, good] = key.split(":") as [string, GoodId];
      taggedProfit[tag]![good] += value;
    }
    for (const g of GOODS) stock[g] += r.supply[g];
  }
  const arrests = runs.flatMap((r) => r.afterArrest);
  const recovered = arrests.flatMap((a) => a.back ?? []);
  const recoveryDays = quantiles(arrests.map((a) => a.back ?? Infinity));
  const samples = workCounts(attempts, requested);
  return {
    name, samples, day5: endOfDay(Math.min(days, 5)), day10: endOfDay(Math.min(days, 10)), endpoint: endOfDay(days),
    upgrades,
    arrests: { count: sum(runs, (r) => r.arrests), perRun: perRun((r) => r.arrests) },
    stops: { count: sum(runs, (r) => r.stops), perRun: perRun((r) => r.stops) },
    afterArrest: {
      eligible: arrests.length, recovered: recovered.length, unrecovered: arrests.length - recovered.length,
      cash: quantiles(arrests.map((a) => a.cash)),
      recoveryDays: {
        p50: recoveryDays.p50 === Infinity ? null : recoveryDays.p50,
        p90: recoveryDays.p90 === Infinity ? null : recoveryDays.p90,
      },
    },
    earnings, tradeHours: sum(runs, (r) => r.tradeHours),
    tradePerHour: quantiles(runs.map((r) => r.earned.trade / Math.max(1, r.tradeHours))),
    topRoute: quantiles(runs.map((r) => r.topRoute)),
    actions: { committed: sum(runs, (r) => r.actions), timed: sum(runs, (r) => r.timed), days: n * days },
    pinch: { cases: perRun((r) => r.cases), closed: perRun((r) => r.closed), stops: perRun((r) => r.pinchStops) },
    jobs, cards, marketProfit, taggedProfit,
    freshStock: { sourceDays: sum(runs, (r) => r.supplyDays), total: stock },
    marketEvents: {
      started: perRun((r) => r.eventsStarted), sameDay: perRun((r) => r.tradedSameDay), later: perRun((r) => r.tradedLater),
    },
  };
}

export function strategyReport(selection: Selection, batches = [strategyRuns(selection)]) {
  const { policies, days, seeds } = selection;
  const results = policies.map((name, i) => summarizePolicy(name, days, batches.flatMap((batch) => batch[i]!), seeds.length));
  return { version: 1, mode: "strategies" as const, ...selection, results };
}

const pocketsBuckets = [
  { label: "<10", includes: (n: number) => n < 10 },
  { label: "10-19", includes: (n: number) => n >= 10 && n < 20 },
  { label: "20+", includes: (n: number) => n >= 20 },
];

function describeDifferences(samples: CardSample[]) {
  const values = samples.map((s) => s.diff!);
  return { ...quantiles(values), mean: mean(values) };
}

function meanInterval(samples: CardSample[], average: number | null): [number, number] | null {
  if (average === null) return null;
  const residuals = new Map<number, number>();
  for (const { seed, diff } of samples) {
    residuals.set(seed, (residuals.get(seed) ?? 0) + (diff! - average));
  }
  const clusters = residuals.size;
  if (clusters < 2) return null;
  // Delta method for total difference / sample count, with a finite-cluster correction.
  const squared = sum([...residuals.values()], (residual) => residual ** 2);
  const margin = 1.96 * Math.sqrt((clusters / (clusters - 1)) * squared) / samples.length;
  return [average - margin, average + margin];
}

export function summarizeChoices(key: string, attempts: CardSample[]) {
  const groups = {
    measured: attempts.filter((s) => s.status === "measured"),
    outstanding: attempts.filter((s) => s.status === "outstanding"),
    cutShort: attempts.filter((s) => s.status === "cutShort"),
    guard: attempts.filter((s) => s.status === "guard"),
    failed: attempts.filter((s) => s.status === "failed"),
  };
  const measured = describeDifferences(groups.measured);
  const incomplete = [...groups.guard, ...groups.failed].map(({ seed, day, take, pass }) => ({
    seed, day, take: take.outcome, pass: pass.outcome,
  }));
  const [card, choice] = key.split(":") as [CardId, string];
  const medianExample = (group: CardSample[]) => {
    const sorted = group.sort((a, b) => a.diff! - b.diff!);
    const example = sorted[Math.floor(sorted.length / 2)];
    return example ? { diff: example.diff!, situation: example.situation } : null;
  };
  const wins = groups.measured.filter((s) => s.diff! > 0);
  const losses = groups.measured.filter((s) => s.diff! < 0);
  return {
    key,
    encounters: new Set(attempts.map(({ seed, day }) => `${seed}:${day}`)).size,
    samples: {
      requested: attempts.length, eligible: attempts.length, completed: attempts.length - incomplete.length,
      measured: measured.n, outstanding: groups.outstanding.length, cutShort: groups.cutShort.length,
      guard: groups.guard.length, failed: groups.failed.length, incomplete,
    },
    diff: { measured, outstanding: describeDifferences(groups.outstanding), cutShort: describeDifferences(groups.cutShort) },
    measuredMean95: meanInterval(groups.measured, measured.mean),
    wins: { take: wins.length, tie: measured.n - wins.length - losses.length, last: losses.length },
    examples: { takes: medianExample(wins), passes: medianExample(losses) },
    byPockets: !CARDS[card].choices.find((c) => c.id === choice)?.effects.some((x) => x.kind === "gain")
      ? [] : pocketsBuckets.map(({ label, includes }) => {
        const values = groups.measured.filter((s) => includes(s.free)).map((s) => s.diff!);
        return { label, n: values.length, mean: mean(values) };
      }),
  };
}

export function cardReport(selection: Selection, batches = [cardRuns(selection)]) {
  const parents = batches.flatMap(({ parents }) => parents);
  const keys = new Set(batches.flatMap(({ samples }) => [...samples.keys()]));
  const choices = [...keys].sort().map((key) => summarizeChoices(key, batches.flatMap(({ samples }) => samples.get(key) ?? [])));
  return {
    version: 2, mode: "cards" as const, ...selection, policies: ["trader"], forksPerShowing: FORKS, loanCutoffDays: LOAN_CUTOFF,
    parents: workCounts(parents, selection.seeds.length),
    comparisons: {
      requested: sum(choices, (c) => c.samples.requested), eligible: sum(choices, (c) => c.samples.eligible),
      completed: sum(choices, (c) => c.samples.completed), measured: sum(choices, (c) => c.samples.measured),
      guard: sum(choices, (c) => c.samples.guard), failed: sum(choices, (c) => c.samples.failed),
      outstanding: sum(choices, (c) => c.samples.outstanding), cutShort: sum(choices, (c) => c.samples.cutShort),
    },
    choices,
  };
}

const k = (n: number | null) => n === null ? "-" : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
const fixed = (n: number | null, digits: number) => n === null ? "-" : n.toFixed(digits);
const percent = (n: number | null, digits: number) => n === null ? "-" : `${(100 * n).toFixed(digits)}%`;
const interval = ({ p10, p50, p90 }: ReturnType<typeof quantiles>) => [k(p10), k(p50), k(p90)].join("/");
const shareLine = (profits: Record<GoodId, number>) => {
  const total = sum(GOODS, (g) => profits[g]);
  return GOODS.map((g) => `${g} ${percent(ratio(profits[g], total), 1)}`).join(" · ");
};

function progressLine(label: string, c: { requested: number; completed: number; guard: number; failed: number }): string {
  return `${label}: ${c.completed}/${c.requested} completed, ${c.guard} guard, ${c.failed} failed`;
}

export function formatStrategies(report: ReturnType<typeof strategyReport>, detail: boolean): string {
  const { days, seeds, seedStart } = report;
  const lines = [
    `days=${days} seeds=${seeds.length} seedStart=${seedStart}; wealth = cash + goods at cost + upgrades at cost, at day end; medians unless noted; >dN = median purchase day beyond the horizon`,
    ["policy".padEnd(15), "cash d5/d10", "d5", "d10", `d${days} p10/med/p90`.padStart(20), "arrests", "stops", "coat", "phone", "crown", "crowned", "cases", "trade$/h", "topRoute med/p90", "trade/job/odd%", "acts/day", "timed/day"].join("  "),
  ];
  for (const r of report.results) {
    const n = r.samples.completed;
    const earned = Object.values(r.earnings);
    const total = sum(earned, (x) => x);
    const crown = r.upgrades.find((u) => u.id === "crown")!;
    lines.push([
      r.name.padEnd(15),
      `${k(r.day5.cash.p50)}/${k(r.day10.cash.p50)}`.padStart(11),
      k(r.day5.wealth.p50).padStart(5), k(r.day10.wealth.p50).padStart(5),
      interval(r.endpoint.wealth).padStart(20),
      fixed(r.arrests.perRun, 2).padStart(7), fixed(r.stops.perRun, 1).padStart(5),
      ...r.upgrades.map((u) => (u.day.p50 !== null ? `d${u.day.p50}` : n > 0 ? `>d${days}` : "-").padStart(5)),
      String(crown.bought).padStart(7), fixed(r.pinch.cases, 2).padStart(5), k(r.tradePerHour.p50).padStart(8),
      `${percent(r.topRoute.p50, 0)}/${percent(r.topRoute.p90, 0)}`.padStart(16),
      earned.map((value) => total === 0 ? "-" : (100 * value / total).toFixed(0)).join("/").padStart(14),
      fixed(ratio(r.actions.committed, r.actions.days), 1).padStart(8),
      fixed(ratio(r.actions.timed, r.actions.days), 1).padStart(9),
    ].join("  "));
    lines.push(progressLine("   samples", r.samples));
    for (const sample of r.samples.incomplete) lines.push(`      seed ${sample.seed} day ${sample.day}: ${sample.end} (${sample.reason})`);
    if (!detail) continue;
    lines.push(
      `   exact: crown median day ${crown.day.p50 ?? (n > 0 ? `>d${days}` : "-")}; trade $/h median ${fixed(r.tradePerHour.p50, 2)}; wealth d${days} median $${r.endpoint.wealth.p50 ?? "-"}; arrests/run ${fixed(r.arrests.perRun, 4)}; top route median ${percent(r.topRoute.p50, 1)}`,
      `   Pinch: ${fixed(r.pinch.cases, 2)} cases/run, ${fixed(r.pinch.closed, 2)} closed, ${fixed(r.pinch.stops, 2)} stops by him; crown bought in ${crown.bought}/${n}`,
    );
    const ar = r.afterArrest;
    if (ar.eligible > 0) {
      lines.push(`   after an arrest (${ar.eligible}): cash at close med $${k(ar.cash.p50)} p10 $${k(ar.cash.p10)}; days back to the pre-arrest wealth med ${ar.recoveryDays.p50 ?? "-"} p90 ${ar.recoveryDays.p90 ?? "-"}; ${ar.unrecovered} did not recover by day ${days}`);
    }
    if (Object.keys(r.jobs).length > 0) lines.push(`   jobs: ${JSON.stringify(r.jobs)}`);
    const cards = Object.entries(r.cards).sort().map(([key, c]) => `${key} ${(c.n / n).toFixed(2)}/run $${Math.round(c.value / c.n)}`);
    if (cards.length > 0) lines.push(`   cards (taken per run, mean immediate value): ${cards.join(" · ")}`);
    const marketTotal = sum(GOODS, (g) => r.marketProfit[g]);
    const shares = GOODS.map((g) => r.marketProfit[g] / marketTotal);
    const range = marketTotal === 0 ? "" : `; min ${percent(Math.min(...shares), 1)} max ${percent(Math.max(...shares), 1)}`;
    lines.push(`   AT2 profit by good (signed market sales): ${shareLine(r.marketProfit)}${range}`);
    for (const [tag, profits] of Object.entries(r.taggedProfit)) {
      lines.push(`   CE2 ${tag.padEnd(6)} ($${k(ratio(sum(GOODS, (g) => profits[g]), n))}/run): ${shareLine(profits)}`);
    }
    lines.push(`   AT7 fresh stock at the source, mean on days 2-${days} (${r.freshStock.sourceDays} seed-days): ${GOODS.map((g) => `${g} ${fixed(ratio(r.freshStock.total[g], r.freshStock.sourceDays), 2)}`).join(" · ")}`);
    const ev = r.marketEvents;
    lines.push(`   AT8 market events per run: ${fixed(ev.started, 2)} started; first traded on ${fixed(ev.sameDay, 2)} on the start day, ${fixed(ev.later, 2)} later`);
  }
  return lines.join("\n");
}

export function formatCards(report: ReturnType<typeof cardReport>): string {
  const lines = [
    `AT5 card values: trader, ${report.seeds.length} seeds × ${report.days} days, ${FORKS} forks per showing; each choice minus the last choice, both played to the next day or the day after loan repayment, subject to the horizon and the ${LOAN_CUTOFF}-day loan cutoff`,
    progressLine("   parent runs", report.parents),
    progressLine("   choice comparisons", report.comparisons),
    ["choice".padEnd(24), "encounters", "forks", "mean", "p10", "p50", "p90", "take/tie/last", "other outcomes"].join("  "),
  ];
  for (const sample of report.parents.incomplete) lines.push(`   seed ${sample.seed} day ${sample.day}: ${sample.end} (${sample.reason})`);
  for (const c of report.choices) {
    const s = c.samples;
    const { measured, outstanding, cutShort } = c.diff;
    const share = (v: number) => percent(ratio(v, s.measured), 0);
    lines.push([
      c.key.padEnd(24), String(c.encounters).padStart(10), String(measured.n).padStart(5),
      ...[measured.mean, measured.p10, measured.p50, measured.p90].map((n) => k(n).padStart(4)),
      `${share(c.wins.take)}/${share(c.wins.tie)}/${share(c.wins.last)}`.padStart(13),
      `outstanding ${s.outstanding}, cut short ${s.cutShort}, guard ${s.guard}, failed ${s.failed}`,
    ].join("  "));
    const mean95 = c.measuredMean95?.map((value) => fixed(value, 2)).join(" to ") ?? "-";
    lines.push(`      measured mean 95% interval: ${mean95}`);
    for (const [label, group] of [["outstanding", outstanding], ["cut short", cutShort]] as const) {
      if (group.n > 0) {
        const percentiles = [group.p10, group.p50, group.p90].map((value) => fixed(value, 2)).join("/");
        lines.push(`      ${label}: n ${group.n}, mean ${fixed(group.mean, 2)}, p10/p50/p90 ${percentiles}`);
      }
    }
    for (const [side, example] of Object.entries(c.examples)) {
      if (example) lines.push(`      ${side} best (${side === "takes" ? c.wins.take : c.wins.last}), median at $${Math.round(example.diff)}: ${example.situation}`);
    }
    if (c.byPockets.length > 0) {
      lines.push(`      by free pockets: ${c.byPockets.map((b) => `${b.label} ${k(b.mean)} (${b.n})`).join(" · ")}`);
    }
    const reasons = new Set(s.incomplete.flatMap(({ take, pass }) =>
      [take, pass].flatMap((branch, index) => branch.end === "endpoint" ? [] : [`${index === 0 ? "take" : "last"}: ${branch.reason}`])));
    if (reasons.size > 0) lines.push(`      ${[...reasons].join(" · ")}`);
  }
  return lines.join("\n");
}
