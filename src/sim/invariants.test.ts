// Seeded random play over many runs: every reachable state must keep the rules'
// invariants, conserve cash and goods, honour the event schedule and survive a save.

import { GOODS, PLACES, RULES, UPGRADES } from "./content.ts";
import { Rng } from "./rng.ts";
import { loadSave, toSave, validateState } from "./save.ts";
import { carried, check, maxBuy, maxSale, newGame, pockets, step, stored, type Action, type DomainEvent } from "./sim.ts";
import type { GameState, WorldEvent } from "./state.ts";

const SEEDS = 150;
const DAYS = 12;

function randomAction(s: GameState, r: Rng): Action {
  if (s.phase === "night") return { type: "startDay" };
  if (s.pending) return { type: "resolveStop", choice: r.pick(["bribe", "legIt", "handOver"] as const) };
  const good = r.pick(GOODS);
  const options: Action[] = [
    { type: "buy", good, units: Math.max(1, r.int(1, Math.max(1, maxBuy(s, good)))) },
    { type: "sell", good, units: Math.max(1, r.int(1, Math.max(1, maxSale(s, good)))) },
    { type: "sell", good, units: Math.max(1, maxSale(s, good)) },
    { type: "travel", to: r.pick(PLACES) },
    { type: "askAround" },
    { type: "lieLow" },
    { type: "oddJob" },
    { type: "pullJob" },
    { type: "buyUpgrade", upgrade: r.pick(UPGRADES) },
    { type: "stash", good, units: r.int(1, 10) },
    { type: "unstash", good, units: r.int(1, 10) },
  ];
  if (r.chance(0.05)) return { type: "callItADay" };
  // Some invalid actions on purpose: they must change nothing.
  return r.pick(options);
}

interface Ledger {
  cash: number;
  goods: Record<string, number>;
}

function account(ledger: Ledger, e: DomainEvent): void {
  switch (e.type) {
    case "bought":
      ledger.cash -= e.cost;
      ledger.goods[e.good]! += e.units;
      break;
    case "sold":
      ledger.cash += e.proceeds;
      ledger.goods[e.good]! -= e.units;
      break;
    case "oddJob":
    case "job":
      ledger.cash += e.pay;
      break;
    case "bribed":
      ledger.cash -= e.amount;
      break;
    case "upgraded":
      ledger.cash -= e.cost;
      break;
    case "arrested":
      ledger.cash -= e.fine;
      for (const g of GOODS) ledger.goods[g]! -= e.seized[g];
      break;
    case "handedOver":
      for (const g of GOODS) ledger.goods[g]! -= e.seized[g];
      break;
  }
}

function checkState(s: GameState): void {
  expect(validateState(s)).toBeNull();
  expect(Number.isInteger(s.cash) && s.cash >= 0).toBe(true);
  expect(carried(s)).toBeLessThanOrEqual(pockets(s));
  expect(stored(s)).toBeLessThanOrEqual(RULES.lockupCapacity);
  expect(s.heat).toBeGreaterThanOrEqual(0);
  expect(s.heat).toBeLessThanOrEqual(100);
  for (const p of PLACES) {
    for (const g of GOODS) {
      expect(s.market[p][g].stock).toBeGreaterThanOrEqual(0);
      expect(s.market[p][g].demand).toBeGreaterThanOrEqual(0);
    }
  }
}

const lifetime = (e: WorldEvent): [number, number] => [e.startDay * 24 + e.startHour, e.endDay * 24 + 22];
const overlap = (a: WorldEvent, b: WorldEvent) => {
  const [a0, a1] = lifetime(a);
  const [b0, b1] = lifetime(b);
  return a0 <= b1 && b0 <= a1;
};

function runOne(seed: number) {
  const policy = new Rng(seed * 31 + 7);
  let s = newGame(seed, `run-${seed}`);
  // A third of the runs start rich, so the upgrades and the lock-up get used.
  if (seed % 3 === 0) s.cash = 6000;
  const ledger: Ledger = { cash: s.cash, goods: Object.fromEntries(GOODS.map((g) => [g, 0])) };
  const everyEvent = new Map<string, WorldEvent>();
  const actions: Action[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (s.day <= DAYS && guard++ < 5000) {
    for (const e of s.events) everyEvent.set(e.id, e);
    const action = randomAction(s, policy);
    const before = structuredClone(s);
    const r = step(s, action);
    if (!r.ok) {
      expect(check(s, action)).toBe(r.reason);
      expect(s).toEqual(before);
      continue;
    }
    actions.push(action);
    for (const e of r.events) {
      account(ledger, e);
      seen.add(e.type === "job" ? `job:${e.outcome}` : e.type === "dayEnded" ? `end:${e.cause}` : e.type);
    }
    s = r.state;
    checkState(s);
    expect(s.cash).toBe(ledger.cash);
    for (const g of GOODS) expect(s.held[g] + s.lockup[g]).toBe(ledger.goods[g]);
  }
  return { final: s, events: [...everyEvent.values()], actions, seen };
}

describe(`random play, ${SEEDS} seeds × ${DAYS} days`, () => {
  const runs = Array.from({ length: SEEDS }, (_, i) => runOne(i + 1));

  it("keeps every invariant and conserves cash and goods (checked after each step)", () => {
    expect(runs.every((r) => r.final.day > DAYS)).toBe(true);
  });

  it("reaches every branch, the rare ones included", () => {
    const seen = new Set(runs.flatMap((r) => [...r.seen]));
    for (const branch of [
      "stopped", "pattedDown", "bribed", "leggedIt", "handedOver", "arrested", "upgraded", "stashed", "unstashed",
      "levelUp", "tip", "job:success", "job:nothing", "job:hurt", "job:arrested",
      "end:clock", "end:called", "end:arrest", "end:hurt",
    ]) {
      expect(seen, branch).toContain(branch);
    }
  });

  it("schedules at most one morning event and one midday item per day, never overlapping", () => {
    for (const { events } of runs) {
      for (const slot of ["morning", "midday"] as const) {
        const days = events.filter((e) => e.slot === slot).map((e) => e.startDay);
        expect(new Set(days).size).toBe(days.length);
      }
      const market = events.filter((e) => e.kind === "shortage" || e.kind === "glut");
      const sweeps = events.filter((e) => e.kind === "sweep");
      for (const [i, a] of market.entries()) {
        for (const b of market.slice(i + 1)) {
          if ("good" in a && "good" in b && a.place === b.place && a.good === b.good) expect(overlap(a, b)).toBe(false);
        }
      }
      for (const [i, a] of sweeps.entries()) {
        for (const b of sweeps.slice(i + 1)) if (a.place === b.place) expect(overlap(a, b)).toBe(false);
      }
    }
  });

  it("is deterministic: replaying the actions gives the same final state", () => {
    for (const { final, actions } of runs.slice(0, 20)) {
      const seed = Number(final.runId.slice(4));
      let s = newGame(seed, final.runId);
      if (seed % 3 === 0) s.cash = 6000;
      for (const a of actions) {
        const r = step(s, a);
        if (!r.ok) throw new Error(r.reason);
        s = r.state;
      }
      expect(s).toEqual(final);
    }
  });

  it("round-trips every final state through a save", () => {
    for (const { final } of runs) expect(loadSave(toSave(final))).toEqual({ ok: true, state: final, migratedFrom: null });
  });
});
