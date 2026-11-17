// Strategy runs over many seeds, on the real simulation (docs/design.md, "To verify").
// Usage: node scripts/strategies.ts [days=20] [seeds=400]   ONLY=name,name to pick policies.
// The planner is greedy and one trip deep and knows only what a player could see: prices
// where it stands, prices last seen elsewhere, every price with the phone. A person can beat it.

import {
  GOOD,
  GOODS,
  PLACE,
  PLACES,
  RULES,
  UPGRADE_COST,
  carried,
  has,
  hoursLeft,
  maxBuy,
  maxSale,
  newGame,
  pockets,
  price,
  quoteJob,
  ringDistance,
  step,
  type Action,
  type DomainEvent,
  type GameState,
  type GoodId,
  type PlaceId,
  type UpgradeId,
} from "../src/sim/index.ts";

const DAYS = Number(process.argv[2] ?? 20);
const SEEDS = Number(process.argv[3] ?? 400);

interface Policy {
  order: UpgradeId[];
  /** Lie low at this heat or above; null never. */
  lieLowAt: number | null;
  /** Call it a day at this heat or above instead; null never. */
  endAt: number | null;
  stop: "bribeElseRun" | "handOver" | "run";
  jobs: "floor" | "daily" | "never";
  split: boolean;
  shuttle: boolean;
}

const BASE: Policy = { order: ["coat", "phone"], lieLowAt: 45, endAt: null, stop: "bribeElseRun", jobs: "floor", split: false, shuttle: false };
const POLICIES: Record<string, Policy> = {
  trader: BASE,
  phoneFirst: { ...BASE, order: ["phone", "coat"] },
  neverLieLow: { ...BASE, lieLowAt: null },
  endEarly: { ...BASE, lieLowAt: null, endAt: 45 },
  handOver: { ...BASE, stop: "handOver" },
  alwaysRun: { ...BASE, stop: "run" },
  splitSales: { ...BASE, split: true },
  dailyJob: { ...BASE, jobs: "daily" },
  shuttle: { ...BASE, shuttle: true },
  oddJobsOnly: { ...BASE, order: [], jobs: "never" },
  jobsAndOddJobs: { ...BASE, order: [], jobs: "daily" },
};

// ---- What the player knows ----------------------------------------------------------

function known(s: GameState, place: PlaceId, good: GoodId): number {
  if (place === s.place || has(s, "phone")) return price(s, place, good);
  return s.memory[place][good]?.price ?? Math.round(GOOD[good].base * PLACE[place].factor[good]);
}
const expectedDemand = (s: GameState, place: PlaceId, good: GoodId): number =>
  place === s.place ? s.market[place][good].demand : Math.round(GOOD[good].rate * 4 * PLACE[place].factor[good]);

// ---- Book-keeping: lots with their origin, for cost basis and route profit ----------

interface Lot {
  units: number;
  cost: number;
  from: PlaceId;
}

class Book {
  lots: Record<GoodId, Lot[]> = { smokes: [], tapes: [], watches: [], fireworks: [] };
  routes = new Map<string, number>();
  earned = { trade: 0, job: 0, odd: 0 };

  basis(g: GoodId): number {
    const units = this.lots[g].reduce((n, l) => n + l.units, 0);
    return units === 0 ? 0 : this.lots[g].reduce((n, l) => n + l.units * l.cost, 0) / units;
  }
  atCost(): number {
    return GOODS.reduce((sum, g) => sum + this.lots[g].reduce((n, l) => n + l.units * l.cost, 0), 0);
  }
  take(g: GoodId, units: number, onLot: (lot: Lot, n: number) => void): void {
    let left = units;
    while (left > 0) {
      const lot = this.lots[g][0];
      if (!lot) throw new Error("book out of step");
      const n = Math.min(left, lot.units);
      onLot(lot, n);
      lot.units -= n;
      left -= n;
      if (lot.units === 0) this.lots[g].shift();
    }
  }
  record(e: DomainEvent, at: PlaceId): void {
    if (e.type === "bought") this.lots[e.good].push({ units: e.units, cost: e.cost / e.units, from: at });
    else if (e.type === "sold") {
      const unit = e.proceeds / e.units;
      this.take(e.good, e.units, (lot, n) => {
        const profit = n * (unit - lot.cost);
        this.earned.trade += profit;
        const key = `${lot.from}>${at}:${e.good}`;
        this.routes.set(key, (this.routes.get(key) ?? 0) + profit);
      });
    } else if (e.type === "arrested" || e.type === "handedOver") {
      // Seizure takes carried goods; the lots don't know pockets from the lock-up, so take the oldest.
      for (const g of GOODS) if (e.seized[g] > 0) this.take(g, e.seized[g], () => {});
    } else if (e.type === "job") this.earned.job += e.pay;
    else if (e.type === "oddJob") this.earned.odd += e.pay;
  }
}

// ---- The planner ---------------------------------------------------------------------

interface Plan {
  to: PlaceId;
  buys: Partial<Record<GoodId, number>>;
  score: number;
}

const unitsPerHour = (s: GameState, g: GoodId): number => (GOOD[g].rate * (10 + Math.min(5, RULES.levels.filter((t) => s.xp.patter >= t).length))) / 10;

function plan(s: GameState, book: Book): Plan | null {
  let best: Plan | null = null;
  for (const to of PLACES) {
    const travel = ringDistance(s.place, to);
    if (travel >= hoursLeft(s)) continue;
    let cash = s.cash;
    let room = pockets(s) - carried(s);
    let left = hoursLeft(s) - travel;
    let gain = 0;
    let hours = travel;
    const buys: Partial<Record<GoodId, number>> = {};
    const toSell: [GoodId, number, number][] = []; // good, units, unit cost
    for (const g of GOODS) {
      if (s.held[g] > 0 && (known(s, to, g) > book.basis(g) * 1.05 || left <= 2)) toSell.push([g, s.held[g], book.basis(g)]);
    }
    if (to !== s.place) {
      const options = GOODS.map((g) => ({ g, here: price(s, s.place, g), there: known(s, to, g) }))
        .filter((o) => o.there - o.here > 0.15 * o.here)
        .sort((a, b) => (b.there - b.here) * GOOD[b.g].rate - (a.there - a.here) * GOOD[a.g].rate);
      for (const { g, here } of options) {
        const q = Math.max(0, Math.min(s.market[s.place][g].stock, Math.floor(cash / here), room, expectedDemand(s, to, g) - s.held[g]));
        if (q > 0) {
          buys[g] = q;
          cash -= q * here;
          room -= q;
          toSell.push([g, q, here]);
        }
      }
    }
    for (const [g, units, cost] of toSell) {
      const n = Math.min(units, expectedDemand(s, to, g), Math.floor(left * unitsPerHour(s, g)));
      if (n <= 0) continue;
      const h = Math.ceil(n / unitsPerHour(s, g));
      left -= h;
      hours += h;
      gain += n * (known(s, to, g) - cost);
    }
    if (hours === 0) continue;
    const score = gain / hours;
    if (!best || score > best.score) best = { to, buys, score };
  }
  return best;
}

// ---- A policy as a function from state to the next action -----------------------------

function decide(s: GameState, p: Policy, book: Book, queue: Action[]): Action {
  if (s.phase === "night") return { type: "startDay" };
  if (s.pending) {
    if (p.stop === "handOver") return { type: "resolveStop", choice: "handOver" };
    if (p.stop === "bribeElseRun" && s.pending.bribe !== null) return { type: "resolveStop", choice: "bribe" };
    return { type: "resolveStop", choice: "legIt" };
  }
  const next = queue.shift();
  if (next) return next;

  for (const u of p.order) {
    if (has(s, u)) continue;
    if (s.cash >= UPGRADE_COST[u] + 300) return { type: "buyUpgrade", upgrade: u };
    break;
  }
  if (p.endAt !== null && s.heat >= p.endAt) return { type: "callItADay" };
  if (p.lieLowAt !== null && s.heat >= p.lieLowAt && hoursLeft(s) >= RULES.lieLowHours) return { type: "lieLow" };

  const job = quoteJob(s);
  if (typeof job !== "string" && job.success >= 50) {
    if (p.jobs === "daily" && s.hour === RULES.dayStart) return { type: "pullJob" };
    if (p.jobs === "floor" && s.cash < 150 && carried(s) === 0) return { type: "pullJob" };
  }
  if (p.order.length === 0) return hoursLeft(s) >= RULES.oddJobHours ? { type: "oddJob" } : { type: "callItADay" };

  // Sell what pays here.
  for (const g of GOODS) {
    const max = maxSale(s, g);
    if (max > 0 && (price(s, s.place, g) > book.basis(g) * 1.05 || hoursLeft(s) <= 2)) {
      const units = p.split ? Math.min(max, Math.max(1, Math.floor(unitsPerHour(s, g)))) : max;
      return { type: "sell", good: g, units };
    }
  }

  if (p.shuttle) {
    if (s.place === "docks") {
      for (const g of ["watches", "smokes"] as GoodId[]) {
        const n = maxBuy(s, g);
        if (n > 0) return { type: "buy", good: g, units: n };
      }
      return hoursLeft(s) > 1 ? { type: "travel", to: "strip" } : { type: "callItADay" };
    }
    if (carried(s) > 0 && hoursLeft(s) > 1 && s.place !== "strip") return { type: "travel", to: "strip" };
    return hoursLeft(s) > 2 ? { type: "travel", to: "docks" } : { type: "callItADay" };
  }

  const best = plan(s, book);
  if (best && best.score >= 12) {
    for (const g of GOODS) {
      const n = Math.min(best.buys[g] ?? 0, maxBuy(s, g));
      if (n > 0) queue.push({ type: "buy", good: g, units: n });
    }
    if (best.to !== s.place) queue.push({ type: "travel", to: best.to });
    const first = queue.shift();
    if (first) return first;
  }
  if (carried(s) === 0 && hoursLeft(s) >= RULES.oddJobHours) return { type: "oddJob" };
  if (best && best.to !== s.place && carried(s) > 0) return { type: "travel", to: best.to };
  return { type: "callItADay" };
}

// ---- Running and reporting ------------------------------------------------------------------

interface Run {
  wealth: number[];
  arrests: number;
  stops: number;
  upgradeDay: Partial<Record<UpgradeId, number>>;
  topRoute: number;
  earned: Book["earned"];
  actions: number;
  timed: number;
  jobs: Record<string, number>;
  afterArrest: { cash: number; back: number | null }[];
}

function runOne(name: string, p: Policy, seed: number): Run {
  let s = newGame(seed, `${name}-${seed}`);
  const book = new Book();
  const queue: Action[] = [];
  const out: Run = { wealth: [], arrests: 0, stops: 0, upgradeDay: {}, topRoute: 0, earned: book.earned, actions: 0, timed: 0, jobs: {}, afterArrest: [] };
  const wealth = () => s.cash + book.atCost() + s.upgrades.reduce((n, u) => n + UPGRADE_COST[u], 0);
  let lastGood = wealth();
  let open: { day: number; before: number; i: number } | null = null;
  let guard = 0;
  let refusals = 0;
  while (s.day <= DAYS && guard++ < DAYS * 200) {
    const action = decide(s, p, book, queue);
    const before = s;
    const r = step(s, action);
    if (!r.ok) {
      queue.length = 0;
      if (++refusals < 3) continue;
      const fallback = step(s, { type: "callItADay" });
      if (!fallback.ok) throw new Error(`${name} stuck: ${r.reason}`);
      s = fallback.state;
      for (const e of fallback.events) book.record(e, before.place);
      continue;
    }
    out.actions += 1;
    refusals = 0;
    if (r.state.hour > before.hour || r.state.day > before.day) out.timed += 1;
    for (const e of r.events) {
      book.record(e, e.type === "sold" || e.type === "bought" ? before.place : r.state.place);
      if (e.type === "stopped") out.stops += 1;
      if (e.type === "arrested") out.arrests += 1;
      if (e.type === "job") out.jobs[e.outcome] = (out.jobs[e.outcome] ?? 0) + 1;
      if (e.type === "upgraded") out.upgradeDay[e.upgrade] = s.day;
      if (e.type === "dayEnded") {
        out.wealth[e.paper.day] = wealth();
        if (open) {
          const o = open;
          if (out.wealth[e.paper.day]! >= o.before && e.paper.day > o.day) {
            out.afterArrest[o.i]!.back = e.paper.day - o.day;
            open = null;
          }
        }
        if (e.paper.log.arrested && e.paper.day <= DAYS - 5) {
          out.afterArrest.push({ cash: e.paper.cash, back: null });
          open = { day: e.paper.day, before: lastGood, i: out.afterArrest.length - 1 };
        } else lastGood = out.wealth[e.paper.day]!;
      }
    }
    s = r.state;
  }
  const routes = [...book.routes.values()].filter((v) => v > 0);
  const total = routes.reduce((a, b) => a + b, 0);
  out.topRoute = total > 0 ? Math.max(...routes) / total : 0;
  return out;
}

const pct = (xs: number[], q: number): number => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length === 0 ? NaN : a[Math.min(a.length - 1, Math.floor(q * a.length))]!;
};
const k = (n: number) => (Number.isNaN(n) ? "-" : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

console.log(`days=${DAYS} seeds=${SEEDS}; wealth = cash + goods at cost + upgrades at cost; medians unless noted`);
console.log(
  ["policy".padEnd(15), "d5", "d10", `d${DAYS} p10/med/p90`.padStart(20), "arrests", "stops", "coat", "phone", "topRoute med/p90", "trade/job/odd%", "acts/day", "timed/day"].join("  "),
);
for (const [name, p] of Object.entries(POLICIES)) {
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) continue;
  const runs = Array.from({ length: SEEDS }, (_, i) => runOne(name, p, (i + 1) * 7919));
  const col = (d: number) => runs.map((r) => r.wealth[Math.min(d, DAYS)] ?? 0);
  const upDay = (u: UpgradeId) => {
    const days = runs.map((r) => r.upgradeDay[u] ?? Infinity);
    const m = pct(days, 0.5);
    return Number.isFinite(m) ? `d${m}` : "-";
  };
  const e = runs.reduce((a, r) => ({ trade: a.trade + r.earned.trade, job: a.job + r.earned.job, odd: a.odd + r.earned.odd }), { trade: 0, job: 0, odd: 0 });
  const all = e.trade + e.job + e.odd || 1;
  const route = runs.map((r) => r.topRoute);
  console.log(
    [
      name.padEnd(15),
      k(pct(col(5), 0.5)).padStart(5),
      k(pct(col(10), 0.5)).padStart(5),
      `${k(pct(col(DAYS), 0.1))}/${k(pct(col(DAYS), 0.5))}/${k(pct(col(DAYS), 0.9))}`.padStart(20),
      (runs.reduce((a, r) => a + r.arrests, 0) / SEEDS).toFixed(2).padStart(7),
      (runs.reduce((a, r) => a + r.stops, 0) / SEEDS).toFixed(1).padStart(5),
      upDay("coat").padStart(4),
      upDay("phone").padStart(5),
      `${(100 * pct(route, 0.5)).toFixed(0)}%/${(100 * pct(route, 0.9)).toFixed(0)}%`.padStart(16),
      `${((100 * e.trade) / all).toFixed(0)}/${((100 * e.job) / all).toFixed(0)}/${((100 * e.odd) / all).toFixed(0)}`.padStart(14),
      (runs.reduce((a, r) => a + r.actions, 0) / (SEEDS * DAYS)).toFixed(1).padStart(8),
      (runs.reduce((a, r) => a + r.timed, 0) / (SEEDS * DAYS)).toFixed(1).padStart(9),
    ].join("  "),
  );
  const arrests = runs.flatMap((r) => r.afterArrest);
  const jobs = runs.reduce<Record<string, number>>((a, r) => {
    for (const [o, n] of Object.entries(r.jobs)) a[o] = (a[o] ?? 0) + n;
    return a;
  }, {});
  if (process.env.DETAIL) {
    if (arrests.length) {
      console.log(
        `   after an arrest (${arrests.length}): cash next morning med $${k(pct(arrests.map((a) => a.cash), 0.5))} p10 $${k(pct(arrests.map((a) => a.cash), 0.1))}; days back to the pre-arrest wealth med ${pct(arrests.map((a) => a.back ?? 99), 0.5)} p90 ${pct(arrests.map((a) => a.back ?? 99), 0.9)} (arrests by 5 days before the end; 99 = not back by the end)`,
      );
    }
    if (Object.keys(jobs).length) console.log(`   jobs: ${JSON.stringify(jobs)}`);
  }
}
