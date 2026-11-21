import { neutralDemand, neutralPrice } from "../src/sim/market.ts";
import {
  CARDS,
  GOODS,
  PLACES,
  RULES,
  UPGRADE_COST,
  carried,
  choiceBlock,
  deals,
  has,
  hoursLeft,
  maxBuy,
  operationOn,
  pockets,
  price,
  quoteJob,
  ringDistance,
  saleHours,
  unitsIn,
  type Action,
  type DomainEvent,
  type GameState,
  type GoodId,
  type PlaceId,
  type UpgradeId,
} from "../src/sim/index.ts";

export interface Policy {
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
export const POLICIES: Record<string, Policy> = {
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
  return s.memory[place][good]?.price ?? neutralPrice(place, good);
}
/** Buyers left here; elsewhere the live rule's neutral demand. */
const expectedDemand = (s: GameState, place: PlaceId, good: GoodId): number =>
  !deals(place, good)
    ? 0
    : place === s.place
      ? s.market[place][good].demand
      : neutralDemand(place, good);

// ---- Book-keeping: lots with their origin, for cost basis and route profit ----------

interface Lot {
  units: number;
  cost: number;
  from: PlaceId;
}

/** When a market sale was committed: with or without the coat, and in which part of the run. */
export interface SaleTag {
  coat: boolean;
  day: number;
}
export const BINS = [
  ["d1-5", 5],
  ["d6-15", 15],
  ["d16+", Infinity],
] as const;
const bin = (day: number): string => BINS.find(([, last]) => day <= last)![0];

export class Book {
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
  copy(): Book {
    // Forks use the lots to plan sales. Their route and earnings totals start afresh.
    return Object.assign(new Book(), { lots: structuredClone(this.lots) });
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
      // Seizures, like sales, remove the oldest lots.
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

interface Sale {
  good: GoodId;
  units: number;
  hours: number;
  profit: number;
  perHour: number;
}

interface Plan {
  to: PlaceId;
  buys: Partial<Record<GoodId, number>>;
  sales: Sale[];
  gain: number;
  score: number;
}

function sale(s: GameState, good: GoodId, units: number, quote: number, basis: number, left: number): Sale | null {
  if (units <= 0 || (quote <= basis * 1.05 && left > 2)) return null;
  const hours = saleHours(s, good, units);
  const profit = units * quote - units * basis;
  return { good, units, hours, profit, perHour: profit / hours };
}

/** Both callers visit GOODS in catalogue order, so the first exact tie wins. */
function outranks(candidate: Sale, best: Sale | null): boolean {
  return best === null || candidate.perHour > best.perHour;
}

export function plan(s: GameState, book: Book, p: Policy = BASE): Plan | null {
  let best: Plan | null = null;
  for (const to of PLACES) {
    if (p.ops === "avoid" && operationOn(s, to)) continue;
    const travel = ringDistance(s.place, to);
    let left = hoursLeft(s) - travel;
    if (left <= 0) continue;
    let cash = s.cash;
    let room = pockets(s) - carried(s);
    let gain = 0;
    const buys: Plan["buys"] = {};
    const sales: Sale[] = [];
    const options = GOODS.flatMap((good) => {
      const there = known(s, to, good);
      if (there === null) return [];
      const held = s.held[good];
      const here = price(s, s.place, good);
      const stock = to !== s.place && deals(s.place, good) && there - here > 0.15 * here
        ? s.market[s.place][good].stock : 0;
      const demand = expectedDemand(s, to, good);
      if (demand === 0 || held + stock === 0) return [];
      return [{ good, there, here, stock, held, demand, basis: book.basis(good) }];
    });
    while (left > 0 && options.length > 0) {
      let pick: { index: number; sale: Sale; buy: number; here: number } | null = null;
      for (const [index, option] of options.entries()) {
        const { good, there, here, stock, held, demand, basis } = option;
        const cap = Math.min(demand, unitsIn(s, good, left));
        const buy = Math.max(0, Math.min(stock, Math.floor(cash / here), room, cap - held));
        const units = Math.min(cap, held + buy);
        const combinedBasis = buy > 0 ? (held * basis + buy * here) / (held + buy) : basis;
        const next = sale(s, good, units, there, combinedBasis, left);
        if (next && outranks(next, pick?.sale ?? null)) pick = { index, sale: next, buy, here };
      }
      if (!pick) break;
      options.splice(pick.index, 1);
      if (pick.buy > 0) {
        buys[pick.sale.good] = pick.buy;
        cash -= pick.buy * pick.here;
        room -= pick.buy;
      }
      sales.push(pick.sale);
      left -= pick.sale.hours;
      gain += pick.sale.profit;
    }
    const hours = hoursLeft(s) - left;
    if (hours === 0) continue;
    const score = gain / hours;
    if (!best || score > best.score) best = { to, buys, sales, gain, score };
  }
  return best;
}

// ---- A policy as a function from state to the next action -----------------------------

export function decide(s: GameState, p: Policy, book: Book, queue: Action[]): Action {
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
  // Standing in an operation it avoids: leave first, for the nearest place without one.
  if (p.ops === "avoid" && operationOn(s, s.place)) {
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
  let bestSale: Sale | null = null;
  const left = hoursLeft(s);
  for (const good of GOODS) {
    if (!deals(s.place, good)) continue;
    const cap = unitsIn(s, good, left);
    const splitCap = p.split ? Math.max(1, unitsIn(s, good, 1)) : cap;
    const units = Math.min(s.held[good], s.market[s.place][good].demand, cap, splitCap);
    const next = sale(s, good, units, price(s, s.place, good), book.basis(good), left);
    if (next && outranks(next, bestSale)) bestSale = next;
  }
  if (bestSale) return { type: "sell", good: bestSale.good, units: bestSale.units };

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

  const best = plan(s, book, p);
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
