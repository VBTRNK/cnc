import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CARDS, GOODS, PINCH, RULES, newGame, type Action, type GameState, type PlaceId } from "../src/sim/index.ts";
import { atLeast, below, play, rngWhere } from "../src/sim/testing.ts";
import { Book, POLICIES, decide, plan } from "../scripts/strategy-policy.ts";
import { compareCard, marketSnapshot, openingSnapshot, runOne, selectRun, type CardSample } from "../scripts/strategy-runner.ts";
import { cardReport, formatCards, strategyReport, summarizeChoices, summarizePolicy } from "../scripts/strategy-report.ts";
import { selectWorkers } from "../scripts/strategy-worker.ts";

const seed = 7919;
const trader = POLICIES.trader!;
const oddJobsOnly = POLICIES.oddJobsOnly!;

describe("seed selection and reports", () => {
  it("chooses worker counts for small and explicitly sized runs", () => {
    for (const seeds of [1, 2, 3]) expect(selectWorkers(seeds)).toBe(1);
    expect(selectWorkers(3, "2")).toBe(2);
    expect(selectWorkers(4, "12")).toBe(4);
  });

  it("preserves the released first seeds and supports disjoint ranges", () => {
    expect(selectRun("30", "3", undefined, "oddJobsOnly,trader")).toEqual({
      days: 30, seeds: [7919, 15838, 23757], seedStart: 1, policies: ["trader", "oddJobsOnly"],
    });
    expect(selectRun("30", "2", "4", "trader").seeds).toEqual([31676, 39595]);
    for (const args of [["0", "1"], ["-1", "1"], ["3.5", "1"], ["2", "NaN"], ["2", "0"], ["2", "1", "0"]] as const) {
      expect(() => selectRun(...args)).toThrow("must be a positive integer");
    }
    expect(() => selectRun("1", "1", "1", "trader,noSuchPolicy")).toThrow('unknown policy: "noSuchPolicy"');
    expect(() => selectRun("1", "1", "1", "toString")).toThrow("unknown policy");
  });

  it("keeps provenance outside deterministic data and counts an unbought Crown", () => {
    const selection = selectRun("2", "2", "4", "oddJobsOnly");
    const report = strategyReport(selection);
    expect(JSON.stringify(report)).toBe(JSON.stringify(strategyReport(selection)));
    expect(report).toMatchObject({ ...selection, mode: "strategies", results: [{
      samples: { requested: 2, eligible: 2, completed: 2, failed: 0, guard: 0 },
      upgrades: expect.arrayContaining([{ id: "crown", bought: 0, unreached: 2, day: { p10: null, p50: null, p90: null } }]),
      endpoint: { day: 2, wealth: { n: 2 } },
      freshStock: { sourceDays: 2 },
    }] });
  });

  it.each(["strategies", "cards"])("writes identical %s JSON with one or three workers", (mode) => {
    const dir = mkdtempSync(join(tmpdir(), "cnc-workers-"));
    const path = join(dir, "report.json");
    const run = (workers: string) => {
      const result = spawnSync(process.execPath, ["scripts/strategies.ts", "5", "6"], {
        cwd: new URL("../", import.meta.url),
        env: {
          ...process.env, CARDS: mode === "cards" ? "1" : "", DETAIL: "", ONLY: "trader,dailyJob",
          OPENING: "", REPORT: path, SEED_START: "2", WORKERS: workers,
        },
        encoding: "utf8",
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain(`workers ${workers};`);
      return readFileSync(path);
    };
    try {
      expect(run("3")).toEqual(run("1"));
    } finally {
      if (existsSync(path)) unlinkSync(path);
      rmdirSync(dir);
    }
  }, 15_000);
});

describe("opening parity", () => {
  it("captures every pair, source, quote and scheduled event at opening and on seeded day 2", async () => {
    const day1 = openingSnapshot(seed);
    expect(day1).toEqual(marketSnapshot(newGame(seed, "app")));
    expect(day1.places[0]?.pairs.slice(0, 4).map((p) => p.freshStock)).toEqual([20, 3, 2, 0]);
    const day2 = marketSnapshot(play(newGame(seed, "app"), { type: "callItADay" }, { type: "startDay" }).state);
    const lines = [day1, day2].flatMap(({ day, hour, place, cash, events, places }) => [
      `day ${day} hour ${hour}, ${place}, $${cash}`,
      JSON.stringify(events),
      "good,dealt/source,baseline/price,fresh/remaining stock,fresh/remaining demand,local quote price/day/hour",
      ...places.flatMap(({ place, dealt, pairs }) => [
        `${place} (${dealt} dealt)`,
        ...pairs.map((p) => [
          p.good, `${Number(p.dealt)}/${Number(p.source)}`, `${p.baseline}/${p.price ?? "-"}`,
          `${p.freshStock}/${p.stock}`, `${p.freshDemand}/${p.demand}`,
          p.quote ? `${p.quote.price}/${p.quote.day}/${p.quote.hour}` : "-",
        ].join(",")),
      ]),
      "",
    ]);
    await expect(lines.join("\n")).toMatchFileSnapshot("./fixtures/strategy-markets.txt");
  });

  it("reflects source edits in a fresh process while preserving authored quotes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cnc-opening-"));
    const folders = ["src", "src/sim", "scripts"];
    const files = [
      "src/sim/cards.ts", "src/sim/content.ts", "src/sim/detective.ts", "src/sim/index.ts", "src/sim/market.ts",
      "src/sim/rng.ts", "src/sim/save.ts", "src/sim/sim.ts", "src/sim/state.ts",
      "scripts/strategy-policy.ts", "scripts/strategy-runner.ts",
    ];
    const written: string[] = [];
    const created: string[] = [];
    try {
      for (const folder of folders) {
        mkdirSync(join(dir, folder));
        created.push(folder);
      }
      writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
      written.push("package.json");
      for (const file of files) {
        let source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
        if (file === "src/sim/content.ts") {
          const edits = [
            [/^  smokes: good\(8,/m, "  smokes: good(12,"],
            [/^(  smokes: .*?)\[20, 6\]/m, "$1[22, 6]"],
            [/^(  tapes: .*?)\[12, 3\]/m, "$1[12, 4]"],
            [/^(  watches: .*?)\[4, 1\]/m, "$1[6, 1]"],
            [/^  soda: good\(20, 6,/m, "  soda: good(24, 7,"],
          ] as const;
          for (const [from, to] of edits) {
            expect(source).toMatch(from);
            source = source.replace(from, to);
          }
        }
        writeFileSync(join(dir, file), source);
        written.push(file);
      }
      const patched = JSON.parse(execFileSync(process.execPath, [
        "--input-type=module", "-e",
        'import { openingSnapshot } from "./scripts/strategy-runner.ts"; process.stdout.write(JSON.stringify(openingSnapshot(7919)));',
      ], { cwd: dir, encoding: "utf8" })) as ReturnType<typeof openingSnapshot>;
      const docks = patched.places.find((p) => p.place === "docks")!;
      const pair = (good: string) => docks.pairs.find((p) => p.good === good);
      expect(docks.dealt).toBe(10);
      expect(docks.pairs.slice(0, 4).map((p) => p.freshStock)).toEqual([22, 4, 3, 0]);
      expect(patched.places.map((p) => p.pairs.slice(0, 4).map((pair) => pair.price))).toEqual([
        [7, 15, 43, 85], [8, 13, 50, 112], [9, 16, 59, 100], [9, 18, 52, 118],
      ]);
      expect(docks.pairs.slice(0, 4).map((p) => p.quote?.price)).toEqual([7, 15, 43, 85]);
      expect(pair("soda")).toMatchObject({ price: 20, demand: 18, quote: { price: 20 } });
      expect(pair("ebikes")).toMatchObject({ dealt: true, source: false, stock: 0, demand: 2, price: 495 });
      expect(pair("gum")).toMatchObject({ dealt: false, source: false, stock: 0, demand: 0, price: null, quote: null });
    } finally {
      for (const file of written) unlinkSync(join(dir, file));
      for (const folder of created.reverse()) rmdirSync(join(dir, folder));
      rmdirSync(dir);
    }
  });
});

function lateMarket(hour = 20) {
  const start = newGame(seed, "late");
  start.hour = hour;
  start.events = [];
  start.rng = rngWhere(atLeast(0.99));
  for (const good of GOODS) start.market.docks[good].stock = 0;
  start.market.docks.smokes.stock = 11;
  start.market.docks.tapes.stock = 8;
  start.market.docks.tapes.baseline = 16;
  return start;
}

function stockUp(s: GameState, ...actions: Action[]) {
  const book = new Book();
  const { state, events } = play(s, ...actions);
  for (const e of events) book.record(e, s.place);
  return { state, book };
}

const strip: PlaceId = "strip";

describe("one-trip sale forecasts", () => {
  it("follows the same whole-hour ranking through the committed last sale", () => {
    const { state: docks, book } = stockUp(lateMarket(),
      { type: "buy", good: "smokes", units: 11 }, { type: "buy", good: "tapes", units: 8 });
    expect(plan(docks, book)).toMatchObject({
      to: strip, buys: {}, gain: 20, sales: [{ good: "smokes", units: 10, hours: 1, profit: 20 }],
    });
    docks.market.docks.smokes.demand = 0;
    docks.market.docks.tapes.demand = 0;
    const travel = decide(docks, trader, book, []);
    expect(travel).toEqual({ type: "travel", to: strip });
    const { state } = play(docks, travel);
    const sell = decide(state, trader, book, []);
    expect(sell).toEqual({ type: "sell", good: "smokes", units: 10 });
    const outcome = play(state, sell);
    expect(outcome.events).toContainEqual({ type: "sold", good: "smokes", units: 10, cost: 70, proceeds: 90, hours: 1 });
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: "dayEnded" }));
  });

  it("budgets only planned purchases and combines lots of one good", () => {
    const { state, book } = stockUp(lateMarket(), { type: "buy", good: "smokes", units: 4 });
    state.market.docks.smokes.baseline = 8;
    state.memory.strip.smokes = { price: 10, day: 1, hour: 20 };
    state.market.strip.smokes.baseline = 10;
    const forecast = plan(state, book);
    expect(forecast).toMatchObject({ to: strip, buys: { smokes: 6 }, gain: 24, sales: [{ good: "smokes", units: 10, hours: 1 }] });
    const { state: there, events } = play(state, { type: "buy", good: "smokes", units: 6 }, { type: "travel", to: strip });
    for (const e of events) book.record(e, "docks");
    const action = decide(there, trader, book, []);
    expect(action).toEqual({ type: "sell", good: "smokes", units: 10 });
    expect(play(there, action).events).toContainEqual(expect.objectContaining({ type: "sold", cost: 76, proceeds: 100 }));
  });

  it("caps the forecast at neutral remote demand and the sale at live demand, with stable ties", () => {
    const { state: docks, book } = stockUp(lateMarket(),
      { type: "buy", good: "smokes", units: 11 }, { type: "buy", good: "tapes", units: 8 });
    docks.market.strip.smokes.demand = 8;
    const forecast = plan(docks, book);
    expect(forecast?.sales[0]?.units).toBe(10);
    const { state: there } = play(docks, { type: "travel", to: strip });
    // Both sales now earn $16 in one hour. Smokes precede tapes in GOODS.
    expect(decide(there, trader, book, [])).toEqual({ type: "sell", good: "smokes", units: 8 });
    there.market.strip.smokes.demand = 7;
    expect(decide(there, trader, book, [])).toEqual({ type: "sell", good: "tapes", units: 8 });

    const lowRate = lateMarket(18);
    lowRate.upgrades = ["coat"];
    lowRate.cash = 10_000;
    lowRate.market.docks.watches.stock = 20;
    lowRate.memory.strip.watches = { price: 90, day: 1, hour: 18 };
    expect(plan(lowRate, new Book())).toMatchObject({ to: strip, buys: { watches: 12 } });
  });

  it("keeps split sales workable for goods that take more than an hour per unit", () => {
    const start = newGame(seed, "slow-good");
    start.place = "uptown";
    start.cash = 600;
    start.hour = 20;
    const { state, book } = stockUp(start, { type: "buy", good: "ebikes", units: 1 });
    state.market.uptown.ebikes.baseline += 40;
    expect(decide(state, POLICIES.splitSales!, book, [])).toEqual({ type: "sell", good: "ebikes", units: 1 });
    state.hour = 21;
    expect(decide(state, POLICIES.splitSales!, book, [])).not.toMatchObject({ type: "sell" });
  });

  it("reacts to stale quotes, an event on arrival, and a stopped sale", () => {
    const { state, book } = stockUp(lateMarket(),
      { type: "buy", good: "smokes", units: 11 }, { type: "buy", good: "tapes", units: 8 });
    state.memory.strip.smokes = { price: 6, day: 1, hour: 10 };
    expect(plan(state, book)?.sales[0]?.good).toBe("tapes");
    const arrived = play(state, { type: "travel", to: strip }).state;
    expect(decide(arrived, trader, book, [])).toEqual({ type: "sell", good: "smokes", units: 10 });

    const midday = { ...state, hour: RULES.midday - 1, memory: structuredClone(state.memory) };
    midday.memory.strip.smokes = { price: 9, day: 1, hour: 10 };
    midday.events = [{
      id: "tapes-glut", kind: "glut", slot: "midday", place: strip, good: "tapes",
      startDay: 1, startHour: RULES.midday, endDay: 2, activated: false,
    }];
    expect(plan(midday, book)?.sales[0]?.good).toBe("tapes");
    const eventTrip = play(midday, { type: "travel", to: strip });
    expect(eventTrip.events).toContainEqual(expect.objectContaining({ type: "eventStarted" }));
    expect(decide(eventTrip.state, trader, book, [])).toMatchObject({ type: "sell", good: "smokes" });

    arrived.rng = rngWhere(below(0.001), atLeast(0.99));
    const stopped = play(arrived, { type: "sell", good: "smokes", units: 10 });
    expect(stopped.events).toContainEqual(expect.objectContaining({ type: "stopped" }));
    expect(stopped.events.some((e) => e.type === "sold")).toBe(false);
    expect(stopped.state.held.smokes).toBe(11);
  });
});

describe("run and comparison endpoints", () => {
  it("stops on the committed fallback and never starts the next morning", () => {
    const start = newGame(seed, "fallback");
    start.upgrades = ["crown"];
    start.cash = 50;
    const run = runOne("trader", trader, seed, 1, { start, pick: () => ({ type: "buyUpgrade", upgrade: "coat" }) });
    expect(run.outcome).toEqual({ end: "endpoint", day: 1 });
    expect(run.actions).toBe(1);
    expect(run.supplyDays).toBe(0);
    expect(run.cash[1]).toBe(50 + PINCH.crownTakings);
    expect(run.wealth[1]).toBe(run.cash[1]! + 2500);
  });

  it("samples after an arrest removes the inventory and fine", () => {
    const { state: start, book } = stockUp(lateMarket(), { type: "buy", good: "smokes", units: 10 });
    start.place = strip;
    start.hour = 21;
    start.rng = rngWhere(below(0.001), atLeast(0.99));
    const expected = play(start, { type: "sell", good: "smokes", units: 10 }, { type: "resolveStop", choice: "legIt" });
    expect(expected.events.some((event) => event.type === "arrested")).toBe(true);
    const run = runOne("trader", POLICIES.alwaysRun!, seed, 1, { start, book });
    expect(run).toMatchObject({ outcome: { end: "endpoint", day: 1 }, arrests: 1, stops: 1, actions: 2 });
    expect(run.cash[1]).toBe(expected.state.cash);
    expect(run.wealth[1]).toBe(expected.state.cash);
  });

  it("tracks both recovery episodes when another arrest precedes recovery", () => {
    const run = runOne("trader", trader, 23757, 11);
    expect(run.arrests).toBe(2);
    expect(run.wealth[3]).toBe(890);
    expect(run.wealth[9]).toBe(893);
    expect(run.afterArrest[0]).toEqual({ cash: 229, back: 5 });
    expect(run.afterArrest[1]?.back).toBeGreaterThan(0);
    expect(summarizePolicy("trader", 11, [run]).afterArrest).toMatchObject({
      eligible: 2, recovered: 2, unrecovered: 0,
    });
  });

  it("shows guard and failure without polluting wealth or Crown counts", () => {
    const complete = runOne("trader", trader, seed, 1);
    const guard = runOne("trader", trader, seed + 1, 1, { maxSteps: 0 });
    const start = newGame(seed + 2, "stuck");
    start.pending = { kind: "card", card: "churchRoof", odds: null };
    const failed = runOne("trader", trader, seed + 2, 1, {
      start, pick: () => ({ type: "resolveCard", choice: "unavailable-id" }),
    });
    const report = summarizePolicy("trader", 1, [complete, guard, failed]);
    expect(report.samples).toMatchObject({
      requested: 3, eligible: 3, completed: 1, guard: 1, failed: 1,
      incomplete: [{ end: "guard", reason: "step limit 0" }, { end: "failed", reason: expect.stringContaining("fallback") }],
    });
    expect(report.endpoint.wealth).toEqual({ n: 1, p10: complete.wealth[1], p50: complete.wealth[1], p90: complete.wealth[1] });
    expect(report.upgrades.find((u) => u.id === "crown")).toMatchObject({ bought: 0, unreached: 1 });
  });

  it("matches next-day branches and marks the pair cut short at the horizon", () => {
    const start = newGame(seed, "roof");
    start.cash = 700;
    start.pending = { kind: "card", card: "churchRoof", odds: null };
    const match = compareCard(start, new Book(), oddJobsOnly, "give", "walkOn", 8970, 2);
    expect(match).toMatchObject({
      status: "measured", diff: -50, take: { outcome: { end: "endpoint", day: 2 } }, pass: { outcome: { end: "endpoint", day: 2 } },
    });
    const cut = compareCard(start, new Book(), oddJobsOnly, "give", "walkOn", 8970, 1);
    expect(cut).toMatchObject({ status: "cutShort", take: { outcome: { day: 1 } }, pass: { outcome: { day: 1 } } });
  });

  it("retains every attempt when the actual last choice is refused", () => {
    const card = CARDS.churchRoof;
    const last = card.choices.at(-1)!;
    const effects = last.effects;
    last.effects = [{ kind: "cash", amount: -100_000 }];
    try {
      const report = cardReport(selectRun("5", "2"));
      expect(report.parents.completed).toBe(2);
      const refused = report.choices.find((c) => c.key === "churchRoof:give")!;
      expect(refused.samples).toMatchObject({ requested: 4, eligible: 4, completed: 0, measured: 0, failed: 4 });
      expect(refused.samples.incomplete[0]?.pass).toMatchObject({ end: "failed", reason: "resolveCard walkOn: unavailable" });
      expect(refused.diff.measured).toEqual({ n: 0, p10: null, p50: null, p90: null, mean: null });
      expect(refused.measuredMean95).toBeNull();
      expect(formatCards(report)).toContain("last: resolveCard walkOn: unavailable");
      expect(report.comparisons.requested).toBe(report.comparisons.completed + report.comparisons.failed + report.comparisons.guard);
    } finally {
      last.effects = effects;
    }
  });

  it("matches the day after repayment and distinguishes truncated and outstanding loans", () => {
    const start = newGame(seed, "loan");
    start.cash = 600;
    start.cards.oldMate = 1;
    start.pending = { kind: "card", card: "oldMate", odds: null };
    const result = (rng: number, horizon: number) => compareCard(start, new Book(), oddJobsOnly, "lend", "notNow", rng, horizon);
    expect(result(8970, 15)).toMatchObject({
      status: "measured", diff: 50, take: { repaid: 5, outcome: { day: 6 } }, pass: { outcome: { day: 6 } },
    });
    const cut = result(8970, 5);
    expect(cut).toMatchObject({ status: "cutShort", take: { repaid: 5, outcome: { day: 5 } }, pass: { outcome: { day: 5 } } });
    const early = result(8970, 4);
    expect(early).toMatchObject({ status: "cutShort", take: { repaid: null, outcome: { day: 4 } }, pass: { outcome: { day: 4 } } });
    const outstanding = result(60, 15);
    expect(outstanding).toMatchObject({
      status: "outstanding", diff: -100, take: { repaid: null, outcome: { day: 15 } }, pass: { outcome: { day: 15 } },
    });
    const summary = summarizeChoices("oldMate:lend", [cut, early, outstanding].map((sample) => ({
      seed, day: 1, situation: "", free: 20, ...sample,
    })));
    expect(summary.samples).toMatchObject({ eligible: 3, completed: 3, cutShort: 2, measured: 0, outstanding: 1 });
  });

  it("counts unique encounters and estimates the measured mean by parent seed", () => {
    const sample = (seed: number, day: number, status: CardSample["status"], diff: number): CardSample => {
      const endpoint = { outcome: { end: "endpoint", day: 6 }, value: 0, repaid: null } as const;
      return { seed, day, status, diff, situation: "", free: 20, take: { ...endpoint, value: diff }, pass: endpoint };
    };
    const sameSeed = [sample(1, 1, "measured", 10), sample(1, 1, "measured", 20), sample(1, 2, "measured", 30)];
    const summary = summarizeChoices("oldMate:lend", [
      ...sameSeed, sample(2, 1, "measured", 60), sample(2, 1, "outstanding", -100), sample(3, 1, "cutShort", -20),
    ]);
    expect(summary.encounters).toBe(4);
    expect(summary.diff).toEqual({
      measured: { n: 4, mean: 30, p10: 10, p50: 30, p90: 60 },
      outstanding: { n: 1, mean: -100, p10: -100, p50: -100, p90: -100 },
      cutShort: { n: 1, mean: -20, p10: -20, p50: -20, p90: -20 },
    });
    // Cluster residuals are -30 and +30, giving a standard error of 15.
    expect(summary.measuredMean95?.[0]).toBeCloseTo(0.60);
    expect(summary.measuredMean95?.[1]).toBeCloseTo(59.40);
    expect(summarizeChoices("oldMate:lend", sameSeed).measuredMean95).toBeNull();
  });
});
