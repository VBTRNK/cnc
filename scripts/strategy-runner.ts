import { marketEventOn, perGood } from "../src/sim/market.ts";
import {
  CARDS, GOODS, PLACES, UPGRADE_COST, carried, choiceBlock, deals, has, isSource,
  newGame, pockets, price, step, usualPrice,
  type Action, type GameState, type GoodId, type StepResult, type UpgradeId,
} from "../src/sim/index.ts";
import { Book, POLICIES, decide, type Policy, type SaleTag } from "./strategy-policy.ts";

const SEED_STRIDE = 7919;
// newGame uses a 32-bit generator position. Keep all selected seeds distinct.
const LAST_SEED_INDEX = Math.floor(0xffff_ffff / SEED_STRIDE);

export interface Selection {
  days: number;
  seeds: number[];
  seedStart: number;
  policies: string[];
}

function positiveInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(raw);
}

export function selectRun(daysArg = "20", countArg = "400", startArg = "1", only?: string): Selection {
  const days = positiveInteger(daysArg, "days");
  if (!Number.isSafeInteger(days * 200)) throw new Error("days exceeds the step counter range");
  const count = positiveInteger(countArg, "seed count");
  const seedStart = positiveInteger(startArg, "SEED_START");
  if (seedStart > LAST_SEED_INDEX || count > LAST_SEED_INDEX - seedStart + 1) {
    throw new Error(`seed indices must be within 1–${LAST_SEED_INDEX}`);
  }
  const names = only?.split(",") ?? Object.keys(POLICIES);
  for (const name of names) {
    if (!Object.hasOwn(POLICIES, name)) throw new Error(`unknown policy: ${JSON.stringify(name)}`);
  }
  return {
    days,
    seeds: Array.from({ length: count }, (_, i) => (seedStart + i) * SEED_STRIDE),
    seedStart,
    policies: Object.keys(POLICIES).filter((name) => names.includes(name)),
  };
}

export function marketSnapshot(s: GameState) {
  return {
    day: s.day, hour: s.hour, place: s.place, cash: s.cash,
    events: s.events,
    places: PLACES.map((place) => {
      const pairs = GOODS.map((good) => ({
        good, dealt: deals(place, good), source: isSource(place, good), ...s.market[place][good],
        price: deals(place, good) ? price(s, place, good) : null,
        quote: s.memory[place][good] ?? null,
      }));
      return { place, dealt: pairs.filter((pair) => pair.dealt).length, pairs };
    }),
  };
}

export const openingSnapshot = (seed: number) => marketSnapshot(newGame(seed, "opening"));

type Outcome = { end: "endpoint"; day: number } | { end: "guard" | "failed"; day: number; reason: string };
type CommittedSale = { event: ReturnType<typeof marketEventOn>; tag: SaleTag };
type CommittedStep = Extract<StepResult, { ok: true }>;
interface PlayOptions {
  pick?: typeof decide;
  maxSteps?: number;
  beforeStep?: (s: GameState, book: Book) => void;
  afterStep?: (before: GameState, result: CommittedStep, sale: CommittedSale | null) => number | void;
}

/** Counts only committed actions and stops on the requested day's dayEnded event. */
function playUntil(start: GameState, p: Policy, book: Book, until: number, options: PlayOptions = {}) {
  let state = start;
  let endDay = until;
  let pendingSale: CommittedSale | null = null;
  let refusals = 0;
  const queue: Action[] = [];
  const limit = options.maxSteps ?? (until - start.day + 1) * 200;
  if (state.phase === "night" && state.paper?.day === endDay) {
    return { state, outcome: { end: "endpoint", day: endDay } satisfies Outcome };
  }
  for (let attempt = 0; attempt < limit; attempt++) {
    if (refusals === 0) options.beforeStep?.(state, book);
    let action = (options.pick ?? decide)(state, p, book, queue);
    let result = step(state, action);
    if (!result.ok) {
      queue.length = 0;
      if (++refusals < 3) continue;
      const refused = `${action.type}: ${result.reason}`;
      action = { type: "callItADay" };
      result = step(state, action);
      if (!result.ok) {
        const outcome: Outcome = { end: "failed", day: state.day, reason: `${refused}; fallback: ${result.reason}` };
        return { state, outcome };
      }
    }
    refusals = 0;
    const sale: CommittedSale | null = action.type === "sell"
      ? { event: marketEventOn(state, state.place, action.good), tag: { coat: has(state, "coat"), day: state.day } }
      : action.type === "resolveStop" ? pendingSale : null;
    if (action.type === "sell" || action.type === "resolveStop") pendingSale = null;
    for (const e of result.events) {
      const at = e.type === "sold" || e.type === "bought" ? state.place : result.state.place;
      book.record(e, at, e.type === "sold" ? sale?.tag : undefined);
      if (e.type === "stopped" && e.stop.quote.type === "sell") pendingSale = sale;
    }
    endDay = options.afterStep?.(state, result, sale) ?? endDay;
    state = result.state;
    if (result.events.some((e) => e.type === "dayEnded" && e.paper.day === endDay)) {
      return { state, outcome: { end: "endpoint", day: endDay } satisfies Outcome };
    }
  }
  const outcome: Outcome = { end: "guard", day: state.day, reason: `step limit ${limit}` };
  return { state, outcome };
}

interface Run {
  seed: number;
  outcome: Outcome;
  wealth: number[];
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
  cards: Map<string, { n: number; value: number }>;
  book: Book;
  supply: Record<GoodId, number>;
  supplyDays: number;
  eventsStarted: number;
  tradedSameDay: number;
  tradedLater: number;
}

const sources = Object.fromEntries(GOODS.map((g) => [g, PLACES.find((place) => isSource(place, g))!])) as Record<GoodId, (typeof PLACES)[number]>;
const upgradeCost = (s: GameState) => s.upgrades.reduce((n, u) => n + UPGRADE_COST[u], 0);
const worth = (s: GameState): number =>
  s.cash + GOODS.reduce((v, g) => v + s.held[g] * usualPrice(g), 0) + upgradeCost(s);

type RunTotals = Omit<Run, "outcome">;

export function runOne(name: string, p: Policy, seed: number, days: number, options: Pick<PlayOptions, "pick" | "maxSteps"> & {
  start?: GameState;
  book?: Book;
} = {}): Run {
  const start = options.start ?? newGame(seed, `${name}-${seed}`);
  const book = options.book ?? new Book();
  const out: RunTotals = {
    seed, wealth: [], cash: [], arrests: 0, stops: 0, upgradeDay: {}, topRoute: 0, earned: book.earned,
    actions: 0, timed: 0, jobs: {}, afterArrest: [], cases: 0, closed: 0, pinchStops: 0, tradeHours: 0,
    cards: new Map(), book, supply: perGood(() => 0), supplyDays: 0, eventsStarted: 0, tradedSameDay: 0, tradedLater: 0,
  };
  const started = new Set<string>();
  const traded = new Set<string>();
  const tradedOn = (event: ReturnType<typeof marketEventOn>, day: number) => {
    if (!event || traded.has(event.id)) return;
    traded.add(event.id);
    if (day === event.startDay) out.tradedSameDay += 1;
    else out.tradedLater += 1;
  };
  const wealth = (s: GameState) => s.cash + book.atCost() + upgradeCost(s);
  let lastGood = wealth(start);
  let open: { day: number; before: number; i: number }[] = [];

  const { outcome } = playUntil(start, p, book, days, {
    ...options,
    afterStep(before, { state, events }, sale) {
      out.actions += 1;
      if (state.hour > before.hour || state.day > before.day) out.timed += 1;
      for (const e of events) {
        if (e.type === "bought") tradedOn(marketEventOn(before, before.place, e.good), before.day);
        if (e.type === "sold") tradedOn(sale?.event, sale?.tag.day ?? before.day);
        if (e.type === "eventStarted" && (e.event.kind === "shortage" || e.event.kind === "glut")) started.add(e.event.id);
        if (e.type === "dayStarted" && e.day >= 2) {
          out.supplyDays += 1;
          for (const g of GOODS) out.supply[g] += state.market[sources[g]][g].freshStock;
        }
        if (e.type === "stopped") {
          out.stops += 1;
          if (e.stop.bribeRefusal === "pinch") out.pinchStops += 1;
        }
        if (e.type === "sold" || e.type === "travelled") out.tradeHours += e.hours;
        if (e.type === "cardResolved") {
          const key = `${e.card}:${e.choice ?? "report"}`;
          const c = out.cards.get(key) ?? { n: 0, value: 0 };
          c.n += 1;
          c.value += e.cash + GOODS.reduce((v, g) => v + e.goods[g] * usualPrice(g), 0);
          out.cards.set(key, c);
        }
        if (e.type === "arrested") out.arrests += 1;
        if (e.type === "job") out.jobs[e.outcome] = (out.jobs[e.outcome] ?? 0) + 1;
        if (e.type === "upgraded") out.upgradeDay[e.upgrade] = before.day;
        if (e.type === "dayEnded") {
          const day = e.paper.day;
          const endWealth = wealth(state);
          out.wealth[day] = endWealth;
          out.cash[day] = state.cash;
          for (const item of e.paper.pinch) {
            if (item.kind === "announced") out.cases += 1;
            if (item.kind === "closed") out.closed += 1;
          }
          open = open.filter((recovery) => {
            if (endWealth < recovery.before) return true;
            out.afterArrest[recovery.i]!.back = day - recovery.day;
            return false;
          });
          if (e.paper.log.arrested && day <= days - 5) {
            out.afterArrest.push({ cash: state.cash, back: null });
            open.push({ day, before: lastGood, i: out.afterArrest.length - 1 });
          } else lastGood = endWealth;
        }
      }
    },
  });
  const profitable = [...book.routes.values()].filter((value) => value > 0);
  const total = profitable.reduce((a, b) => a + b, 0);
  out.topRoute = total > 0 ? Math.max(...profitable) / total : 0;
  out.eventsStarted = started.size;
  return { ...out, outcome };
}

export const FORKS = 4;
export const LOAN_CUTOFF = 14;

interface Branch {
  outcome: Outcome;
  value: number | null;
  repaid: number | null;
}

function playChoice(start: GameState, book: Book, p: Policy, choice: string, rng: number, until: number, watchLoan: boolean): Branch {
  const result = step(start, { type: "resolveCard", choice });
  if (!result.ok) {
    return { outcome: { end: "failed", day: start.day, reason: `resolveCard ${choice}: ${result.reason}` }, value: null, repaid: null };
  }
  const branchBook = book.copy();
  for (const e of result.events) branchBook.record(e, start.place);
  let repaid: number | null = null;
  const { state, outcome } = playUntil({ ...result.state, rng }, p, branchBook, until, {
    afterStep(_before, { state, events }) {
      if (watchLoan && repaid === null && events.some((e) => e.type === "cardResolved" && e.card === "oldMatePays")) {
        repaid = state.day;
        return Math.min(until, repaid + 1);
      }
    },
  });
  return { outcome, value: outcome.end === "endpoint" ? worth(state) : null, repaid };
}

type PairStatus = "measured" | "outstanding" | "cutShort" | "guard" | "failed";

export function compareCard(s: GameState, book: Book, p: Policy, choice: string, last: string, rng: number, horizon: number) {
  const loan = s.pending?.kind === "card" && s.pending.card === "oldMate";
  const target = s.day + (loan ? LOAN_CUTOFF : 1);
  const cutoff = Math.min(horizon, target);
  const take = playChoice(s, book, p, choice, rng, cutoff, loan);
  const matched = loan && take.repaid !== null ? take.repaid + 1 : target;
  const pass = playChoice(s, book, p, last, rng, Math.min(cutoff, matched), false);
  let status: PairStatus;
  if (take.outcome.end === "failed" || pass.outcome.end === "failed") status = "failed";
  else if (take.outcome.end === "guard" || pass.outcome.end === "guard") status = "guard";
  else if (matched > cutoff) status = "cutShort";
  else if (loan && take.repaid === null) status = "outstanding";
  else status = "measured";
  return { status, take, pass, diff: take.value === null || pass.value === null ? null : take.value - pass.value };
}

export interface CardSample extends ReturnType<typeof compareCard> {
  seed: number;
  day: number;
  situation: string;
  free: number;
}

export function cardRuns(selection: Selection) {
  const p = POLICIES.trader!;
  const samples = new Map<string, CardSample[]>();
  const parents = selection.seeds.map((seed) => {
    const { outcome } = playUntil(newGame(seed, `cards-${seed}`), p, new Book(), selection.days, {
      beforeStep(s, book) {
        if (s.pending?.kind !== "card" || s.pending.card.startsWith("falseTrail")) return;
        const id = s.pending.card;
        const card = CARDS[id];
        const last = card.choices.at(-1);
        if (!last) return;
        const free = pockets(s) - carried(s);
        const held = GOODS.filter((g) => s.held[g] > 0).map((g) => `${s.held[g]} ${g}`);
        const situation = `${s.place} $${s.cash} ${free} free${held.length ? ` (${held.join(", ")})` : ""}`;
        for (const c of card.choices) {
          if (c.id === last.id || choiceBlock(s, c)) continue;
          const key = `${id}:${c.id}`;
          const group = samples.get(key) ?? [];
          samples.set(key, group);
          for (let k = 0; k < FORKS; k++) {
            const rng = (seed * 31 + s.day * 997 + k * SEED_STRIDE) | 0;
            const comparison = compareCard(s, book, p, c.id, last.id, rng, selection.days);
            group.push({ seed, day: s.day, situation, free, ...comparison });
          }
        }
      },
    });
    return { seed, outcome };
  });
  return { parents, samples };
}
