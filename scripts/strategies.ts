// Strategy runs over many seeds, on the real simulation (docs/design.md, "To verify").
// Usage: node scripts/strategies.ts [days=20] [seeds=400]   ONLY=name,name to pick policies;
// DETAIL=1 adds arrests, jobs, Pinch's cases, each card's value per choice, each good's share of
// the trade profit (before and after the coat, and by day), supply at each source, and events.
// CARDS=1 instead forks every choice encounter (AT5, see `cardValues` below) and prints what each choice is worth.
// The planner is greedy and one trip deep and knows only what a player could see: prices
// where it stands, prices last seen elsewhere (tips, ringing round with the phone). A person can beat it.

import { marketEventOn } from "../src/sim/market.ts";
import {
  CARDS,
  GOOD,
  GOODS,
  PLACES,
  RULES,
  UPGRADE_COST,
  carried,
  choiceBlock,
  deals,
  factor,
  has,
  isSource,
  hoursLeft,
  maxBuy,
  maxSale,
  newGame,
  operationOn,
  pockets,
  price,
  quoteJob,
  ringDistance,
  saleHours,
  step,
  usualPrice,
  type Action,
  type CardId,
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
  /** With the phone: ring round at the day's start, also after midday, or before every move. */
  ring: "once" | "twice" | "everyMove";
  /** Cards: take the first choice the player can, or always the last (pass, walk on, leave). */
  cards: "take" | "pass";
  /** Pinch's operations: trade on regardless, or stay away from their places. */
  ops: "ignore" | "avoid";
}

const BASE: Policy = {
  order: ["coat", "phone", "crown"],
  lieLowAt: 45,
  endAt: null,
  stop: "bribeElseRun",
  jobs: "floor",
  split: false,
  shuttle: false,
  ring: "once",
  cards: "take",
  ops: "ignore",
};
const POLICIES: Record<string, Policy> = {
  trader: BASE,
  phoneFirst: { ...BASE, order: ["phone", "coat"] },
  ringTwice: { ...BASE, ring: "twice" },
  ringEveryMove: { ...BASE, ring: "everyMove" },
  noPhone: { ...BASE, order: ["coat"] },
  neverLieLow: { ...BASE, lieLowAt: null },
  endEarly: { ...BASE, lieLowAt: null, endAt: 45 },
  handOver: { ...BASE, stop: "handOver" },
  alwaysRun: { ...BASE, stop: "run" },
  splitSales: { ...BASE, split: true },
  dailyJob: { ...BASE, jobs: "daily" },
  shuttle: { ...BASE, shuttle: true },
  oddJobsOnly: { ...BASE, order: [], jobs: "never" },
  avoidOps: { ...BASE, ops: "avoid" },
  passCards: { ...BASE, cards: "pass" },
  crownFirst: { ...BASE, order: ["crown", "coat", "phone"] },
  noCrown: { ...BASE, order: ["coat", "phone"] },
  jobsAndOddJobs: { ...BASE, order: [], jobs: "daily" },
};

// ---- What the player knows ----------------------------------------------------------

/** The price a player would expect: live here, last seen elsewhere, else neutral. Null where the good isn't dealt. */
function known(s: GameState, place: PlaceId, good: GoodId): number | null {
  if (!deals(place, good)) return null;
  if (place === s.place) return price(s, place, good);
  return s.memory[place][good]?.price ?? Math.round(GOOD[good].base * factor(place, good));
}
/** Buyers left here; elsewhere the live rule's neutral demand. */
const expectedDemand = (s: GameState, place: PlaceId, good: GoodId): number =>
  !deals(place, good)
    ? 0
    : place === s.place
      ? s.market[place][good].demand
      : Math.max(1, Math.round(GOOD[good].rate * RULES.demandHours * factor(place, good)));

// ---- Book-keeping: lots with their origin, for cost basis and route profit ----------

interface Lot {
  units: number;
  cost: number;
  from: PlaceId;
}

/** When a market sale was committed: with or without the coat, and in which part of the run. */
interface SaleTag {
  coat: boolean;
  day: number;
}
const BINS = [
  ["d1-5", 5],
  ["d6-15", 15],
  ["d16+", Infinity],
] as const;
const bin = (day: number): string => BINS.find(([, last]) => day <= last)![0];

class Book {
  lots = Object.fromEntries(GOODS.map((g) => [g, [] as Lot[]])) as Record<GoodId, Lot[]>;
  /** Signed market-sale profit by route ("from>to:good"); encounter sales are not routes. */
  routes = new Map<string, number>();
  /** Signed market-sale profit by "coat|nocoat:good" and by "bin:good". */
  tagged = new Map<string, number>();
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
  private add(map: Map<string, number>, key: string, v: number): void {
    map.set(key, (map.get(key) ?? 0) + v);
  }
  record(e: DomainEvent, at: PlaceId, tag?: SaleTag): void {
    if (e.type === "bought") this.lots[e.good].push({ units: e.units, cost: e.cost / e.units, from: at });
    else if (e.type === "sold") {
      const unit = e.proceeds / e.units;
      this.take(e.good, e.units, (lot, n) => {
        const profit = n * (unit - lot.cost);
        this.earned.trade += profit;
        this.add(this.routes, `${lot.from}>${at}:${e.good}`, profit);
        if (tag) {
          this.add(this.tagged, `${tag.coat ? "coat" : "nocoat"}:${e.good}`, profit);
          this.add(this.tagged, `${bin(tag.day)}:${e.good}`, profit);
        }
      });
    } else if (e.type === "arrested" || e.type === "handedOver" || e.type === "bribeRefused") {
      // Seizure takes carried goods; the lots don't know pockets from the lock-up, so take the oldest.
      for (const g of GOODS) if (e.seized[g] > 0) this.take(g, e.seized[g], () => {});
    } else if (e.type === "cardResolved") {
      // A card gains one good at a stated cost, or sells or loses some.
      for (const g of GOODS) {
        const d = e.goods[g];
        if (d > 0) this.lots[g].push({ units: d, cost: Math.max(0, -e.cash) / d, from: at });
        if (d < 0) {
          let cost = 0;
          this.take(g, -d, (lot, n) => (cost += n * lot.cost));
          if (e.cash > 0) this.earned.trade += e.cash - cost;
        }
      }
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
    if (avoiding(s, to)) continue;
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
      const there = known(s, to, g);
      if (s.held[g] > 0 && there !== null && (there > book.basis(g) * 1.05 || left <= 2)) toSell.push([g, s.held[g], book.basis(g)]);
    }
    if (to !== s.place) {
      // Only pairs dealt at both ends: bought here, sold there.
      const options = GOODS.filter((g) => deals(s.place, g) && deals(to, g))
        .map((g) => ({ g, here: price(s, s.place, g), there: known(s, to, g)! }))
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
    // Selling time is limited. As the policy will on arrival, sell next whatever earns most per
    // whole selling hour for the units that fit the hours and buyers left; ties in simulation order.
    const demandLeft = Object.fromEntries(GOODS.map((g) => [g, expectedDemand(s, to, g)])) as Record<GoodId, number>;
    const pending = [...toSell];
    for (;;) {
      let pick: { i: number; n: number; h: number; perHour: number } | null = null;
      pending.forEach(([g, units, cost], i) => {
        const n = Math.min(units, demandLeft[g], Math.floor(left * unitsPerHour(s, g)));
        if (n <= 0) return;
        const h = saleHours(s, g, n);
        const perHour = (n * (known(s, to, g)! - cost)) / h;
        const better =
          !pick || perHour > pick.perHour || (perHour === pick.perHour && GOODS.indexOf(g) < GOODS.indexOf(pending[pick.i]![0]));
        if (better) pick = { i, n, h, perHour };
      });
      if (!pick) break;
      const { i, n, h } = pick as { i: number; n: number; h: number };
      const [g, , cost] = pending[i]!;
      pending.splice(i, 1);
      demandLeft[g] -= n;
      left -= h;
      hours += h;
      gain += n * (known(s, to, g)! - cost);
    }
    if (hours === 0) continue;
    const score = gain / hours;
    if (!best || score > best.score) best = { to, buys, score };
  }
  return best;
}

/** Set per decision: the policy in play avoids Pinch's operations. */
let avoid = false;
const avoiding = (s: GameState, place: PlaceId): boolean => avoid && operationOn(s, place);

// ---- A policy as a function from state to the next action -----------------------------

function decide(s: GameState, p: Policy, book: Book, queue: Action[]): Action {
  if (s.phase === "night") return { type: "startDay" };
  if (s.pending?.kind === "card") {
    const choices = CARDS[s.pending.card].choices;
    const open = choices.filter((c) => !choiceBlock(s, c));
    const pick = p.cards === "take" ? open[0] : open.at(-1);
    return { type: "resolveCard", choice: (pick ?? choices.at(-1))!.id };
  }
  if (s.pending) {
    if (p.stop === "handOver") return { type: "resolveStop", choice: "handOver" };
    if (p.stop === "bribeElseRun" && s.pending.bribe !== null) return { type: "resolveStop", choice: "bribe" };
    return { type: "resolveStop", choice: "legIt" };
  }
  avoid = p.ops === "avoid";
  // Standing in an operation it avoids: leave first, for the nearest place without one.
  if (avoid && operationOn(s, s.place)) {
    const away = [...PLACES].filter((q) => !operationOn(s, q)).sort((a, b) => ringDistance(s.place, a) - ringDistance(s.place, b))[0];
    if (away && ringDistance(s.place, away) < hoursLeft(s)) return { type: "travel", to: away };
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

  // Sell what pays here: the sale that would earn most per selling hour, for the units it would
  // actually commit and their whole sale hours; ties in simulation order (a stable sort).
  const sales = GOODS.filter(
    (g) => deals(s.place, g) && maxSale(s, g) > 0 && (price(s, s.place, g) > book.basis(g) * 1.05 || hoursLeft(s) <= 2),
  ).map((g) => {
    const max = maxSale(s, g);
    const units = p.split ? Math.min(max, Math.max(1, Math.floor(unitsPerHour(s, g)))) : max;
    return { g, units, perHour: (units * (price(s, s.place, g) - book.basis(g))) / saleHours(s, g, units) };
  });
  const sale = sales.sort((a, b) => b.perHour - a.perHour)[0];
  if (sale) return { type: "sell", good: sale.g, units: sale.units };

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

  if (has(s, "phone")) {
    const other = PLACES.find((q) => q !== s.place) as PlaceId;
    // A call notes every dealt pair; undealt ones stay blank.
    const fresh = GOODS.every((g) => !deals(other, g) || (s.memory[other][g]?.day === s.day && s.memory[other][g]?.hour === s.hour));
    const due =
      p.ring === "everyMove" ? !fresh : s.calls === 0 || (p.ring === "twice" && s.calls === 1 && s.hour >= RULES.midday);
    if (due) return { type: "ringRound" };
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
  /** Liquid cash at the end of each day. */
  cash: number[];
  arrests: number;
  stops: number;
  upgradeDay: Partial<Record<UpgradeId, number>>;
  topRoute: number;
  earned: Book["earned"];
  actions: number;
  timed: number;
  jobs: Record<string, number>;
  afterArrest: { cash: number; back: number | null }[];
  cases: number;
  closed: number;
  pinchStops: number;
  tradeHours: number;
  /** Per card and choice: times taken and the summed immediate value (cash, goods at the usual price). */
  cards: Map<string, { n: number; value: number }>;
  book: Book;
  /** Fresh stock at each good's source on seeded days (2 on), as rolled: sum and days counted. */
  supply: Record<GoodId, number>;
  supplyDays: number;
  /** Market events (distinct IDs) that started during the run, and those traded on. */
  eventsStarted: number;
  /** Traded on the day the event started, or only on a later day. */
  tradedSameDay: number;
  tradedLater: number;
}

const usual = usualPrice;

function runOne(name: string, p: Policy, seed: number): Run {
  let s = newGame(seed, `${name}-${seed}`);
  const book = new Book();
  const queue: Action[] = [];
  const out: Run = {
    wealth: [],
    cash: [],
    arrests: 0,
    stops: 0,
    upgradeDay: {},
    topRoute: 0,
    earned: book.earned,
    actions: 0,
    timed: 0,
    jobs: {},
    afterArrest: [],
    cases: 0,
    closed: 0,
    pinchStops: 0,
    tradeHours: 0,
    cards: new Map(),
    book,
    supply: Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<GoodId, number>,
    supplyDays: 0,
    eventsStarted: 0,
    tradedSameDay: 0,
    tradedLater: 0,
  };
  const started = new Set<string>();
  const traded = new Set<string>();
  /** The event active on a sale's pair when it was committed, carried over a stop. */
  type Committed = { event: { id: string; startDay: number } | null; tag: SaleTag };
  let pendingSale: Committed | null = null;
  const source = Object.fromEntries(GOODS.map((g) => [g, PLACES.find((q) => isSource(q, g))!])) as Record<GoodId, PlaceId>;
  const tradedOn = (ev: { id: string; startDay: number } | null | undefined, day: number) => {
    if (!ev || traded.has(ev.id)) return;
    traded.add(ev.id);
    if (day === ev.startDay) out.tradedSameDay += 1;
    else out.tradedLater += 1;
  };
  // The book already includes the step's events, so wealth reads the state after the step too.
  const wealth = (st: GameState) => st.cash + book.atCost() + st.upgrades.reduce((n, u) => n + UPGRADE_COST[u], 0);
  let lastGood = wealth(s);
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
    // A sale is committed by its sell action; one that is stopped goes ahead (or not) when the stop resolves.
    const committed: Committed | null =
      action.type === "sell"
        ? { event: marketEventOn(before, before.place, action.good) ?? null, tag: { coat: has(before, "coat"), day: before.day } }
        : action.type === "resolveStop"
          ? pendingSale
          : null;
    if (action.type === "sell" || action.type === "resolveStop") pendingSale = null;
    for (const e of r.events) {
      book.record(e, e.type === "sold" || e.type === "bought" ? before.place : r.state.place, e.type === "sold" ? committed?.tag : undefined);
      if (e.type === "bought") tradedOn(marketEventOn(before, before.place, e.good), before.day);
      if (e.type === "sold") tradedOn(committed?.event, committed?.tag.day ?? before.day);
      if (e.type === "stopped" && e.stop.quote.type === "sell") pendingSale = committed;
      if (e.type === "eventStarted" && (e.event.kind === "shortage" || e.event.kind === "glut") && e.event.startDay <= DAYS) started.add(e.event.id);
      if (e.type === "dayStarted" && e.day >= 2 && e.day <= DAYS) {
        out.supplyDays += 1;
        for (const g of GOODS) out.supply[g] += r.state.market[source[g]][g].freshStock;
      }
      if (e.type === "stopped") out.stops += 1;
      if (e.type === "stopped" && e.stop.bribeRefusal === "pinch") out.pinchStops += 1;
      if (e.type === "sold" || e.type === "travelled") out.tradeHours += e.hours;
      if (e.type === "cardResolved") {
        const key = `${e.card as CardId}:${e.choice ?? "report"}`;
        const c = out.cards.get(key) ?? { n: 0, value: 0 };
        c.n += 1;
        c.value += e.cash + GOODS.reduce((v, g) => v + e.goods[g] * usual(g), 0);
        out.cards.set(key, c);
      }
      if (e.type === "arrested") out.arrests += 1;
      if (e.type === "job") out.jobs[e.outcome] = (out.jobs[e.outcome] ?? 0) + 1;
      if (e.type === "upgraded") out.upgradeDay[e.upgrade] = s.day;
      if (e.type === "dayEnded") {
        out.wealth[e.paper.day] = wealth(r.state);
        out.cash[e.paper.day] = r.state.cash;
        for (const item of e.paper.pinch) {
          if (item.kind === "announced") out.cases += 1;
          if (item.kind === "closed") out.closed += 1;
        }
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
  out.eventsStarted = started.size;
  return out;
}

const pct = (xs: number[], q: number): number => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length === 0 ? NaN : a[Math.min(a.length - 1, Math.floor(q * a.length))]!;
};
const k = (n: number) => (Number.isNaN(n) ? "-" : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

// ---- What a card is worth, in the state where it shows ---------------------------------

const cloneBook = (b: Book): Book => Object.assign(new Book(), structuredClone({ lots: b.lots, routes: b.routes, earned: b.earned }));
/** Cash and goods at the city's usual price; upgrades at cost. */
const worth = (s: GameState): number =>
  s.cash + GOODS.reduce((v, g) => v + s.held[g] * usual(g), 0) + s.upgrades.reduce((n, u) => n + UPGRADE_COST[u], 0);

/** How a played-on fork ended: at its intended endpoint, on the step guard, or on a step that failed. */
type Ending = "endpoint" | "guard" | "failed";
interface Played {
  value: number;
  end: Ending;
  /** The day the repayment report showed, when watched for. */
  repaid: number | null;
}

/**
 * Plays `s` on with policy `p` to the end of day `until` and returns what the run is worth then
 * and how it ended. With `repay`, it also watches for Old mate's repayment and then stops at
 * the end of the day after it (never past `until`, the cutoff).
 */
function playOn(s: GameState, p: Policy, book: Book, until: number, repay = false): Played {
  const queue: Action[] = [];
  let end = until;
  let repaid: number | null = null;
  const limit = 200 * (until - s.day + 2);
  for (let guard = 0; guard < limit; guard++) {
    if (s.phase === "night" && s.day >= end) return { value: worth(s), end: "endpoint", repaid };
    const before = s;
    let r = step(s, decide(s, p, book, queue));
    if (!r.ok) {
      queue.length = 0;
      r = step(s, s.pending ? decide(s, { ...p, cards: "pass" }, book, queue) : { type: "callItADay" });
      if (!r.ok) return { value: worth(s), end: "failed", repaid };
    }
    for (const e of r.events) {
      book.record(e, e.type === "sold" || e.type === "bought" ? before.place : r.state.place);
      if (repay && repaid === null && e.type === "cardResolved" && e.card === "oldMatePays") {
        repaid = r.state.phase === "night" ? r.state.paper!.day : r.state.day;
        end = Math.min(until, repaid + 1);
      }
    }
    s = r.state;
  }
  // The last permitted step may have reached the endpoint.
  return { value: worth(s), end: s.phase === "night" && s.day >= end ? "endpoint" : "guard", repaid };
}

/** Where a card showed, as the report prints a representative fork. */
const stateAt = (s: GameState): string => {
  const held = GOODS.filter((g) => s.held[g] > 0).map((g) => `${s.held[g]} ${g}`);
  return `${s.place} $${s.cash} ${pockets(s) - carried(s)} free${held.length ? ` (${held.join(", ")})` : ""}`;
};

interface Fork {
  diff: number;
  state: string;
  free: number;
}
type LoanGroup = "measured" | "outstanding" | "cutShort";

/**
 * AT5: forks the `trader` run at every choice encounter (the false trail aside; the repayment is
 * a report). Each open choice is taken and compared with the card's stated last choice (Pass,
 * Walk on, Not now, Run, Brazen it out). Both forks play on from the same generator position to
 * the same game day: the end of the next day, or for Old mate's loan the end of the day after the
 * lending fork's repayment, cut off at the end of day + 14 and never past the run's last day.
 * Only forks where both sides reached their endpoint count; the others are reported.
 */
const FORKS = 4;
const LOAN_CUTOFF = 14;

function cardValues(): void {
  const p = POLICIES.trader!;
  const forks = new Map<string, Fork[]>();
  const ended = new Map<string, Record<Ending, number>>();
  const loans: Record<LoanGroup, number[]> = { measured: [], outstanding: [], cutShort: [] };
  for (let i = 0; i < SEEDS; i++) {
    const seed = (i + 1) * 7919;
    let s = newGame(seed, `cards-${seed}`);
    const book = new Book();
    const queue: Action[] = [];
    for (let guard = 0; s.day <= DAYS && guard < DAYS * 200; guard++) {
      if (s.pending?.kind === "card" && !s.pending.card.startsWith("falseTrail")) {
        const id = s.pending.card;
        const card = CARDS[id];
        const open = card.choices.filter((c) => !choiceBlock(s, c));
        const last = card.choices.at(-1)!;
        const loan = id === "oldMate";
        const cutoff = Math.min(s.day + LOAN_CUTOFF, DAYS);
        // Common random numbers: after the choice, both forks play on from the same generator
        // position, over several positions, so the difference is the choice and not the dice.
        // A choice the sim refuses here ends its comparison as a failed step.
        const fork = (choice: string, after: number, until: number, repay: boolean): Played => {
          const r = step(s, { type: "resolveCard", choice });
          if (!r.ok) return { value: 0, end: "failed", repaid: null };
          const b = cloneBook(book);
          for (const e of r.events) b.record(e, s.place);
          return playOn({ ...r.state, rng: after }, p, b, until, repay);
        };
        for (const c of open) {
          if (c.id === last.id) continue;
          const key = `${id}:${c.id}`;
          const ends = ended.get(key) ?? { endpoint: 0, guard: 0, failed: 0 };
          ended.set(key, ends);
          if (!forks.has(key)) forks.set(key, []);
          for (let k = 0; k < FORKS; k++) {
            const after = (seed * 31 + s.day * 997 + k * 7919) | 0;
            const take = fork(c.id, after, loan ? cutoff : s.day + 1, loan);
            // The loan's comparison day: the day after the repayment, else the cutoff.
            const until = loan && take.repaid !== null ? Math.min(cutoff, take.repaid + 1) : loan ? cutoff : s.day + 1;
            const base = take.end === "failed" ? take : fork(last.id, after, until, false);
            const end: Ending = take.end !== "endpoint" ? take.end : base.end;
            ends[end] += 1;
            if (end !== "endpoint") continue;
            const diff = take.value - base.value;
            if (loan) {
              const group: LoanGroup =
                s.day + 4 >= DAYS || take.repaid === cutoff ? "cutShort" : take.repaid !== null ? "measured" : "outstanding";
              loans[group].push(diff);
              if (group !== "measured") continue;
            }
            forks.get(key)!.push({ diff, state: stateAt(s), free: pockets(s) - carried(s) });
          }
        }
      }
      const before = s;
      let r = step(s, decide(s, p, book, queue));
      if (!r.ok) {
        queue.length = 0;
        r = step(s, { type: "callItADay" });
        if (!r.ok) break;
      }
      for (const e of r.events) book.record(e, e.type === "sold" || e.type === "bought" ? before.place : r.state.place);
      s = r.state;
    }
  }
  const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
  console.log(
    `AT5 card values: trader, ${SEEDS} seeds × ${DAYS} days, ${FORKS} forks a showing; each choice minus the card's last choice, both played on to the end of the next day (the loan: the day after its repayment, cut off at day + ${LOAN_CUTOFF})`,
  );
  console.log(["choice".padEnd(24), "forks", "mean", "p10", "p50", "p90", "take/tie/last", "not at endpoint"].join("  "));
  // Every choice attempted is listed, with no measured forks if none reached the endpoint.
  for (const [key, fs] of [...forks.entries()].sort()) {
    const xs = fs.map((f) => f.diff);
    const e = ended.get(key)!;
    const share = (f: (x: number) => boolean) => (xs.length === 0 ? "-" : `${Math.round((100 * xs.filter(f).length) / xs.length)}%`);
    console.log(
      [
        key.padEnd(24),
        String(xs.length).padStart(5),
        k(mean(xs)).padStart(4),
        k(pct(xs, 0.1)).padStart(4),
        k(pct(xs, 0.5)).padStart(4),
        k(pct(xs, 0.9)).padStart(4),
        `${share((x) => x > 0)}/${share((x) => x === 0)}/${share((x) => x < 0)}`.padStart(13),
        `guard ${e.guard}, failed ${e.failed}`,
      ].join("  "),
    );
    // A representative fork on each side: the median of those where taking won, and of those where the last choice did.
    for (const [side, pick] of [
      ["takes", (f: Fork) => f.diff > 0],
      ["passes", (f: Fork) => f.diff < 0],
    ] as const) {
      const side_ = fs.filter(pick).sort((a, b) => a.diff - b.diff);
      const mid = side_[Math.floor(side_.length / 2)];
      if (mid) console.log(`      ${side} best (${side_.length}), median at $${Math.round(mid.diff)}: ${mid.state}`);
    }
    // Purchases: does a card's gain crowd out better goods? Its value by free pockets.
    const [card, choice] = key.split(":") as [CardId, string];
    if (CARDS[card].choices.find((c) => c.id === choice)?.effects.some((x) => x.kind === "gain")) {
      const buckets = [
        ["<10", (f: Fork) => f.free < 10],
        ["10-19", (f: Fork) => f.free >= 10 && f.free < 20],
        ["20+", (f: Fork) => f.free >= 20],
      ] as const;
      console.log(
        `      by free pockets: ${buckets.map(([name, inBucket]) => `${name} ${k(mean(fs.filter(inBucket).map((f) => f.diff)))} (${fs.filter(inBucket).length})`).join(" · ")}`,
      );
    }
  }
  console.log(
    `   loans: measured ${loans.measured.length} (mean ${k(mean(loans.measured))}); outstanding at the cutoff ${loans.outstanding.length} (value without the $150 back: mean ${k(mean(loans.outstanding))}); cut short ${loans.cutShort.length}`,
  );
}

/** Sums a per-run map over the runs. */
function summed(runs: Run[], pick: (r: Run) => Map<string, number>): Map<string, number> {
  const all = new Map<string, number>();
  for (const r of runs) for (const [key, v] of pick(r)) all.set(key, (all.get(key) ?? 0) + v);
  return all;
}

/** Totals by good of a profit map keyed "head:good" (only the given head, if any). */
function shares(map: Map<string, number>, head?: string): { total: number; by: Record<GoodId, number> } {
  const by = Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<GoodId, number>;
  for (const [key, v] of map) {
    const [h, good] = key.split(":") as [string, GoodId];
    if (head === undefined || h === head) by[good] += v;
  }
  return { total: GOODS.reduce((n, g) => n + by[g], 0), by };
}
const shareLine = ({ total, by }: ReturnType<typeof shares>): string =>
  GOODS.map((g) => `${g} ${total === 0 ? "-" : ((100 * by[g]) / total).toFixed(1)}%`).join(" · ");

/** AT2, CE2, AT7 and AT8: each good's share of market-sale profit, supply at the sources, events. */
function goodsReport(runs: Run[]): void {
  // Route keys are "from>to:good"; by good, the routes' sum is the signed market-sale profit.
  const byGood = shares(summed(runs, (r) => new Map([...r.book.routes].map(([key, v]) => [`all:${key.split(":")[1]!}:${key}`, v]))));
  const lo = Math.min(...GOODS.map((g) => byGood.by[g])) / byGood.total;
  const hi = Math.max(...GOODS.map((g) => byGood.by[g])) / byGood.total;
  console.log(`   AT2 profit by good (signed market sales, all seeds): ${shareLine(byGood)}; min ${(100 * lo).toFixed(1)}% max ${(100 * hi).toFixed(1)}%`);
  const tagged = summed(runs, (r) => r.book.tagged);
  for (const tag of ["nocoat", "coat", ...BINS.map(([name]) => name)]) {
    const s = shares(tagged, tag);
    console.log(`   CE2 ${tag.padEnd(6)} ($${k(s.total / runs.length)}/run): ${shareLine(s)}`);
  }
  const days = runs.reduce((n, r) => n + r.supplyDays, 0);
  console.log(
    `   AT7 fresh stock at the source, mean on days 2-${DAYS}: ${GOODS.map((g) => `${g} ${(runs.reduce((n, r) => n + r.supply[g], 0) / days).toFixed(2)}`).join(" · ")}`,
  );
  const mean = (f: (r: Run) => number) => (runs.reduce((n, r) => n + f(r), 0) / runs.length).toFixed(2);
  console.log(
    `   AT8 market events per run: ${mean((r) => r.eventsStarted)} started (all on dealt pairs); traded on ${mean((r) => r.tradedSameDay + r.tradedLater)} (${mean((r) => r.tradedSameDay)} first on their start day, ${mean((r) => r.tradedLater)} first on a later day)`,
  );
}

if (process.env.CARDS) {
  cardValues();
  process.exit(0);
}

console.log(
  `days=${DAYS} seeds=${SEEDS}; wealth = cash + goods at cost + upgrades at cost, at the end of the day; medians unless noted; >dN = fewer than half by day N`,
);
console.log(
  ["policy".padEnd(15), "cash d5/d10", "d5", "d10", `d${DAYS} p10/med/p90`.padStart(20), "arrests", "stops", "coat", "phone", "crown", "crowned", "cases", "trade$/h", "topRoute med/p90", "trade/job/odd%", "acts/day", "timed/day"].join("  "),
);
for (const [name, p] of Object.entries(POLICIES)) {
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) continue;
  const runs = Array.from({ length: SEEDS }, (_, i) => runOne(name, p, (i + 1) * 7919));
  const col = (d: number) => runs.map((r) => r.wealth[Math.min(d, DAYS)] ?? 0);
  const cash = (d: number) => runs.map((r) => r.cash[Math.min(d, DAYS)] ?? 0);
  const upDay = (u: UpgradeId) => {
    const days = runs.map((r) => r.upgradeDay[u] ?? Infinity);
    const m = pct(days, 0.5);
    return Number.isFinite(m) ? `d${m}` : `>d${DAYS}`;
  };
  const e = runs.reduce((a, r) => ({ trade: a.trade + r.earned.trade, job: a.job + r.earned.job, odd: a.odd + r.earned.odd }), { trade: 0, job: 0, odd: 0 });
  const all = e.trade + e.job + e.odd || 1;
  const route = runs.map((r) => r.topRoute);
  console.log(
    [
      name.padEnd(15),
      `${k(pct(cash(5), 0.5))}/${k(pct(cash(10), 0.5))}`.padStart(11),
      k(pct(col(5), 0.5)).padStart(5),
      k(pct(col(10), 0.5)).padStart(5),
      `${k(pct(col(DAYS), 0.1))}/${k(pct(col(DAYS), 0.5))}/${k(pct(col(DAYS), 0.9))}`.padStart(20),
      (runs.reduce((a, r) => a + r.arrests, 0) / SEEDS).toFixed(2).padStart(7),
      (runs.reduce((a, r) => a + r.stops, 0) / SEEDS).toFixed(1).padStart(5),
      upDay("coat").padStart(4),
      upDay("phone").padStart(5),
      upDay("crown").padStart(5),
      String(runs.filter((r) => r.upgradeDay.crown).length).padStart(7),
      (runs.reduce((a, r) => a + r.cases, 0) / SEEDS).toFixed(2).padStart(5),
      k(pct(runs.map((r) => r.earned.trade / Math.max(1, r.tradeHours)), 0.5)).padStart(8),
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
    const crown = pct(runs.map((r) => r.upgradeDay.crown ?? Infinity), 0.5);
    const perHour = pct(runs.map((r) => r.earned.trade / Math.max(1, r.tradeHours)), 0.5);
    const arrestRate = runs.reduce((a, r) => a + r.arrests, 0) / SEEDS;
    console.log(
      `   exact: crown median day ${crown}; trade $/h median ${perHour.toFixed(2)}; wealth d${DAYS} median $${Math.round(pct(col(DAYS), 0.5))}; arrests/run ${arrestRate.toFixed(4)}; top route median ${(100 * pct(route, 0.5)).toFixed(1)}%`,
    );
    if (arrests.length) {
      console.log(
        `   after an arrest (${arrests.length}): cash next morning med $${k(pct(arrests.map((a) => a.cash), 0.5))} p10 $${k(pct(arrests.map((a) => a.cash), 0.1))}; days back to the pre-arrest wealth med ${pct(arrests.map((a) => a.back ?? 99), 0.5)} p90 ${pct(arrests.map((a) => a.back ?? 99), 0.9)} (arrests by 5 days before the end; 99 = not back by the end)`,
      );
    }
    if (Object.keys(jobs).length) console.log(`   jobs: ${JSON.stringify(jobs)}`);
    const sum = (f: (r: Run) => number) => runs.reduce((a, r) => a + f(r), 0);
    console.log(
      `   Pinch: ${(sum((r) => r.cases) / SEEDS).toFixed(2)} cases/run, ${(sum((r) => r.closed) / SEEDS).toFixed(2)} closed, ${(sum((r) => r.pinchStops) / SEEDS).toFixed(2)} stops by him; crown bought in ${runs.filter((r) => r.upgradeDay.crown).length}/${SEEDS}`,
    );
    const cards = new Map<string, { n: number; value: number }>();
    for (const r of runs) {
      for (const [key, c] of r.cards) {
        const all = cards.get(key) ?? { n: 0, value: 0 };
        all.n += c.n;
        all.value += c.value;
        cards.set(key, all);
      }
    }
    const lines = [...cards.entries()].sort().map(([key, c]) => `${key} ${(c.n / SEEDS).toFixed(2)}/run $${Math.round(c.value / c.n)}`);
    if (lines.length) console.log(`   cards (taken per run, mean immediate value): ${lines.join(" · ")}`);
    goodsReport(runs);
  }
}
