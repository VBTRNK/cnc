// The simulation: state plus a validated action gives a new state plus domain events.
// Pure and deterministic: no wall clock, no UI, randomness only from the generator
// position saved in the state. An invalid action returns a refusal and draws nothing.

import { CARDS, POOL, TRAIL, type CardId, type Chance, type Choice, type Conditions, type Effect } from "./cards.ts";
import {
  CARDS_RULES,
  GOOD,
  GOODS,
  MILESTONES,
  PINCH,
  PLACES,
  RULES,
  SKILLS,
  UPGRADES,
  UPGRADE_COST,
  deals,
  type GoodId,
  type MilestoneId,
  type PlaceId,
  type SkillId,
  type UpgradeId,
} from "./content.ts";
import { announced, caughtHere, moveOperation, newDetective, pinchAtNight, seenDoing } from "./detective.ts";
import {
  activateUpTo,
  clamp,
  drawRumour,
  expireToday,
  fixtureMarket,
  flatDrift,
  heatWord,
  operationOn,
  operationStart,
  perGood,
  police,
  price,
  ringDistance,
  rollMarket,
  scheduleMidday,
  scheduleMorning,
  skill,
  usualPrice,
} from "./market.ts";
import { Rng, seedState } from "./rng.ts";
import type {
  CaseArrest,
  CaseHandover,
  DayLog,
  GameState,
  JobQuote,
  Paper,
  PendingCard,
  PendingStop,
  PerGood,
  Quote,
  Rumour,
  SaleQuote,
  Seizure,
  WorldEvent,
} from "./state.ts";

export type Action =
  | { type: "buy"; good: GoodId; units: number }
  | { type: "sell"; good: GoodId; units: number }
  | { type: "travel"; to: PlaceId }
  | { type: "askAround" }
  | { type: "lieLow" }
  | { type: "oddJob" }
  | { type: "pullJob" }
  | { type: "buyUpgrade"; upgrade: UpgradeId }
  | { type: "ringRound" }
  | { type: "callItADay" }
  | { type: "resolveStop"; choice: "bribe" | "legIt" | "handOver" }
  | { type: "resolveCard"; choice: string }
  | { type: "startDay" };

export type Refusal =
  | "pending"
  | "noPending"
  | "night"
  | "day"
  | "unknown"
  | "badUnits"
  | "noTime"
  | "noStock"
  | "noCash"
  | "noPockets"
  | "noDemand"
  | "noBuyers"
  | "noGoods"
  | "samePlace"
  | "jobDone"
  | "noTips"
  | "owned"
  | "noPhone"
  | "bribeRefused"
  | "unavailable";

export interface PriceTip {
  kind: "price";
  place: PlaceId;
  good: GoodId;
  price: number;
}

export type DomainEvent =
  | { type: "bought"; good: GoodId; units: number; cost: number }
  | { type: "sold"; good: GoodId; units: number; proceeds: number; cost: number; hours: number }
  | { type: "travelled"; from: PlaceId; to: PlaceId; hours: number }
  | { type: "tip"; tip: PriceTip | ({ kind: "rumour" } & Rumour) }
  | { type: "laidLow"; heat: number }
  | { type: "oddJob"; pay: number }
  | { type: "job"; outcome: "success" | "nothing" | "hurt" | "arrested"; pay: number }
  | { type: "stopped"; stop: PendingStop }
  | { type: "pattedDown"; operation?: number }
  | { type: "bribed"; amount: number }
  | { type: "bribeRefused"; seized: PerGood<number>; saleOff: boolean }
  | { type: "rangRound"; heat: number }
  | { type: "leggedIt"; success: boolean }
  | { type: "handedOver"; seized: PerGood<number>; saleOff: boolean }
  | { type: "arrested"; seized: PerGood<number>; fine: number }
  | { type: "upgraded"; upgrade: UpgradeId; cost: number }
  | { type: "eventStarted"; event: WorldEvent }
  | { type: "levelUp"; skill: SkillId; level: number }
  | { type: "card"; pending: PendingCard }
  /** A card's choice taken (null for a report): what it changed, and where a moved operation runs now. */
  | {
      type: "cardResolved";
      card: CardId;
      choice: string | null;
      won: boolean | null;
      cash: number;
      goods: PerGood<number>;
      places: PlaceId[] | null;
    }
  | { type: "takings"; amount: number }
  | { type: "dayEnded"; cause: DayEndCause; paper: Paper }
  | { type: "dayStarted"; day: number; hour: number };

export type DayEndCause = "clock" | "called" | "arrest" | "hurt";

export type StepResult =
  | { ok: true; state: GameState; events: DomainEvent[] }
  | { ok: false; reason: Refusal };

// ---- New game ----------------------------------------------------------------------

const zeroGoods = (): PerGood<number> => perGood(() => 0);
const emptyLog = (cash: number): DayLog => ({
  startCash: cash,
  sold: 0,
  proceeds: 0,
  bought: 0,
  spent: 0,
  stops: 0,
  arrested: false,
  hurt: false,
  jobPaid: 0,
  fine: 0,
  seized: 0,
  pub: 0,
  best: null,
});

/** A fresh run on the day-1 fixture. The caller supplies the seed and run identity. */
export function newGame(seed: number, runId: string): GameState {
  const s: GameState = {
    runId,
    rng: seedState(seed),
    phase: "day",
    day: 1,
    hour: RULES.dayStart,
    nextStart: RULES.dayStart,
    place: RULES.startPlace,
    cash: RULES.startCash,
    held: zeroGoods(),
    paid: zeroGoods(),
    heat: 0,
    xp: { patter: 0, nerve: 0, savvy: 0 },
    upgrades: [],
    drift: flatDrift(),
    market: fixtureMarket(),
    events: [
      { id: "d1-midday", slot: "midday", startDay: 1, startHour: RULES.midday, endDay: 2, activated: false, kind: "sweep", place: "strip" },
      { id: "d2-morning", slot: "morning", startDay: 2, startHour: RULES.dayStart, endDay: 3, activated: false, kind: "shortage", place: "oldtown", good: "fireworks" },
    ],
    jobDone: false,
    calls: 0,
    seenToday: [RULES.startPlace],
    tipsGiven: {},
    priceTips: [],
    rumour: null,
    memory: { docks: {}, oldtown: {}, uptown: {}, strip: {} },
    pending: null,
    today: emptyLog(RULES.startCash),
    paper: null,
    news: [],
    detective: newDetective(),
    milestones: { firsts: {}, best: null, cases: [], older: { closed: 0, cold: 0 } },
    cards: {},
    flags: {},
  };
  remember(s);
  return s;
}

// ---- Queries -----------------------------------------------------------------------

export const has = (s: GameState, u: UpgradeId): boolean => s.upgrades.includes(u);
export const pockets = (s: GameState): number => (has(s, "coat") ? RULES.coatPockets : RULES.pockets);
export const carried = (s: GameState): number => GOODS.reduce((n, g) => n + s.held[g], 0);
export const hoursLeft = (s: GameState): number => RULES.dayEnd - s.hour;

/** Patter's selling rate as tenths of units per hour, so the rounding is exact. */
const rateTenths = (good: GoodId, patter: number): number => GOOD[good].rate * (10 + patter);
export const saleHoursAtLevel = (good: GoodId, units: number, patter: number): number =>
  Math.ceil((units * 10) / rateTenths(good, patter));
export const saleHours = (s: GameState, good: GoodId, units: number): number =>
  saleHoursAtLevel(good, units, skill(s, "patter"));
export const unitsIn = (s: GameState, good: GoodId, hours: number): number =>
  Math.floor((hours * rateTenths(good, skill(s, "patter"))) / 10);

export function stopChance(s: GameState, hours: number): number {
  const perHour = (RULES.stopBase + RULES.stopPerHeat * s.heat) * police(s, s.place);
  return 1 - (1 - perHour) ** hours;
}

const odds = (s: GameState, base: number): number =>
  clamp(base + RULES.oddsPerNerve * skill(s, "nerve") - RULES.oddsPerHeat * s.heat, RULES.oddsMin, RULES.oddsMax);

/** What the units would cost of what was paid for the held ones: their share, rounded. */
export function saleCost(s: GameState, good: GoodId, units: number): number {
  const held = s.held[good];
  if (held <= 0) return 0;
  return units >= held ? s.paid[good] : Math.round((s.paid[good] * units) / held);
}

/** The heat the next phone call adds. */
export const callHeat = (s: GameState): number => RULES.phoneHeat * (s.calls + 1);

export function maxSale(s: GameState, good: GoodId): number {
  return Math.min(s.held[good], s.market[s.place][good].demand, unitsIn(s, good, hoursLeft(s)));
}

export function maxBuy(s: GameState, good: GoodId): number {
  const p = price(s, s.place, good);
  return Math.max(0, Math.min(s.market[s.place][good].stock, Math.floor(s.cash / p), pockets(s) - carried(s)));
}

/** The frozen quote a sale would commit with, or why it can't. */
export function quoteSale(s: GameState, good: GoodId, units: number): SaleQuote | Refusal {
  if (!GOODS.includes(good)) return "unknown";
  if (!Number.isInteger(units) || units < 1) return "badUnits";
  if (s.held[good] < units) return "noGoods";
  if (!deals(s.place, good)) return "noBuyers";
  if (s.market[s.place][good].demand < units) return "noDemand";
  if (unitsIn(s, good, hoursLeft(s)) < units) return "noTime";
  const hours = saleHours(s, good, units);
  const savvy = 1 - RULES.savvyHeat * skill(s, "savvy");
  return {
    type: "sell",
    good,
    units,
    proceeds: units * price(s, s.place, good),
    hours,
    heat: units * GOOD[good].heat * police(s, s.place) * savvy,
    stopChance: stopChance(s, hours),
    legIt: odds(s, RULES.legItBase),
  };
}

export function quoteJob(s: GameState): JobQuote | Refusal {
  if (s.jobDone) return "jobDone";
  if (hoursLeft(s) < RULES.jobHours) return "noTime";
  return {
    type: "job",
    hours: RULES.jobHours,
    stopChance: stopChance(s, RULES.jobHours),
    success: odds(s, RULES.jobBase),
    pay: RULES.jobPay,
    legIt: odds(s, RULES.legItBase),
  };
}

/** Order of preference for a price tip's good: the one held most, else the dearest. */
function tipGoods(s: GameState): GoodId[] {
  return [...GOODS].sort((a, b) => s.held[b] - s.held[a] || GOOD[b].base - GOOD[a].base);
}

function nextPriceTip(s: GameState): { place: PlaceId; good: GoodId } | null {
  const places = PLACES.filter((p) => !s.seenToday.includes(p)).sort(
    (a, b) => ringDistance(s.place, a) - ringDistance(s.place, b) || PLACES.indexOf(a) - PLACES.indexOf(b),
  );
  for (const good of tipGoods(s)) {
    const place = places.find((p) => deals(p, good) && !s.priceTips.includes(`${p}:${good}`));
    if (place) return { place, good };
  }
  return null;
}

/**
 * A card's tip, which must always land: a new tip as from asking around, else the price
 * elsewhere that the player saw longest ago (the good held most first, else the dearest).
 */
function cardTip(s: GameState): { place: PlaceId; good: GoodId } {
  const fresh = nextPriceTip(s);
  if (fresh) return fresh;
  const age = (p: PlaceId, g: GoodId) => {
    const m = s.memory[p][g];
    return m ? m.day * 24 + m.hour : -1;
  };
  let best: { place: PlaceId; good: GoodId } | null = null;
  for (const good of tipGoods(s)) {
    for (const place of PLACES) {
      if (place === s.place || !deals(place, good)) continue;
      if (!best || age(place, good) < age(best.place, best.good)) best = { place, good };
    }
  }
  return best as { place: PlaceId; good: GoodId };
}

export function canAskAround(s: GameState): boolean {
  return (s.tipsGiven[s.place] ?? 0) < RULES.tipsPerPlace && (s.rumour === null || nextPriceTip(s) !== null);
}

// ---- Validation --------------------------------------------------------------------

const isGood = (g: unknown): g is GoodId => GOODS.includes(g as GoodId);
const isUnits = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1;
const fits = (s: GameState, hours: number): Refusal | null => (hoursLeft(s) < hours ? "noTime" : null);

export function check(s: GameState, a: Action): Refusal | null {
  if (a.type === "startDay") return s.phase === "night" ? null : "day";
  if (s.phase === "night") return "night";
  if (a.type === "resolveStop") {
    if (s.pending?.kind !== "stop") return "noPending";
    if (a.choice === "bribe" && s.pending.bribe === null) return "bribeRefused";
    return ["bribe", "legIt", "handOver"].includes(a.choice) ? null : "unknown";
  }
  if (a.type === "resolveCard") {
    if (s.pending?.kind !== "card") return "noPending";
    const choice = CARDS[s.pending.card].choices.find((c) => c.id === a.choice);
    if (!choice) return "unknown";
    return choiceBlock(s, choice) ? "unavailable" : null;
  }
  if (s.pending) return "pending";
  switch (a.type) {
    case "buy": {
      if (!isGood(a.good)) return "unknown";
      if (!isUnits(a.units)) return "badUnits";
      if (!deals(s.place, a.good)) return "noStock";
      const cell = s.market[s.place][a.good];
      if (cell.stock < a.units) return "noStock";
      if (s.cash < a.units * price(s, s.place, a.good)) return "noCash";
      if (pockets(s) - carried(s) < a.units) return "noPockets";
      return null;
    }
    case "sell": {
      const q = quoteSale(s, a.good, a.units);
      return typeof q === "string" ? q : null;
    }
    case "travel":
      if (!PLACES.includes(a.to)) return "unknown";
      if (a.to === s.place) return "samePlace";
      return fits(s, ringDistance(s.place, a.to));
    case "askAround":
      return fits(s, RULES.askHours) ?? (canAskAround(s) ? null : "noTips");
    case "lieLow":
      return fits(s, RULES.lieLowHours);
    case "oddJob":
      return fits(s, RULES.oddJobHours);
    case "pullJob": {
      const q = quoteJob(s);
      return typeof q === "string" ? q : null;
    }
    case "buyUpgrade":
      if (!UPGRADES.includes(a.upgrade)) return "unknown";
      if (has(s, a.upgrade)) return "owned";
      return s.cash < UPGRADE_COST[a.upgrade] ? "noCash" : null;
    case "ringRound":
      return has(s, "phone") ? null : "noPhone";
    case "callItADay":
      return null;
    default:
      return "unknown";
  }
}

// ---- Step --------------------------------------------------------------------------

export function step(state: GameState, action: Action): StepResult {
  const refusal = check(state, action);
  if (refusal) return { ok: false, reason: refusal };
  const s = structuredClone(state);
  const rng = new Rng(s.rng);
  const out: DomainEvent[] = [];
  const levelsBefore = SKILLS.map((k) => skill(s, k));
  const middayBefore = harmlessToday(s);

  apply(s, rng, action, out);

  // The midday slot's harmless third becomes an encounter where the player stands, if a card fits.
  const midday = harmlessToday(s);
  if (midday && midday !== middayBefore && s.phase === "day" && !s.pending) encounter(s, rng, midday, out);
  recordFirsts(s, out);

  SKILLS.forEach((k, i) => {
    const now = skill(s, k);
    if (now > (levelsBefore[i] ?? 0)) out.push({ type: "levelUp", skill: k, level: now });
  });
  if (s.phase === "day") remember(s);
  s.rng = rng.state;
  return { ok: true, state: s, events: out };
}

function apply(s: GameState, rng: Rng, a: Action, out: DomainEvent[]): void {
  switch (a.type) {
    case "buy": {
      const cost = a.units * price(s, s.place, a.good);
      s.cash -= cost;
      s.market[s.place][a.good].stock -= a.units;
      s.held[a.good] += a.units;
      s.paid[a.good] += cost;
      s.today.bought += a.units;
      s.today.spent += cost;
      out.push({ type: "bought", good: a.good, units: a.units, cost });
      return;
    }
    case "sell":
      return commitChecked(s, rng, quoteSale(s, a.good, a.units) as SaleQuote, out);
    case "pullJob": {
      const quote = quoteJob(s) as JobQuote;
      s.jobDone = true;
      return commitChecked(s, rng, quote, out);
    }
    case "travel": {
      const hours = ringDistance(s.place, a.to);
      out.push({ type: "travelled", from: s.place, to: a.to, hours });
      s.place = a.to;
      if (!s.seenToday.includes(a.to)) s.seenToday.push(a.to);
      return pass(s, rng, hours, out);
    }
    case "askAround":
      s.tipsGiven[s.place] = (s.tipsGiven[s.place] ?? 0) + 1;
      s.xp.savvy += RULES.askSavvy;
      seenDoing(s, "ask", RULES.askHours);
      if (s.rumour === null) {
        s.rumour = drawRumour(s, rng, "ask");
        out.push({ type: "tip", tip: { kind: "rumour", ...s.rumour } });
      } else {
        const tip = nextPriceTip(s);
        if (tip) {
          const tipPrice = price(s, tip.place, tip.good);
          s.priceTips.push(`${tip.place}:${tip.good}`);
          s.memory[tip.place][tip.good] = { price: tipPrice, day: s.day, hour: s.hour };
          out.push({ type: "tip", tip: { kind: "price", ...tip, price: tipPrice } });
        }
      }
      return pass(s, rng, RULES.askHours, out);
    case "lieLow":
      if (s.heat > 0) s.xp.savvy += 1;
      seenDoing(s, "lieLow", RULES.lieLowHours);
      s.heat = Math.max(0, s.heat - RULES.lieLowHeat);
      out.push({ type: "laidLow", heat: s.heat });
      return pass(s, rng, RULES.lieLowHours, out);
    case "oddJob":
      seenDoing(s, "oddJob", RULES.oddJobHours);
      s.cash += RULES.oddJobPay;
      s.heat = Math.max(0, s.heat - RULES.oddJobHeat);
      out.push({ type: "oddJob", pay: RULES.oddJobPay });
      return pass(s, rng, RULES.oddJobHours, out);
    case "buyUpgrade": {
      const cost = UPGRADE_COST[a.upgrade];
      s.cash -= cost;
      s.upgrades.push(a.upgrade);
      out.push({ type: "upgraded", upgrade: a.upgrade, cost });
      return;
    }
    case "ringRound": {
      // A snapshot of every place's prices, at a price in heat that grows with each call today.
      const heat = callHeat(s);
      s.calls += 1;
      addHeat(s, heat);
      for (const p of PLACES) for (const g of GOODS) if (deals(p, g)) s.memory[p][g] = { price: price(s, p, g), day: s.day, hour: s.hour };
      out.push({ type: "rangRound", heat });
      return;
    }
    case "callItADay":
      return endDay(s, rng, "called", out);
    case "resolveStop":
      return resolveStop(s, rng, a.choice, out);
    case "resolveCard":
      return resolveCard(s, rng, a.choice, out);
    case "startDay":
      return startDay(s, rng, out);
  }
}

/** A sale or a job: the stop check at commit, then the card or the action as quoted. */
function commitChecked(s: GameState, rng: Rng, quote: Quote, out: DomainEvent[]): void {
  if (!rng.chance(quote.stopChance)) return run(s, rng, quote, out);
  s.today.stops += 1;
  if (carried(s) === 0) {
    const c = s.detective.case;
    out.push(c && operationOn(s, s.place) ? { type: "pattedDown", operation: c.n } : { type: "pattedDown" });
    return run(s, rng, quote, out);
  }
  // Goods nobody here deals in are valued at the city's usual price.
  const value = GOODS.reduce((sum, g) => sum + s.held[g] * (deals(s.place, g) ? price(s, s.place, g) : usualPrice(g)), 0);
  const bribe = Math.ceil(RULES.bribeBase + RULES.bribeShare * value + RULES.bribePerHeat * s.heat);
  // Inside his operation the stop is Pinch himself, who can't be bribed.
  const refusal = operationOn(s, s.place) ? "pinch" : s.heat >= RULES.bribeMaxHeat ? "wanted" : s.cash < bribe ? "short" : null;
  s.pending = {
    kind: "stop",
    quote,
    bribe: refusal ? null : bribe,
    bribeOdds: odds(s, RULES.bribeOddsBase),
    bribeRefusal: refusal,
  };
  out.push({ type: "stopped", stop: s.pending });
}

function resolveStop(s: GameState, rng: Rng, choice: "bribe" | "legIt" | "handOver", out: DomainEvent[]): void {
  const stop = s.pending as PendingStop;
  s.pending = null;
  s.xp.nerve += RULES.xpNervePerStop;
  if (choice === "bribe") {
    addHeat(s, RULES.bribeHeat);
    if (!rng.chance(stop.bribeOdds / 100)) {
      // An honest copper: he keeps his hands clean and takes the goods instead.
      out.push({ type: "bribeRefused", seized: seize(s), saleOff: stop.quote.type === "sell" });
      if (stop.quote.type === "job") run(s, rng, stop.quote, out);
      return;
    }
    const amount = stop.bribe as number;
    s.cash -= amount;
    out.push({ type: "bribed", amount });
    return run(s, rng, stop.quote, out);
  }
  if (choice === "legIt") {
    const success = rng.chance(stop.quote.legIt / 100);
    out.push({ type: "leggedIt", success });
    if (!success) return arrest(s, rng, out, "escape");
    addHeat(s, RULES.legItHeat);
    return run(s, rng, stop.quote, out);
  }
  const firstCatch = !s.detective.case?.caught;
  const c = caughtHere(s);
  const seized = seize(s);
  const handover = c && firstCatch ? { place: s.place, action: stop.quote.type, goods: seizureFacts(seized) } : undefined;
  if (c && handover) c.evidence = { ...c.evidence, handover };
  out.push({ type: "handedOver", seized, saleOff: stop.quote.type === "sell" });
  if (stop.quote.type === "job") run(s, rng, stop.quote, out, handover);
}

const seizureFacts = (goods: PerGood<number>): Seizure =>
  GOODS.filter((g) => goods[g] > 0).map((g) => [g, goods[g]]);

/** The police take every carried good. Returns what they took. */
function seize(s: GameState): PerGood<number> {
  const seized = { ...s.held };
  s.today.seized += carried(s);
  s.held = zeroGoods();
  s.paid = zeroGoods();
  return seized;
}

/** Runs a committed action exactly as quoted. Never checked again. */
function run(s: GameState, rng: Rng, q: Quote, out: DomainEvent[], handover?: CaseHandover): void {
  if (q.type === "sell") {
    const cost = saleCost(s, q.good, q.units);
    s.paid[q.good] -= cost;
    s.held[q.good] -= q.units;
    s.market[s.place][q.good].demand -= q.units;
    s.cash += q.proceeds;
    addHeat(s, q.heat);
    s.xp.patter += q.hours;
    logSale(s, q.good, q.units, q.proceeds);
    seenDoing(s, q.good, q.hours);
    out.push({ type: "sold", good: q.good, units: q.units, proceeds: q.proceeds, cost, hours: q.hours });
    return pass(s, rng, q.hours, out);
  }
  s.xp.nerve += RULES.xpNervePerJob;
  seenDoing(s, "job", q.hours);
  const success = q.success / 100;
  const r = rng.next();
  const outcome = r < success ? "success" : (r - success) / (1 - success) < 0.5 ? "nothing" : (r - success) / (1 - success) < 0.75 ? "hurt" : "arrested";
  const pay = outcome === "success" ? rng.int(q.pay[0], q.pay[1]) : 0;
  if (handover) handover.job = { outcome, pay };
  moveClock(s, s.hour + q.hours, out);
  if (outcome === "success") {
    s.cash += pay;
    s.today.jobPaid += pay;
    addHeat(s, RULES.jobSuccessHeat);
  } else {
    addHeat(s, RULES.jobFailHeat);
  }
  out.push({ type: "job", outcome, pay });
  if (outcome === "hurt") {
    s.today.hurt = true;
    return endDay(s, rng, "hurt", out);
  }
  if (outcome === "arrested") return arrest(s, rng, out, "job");
  if (s.hour >= RULES.dayEnd) endDay(s, rng, "clock", out);
}

const addHeat = (s: GameState, h: number): void => {
  s.heat = clamp(s.heat + h, 0, RULES.heatMax);
};

/** Moves the clock after an action and applies what was scheduled; 22:00 ends the day. */
function pass(s: GameState, rng: Rng, hours: number, out: DomainEvent[]): void {
  moveClock(s, s.hour + hours, out);
  if (s.hour >= RULES.dayEnd) endDay(s, rng, "clock", out);
}

/**
 * The clock after an action. An action that reaches 22:00 leaves today's remaining
 * activations to the day end, so a midday item nobody saw leads the paper.
 */
function moveClock(s: GameState, hour: number, out: DomainEvent[]): void {
  if (hour >= RULES.dayEnd) s.hour = hour;
  else clockTo(s, hour, out);
}

/** Applies activations up to `hour`. */
function clockTo(s: GameState, hour: number, out: DomainEvent[]): void {
  s.hour = hour;
  for (const event of activateUpTo(s, hour)) out.push({ type: "eventStarted", event });
}

function arrest(s: GameState, rng: Rng, out: DomainEvent[], cause: CaseArrest["cause"]): void {
  const c = caughtHere(s);
  const seized = seize(s);
  const fine = Math.min(s.cash, Math.max(RULES.fineMin, Math.ceil(RULES.fineShare * s.cash)));
  if (c) c.evidence = { ...c.evidence, arrest: { cause, place: s.place, goods: seizureFacts(seized), fine } };
  s.cash -= fine;
  s.today.fine = fine;
  s.heat = RULES.arrestHeat;
  s.today.arrested = true;
  s.nextStart = RULES.arrestStart;
  out.push({ type: "arrested", seized, fine });
  endDay(s, rng, "arrest", out);
}

/** The day end, the same however it comes (docs/design.md, "Timing"). */
function endDay(s: GameState, rng: Rng, cause: DayEndCause, out: DomainEvent[]): void {
  const endedAt = s.hour;
  clockTo(s, RULES.dayEnd, out);
  // Unseen: today's midday item started in the step that ends the day, so no screen showed it,
  // whether the day end applied it or the action that ended the day crossed 16:00.
  const started = new Set(out.flatMap((e) => (e.type === "eventStarted" ? [e.event.id] : [])));
  const unseenMidday = s.events.find((e) => e.slot === "midday" && e.startDay === s.day && started.has(e.id)) ?? null;

  const voluntary = cause === "clock" || cause === "called";
  if (voluntary) s.heat = Math.max(0, s.heat - RULES.idleCoolPerHour * (RULES.dayEnd - endedAt));
  s.heat = Math.max(0, s.heat - RULES.overnightCool);

  const crown = has(s, "crown");
  if (crown) {
    s.cash += PINCH.crownTakings;
    s.today.pub = PINCH.crownTakings;
    out.push({ type: "takings", amount: PINCH.crownTakings });
  }
  expireToday(s);
  // Pinch before tomorrow's midday item, so a sweep never lands on his operation.
  const pinch = pinchAtNight(s, rng, crown);
  rollMarket(s, rng, s.day + 1);
  scheduleMidday(s, rng, s.day + 1);
  scheduleMorning(s, rng, s.day + 2);

  recordFirsts(s, out);
  const takings = s.today.proceeds + s.today.jobPaid;
  const best = s.milestones.best;
  if (takings > 0 && (!best || takings > best.takings)) s.milestones.best = { day: s.day, takings };

  const tomorrow = s.day + 1;
  const visible = (e: WorldEvent) =>
    e.kind !== "harmless" && ((e.activated && e.endDay >= tomorrow) || (e.slot === "morning" && e.startDay === tomorrow));
  const paper: Paper = {
    day: s.day,
    unseenMidday: unseenMidday ? structuredClone(unseenMidday) : null,
    tomorrow: s.events
      .filter(visible)
      .sort((a, b) => Number(a.activated) - Number(b.activated))
      .map((e) => structuredClone(e)),
    log: structuredClone(s.today),
    cash: s.cash,
    heat: s.heat,
    pinch,
    case: structuredClone(s.detective.case),
    firsts: MILESTONES.filter((m) => s.milestones.firsts[m] === s.day),
    crown,
  };
  s.paper = paper;
  s.news = [...s.news, paper].slice(-RULES.newsCap);
  s.phase = "night";
  s.pending = null;
  out.push({ type: "dayEnded", cause, paper });
}

function startDay(s: GameState, rng: Rng, out: DomainEvent[]): void {
  s.day += 1;
  s.phase = "day";
  s.paper = null;
  s.jobDone = false;
  s.calls = 0;
  s.seenToday = [s.place];
  s.tipsGiven = {};
  s.priceTips = [];
  s.rumour = null;
  s.today = emptyLog(s.cash);
  const hour = s.nextStart;
  s.nextStart = RULES.dayStart;
  clockTo(s, hour, out);
  out.push({ type: "dayStarted", day: s.day, hour });
  // The day between the announcement and the operation opens with Lenny's false trail.
  const c = s.detective.case;
  if (c && s.day === operationStart(c) - 1) {
    const id = TRAIL.find((t) => conditionsHold(s, CARDS[t].when));
    if (id) showCard(s, rng, id, out);
  }
}

/** Records the prices where the player stands, for the goods it deals in. */
function remember(s: GameState): void {
  for (const g of GOODS) if (deals(s.place, g)) s.memory[s.place][g] = { price: price(s, s.place, g), day: s.day, hour: s.hour };
}

/** Every sale, at market or on a card, goes through here: the log, the best sale, the first. */
function logSale(s: GameState, good: GoodId, units: number, proceeds: number): void {
  s.milestones.firsts.sale ??= s.day;
  s.today.sold += units;
  s.today.proceeds += proceeds;
  if (!s.today.best || proceeds > s.today.best.proceeds) s.today.best = { good, units, proceeds, place: s.place };
}

/** Records the day of each first that these events or the cash reached. Idempotent. */
function recordFirsts(s: GameState, events: readonly DomainEvent[]): void {
  const firsts = s.milestones.firsts;
  const mark = (m: MilestoneId) => {
    firsts[m] ??= s.day;
  };
  for (const e of events) {
    if (e.type === "upgraded") mark(e.upgrade);
    else if (e.type === "job" && e.outcome === "success") mark("job");
    else if (e.type === "arrested") mark("arrest");
    else if (e.type === "leggedIt" && e.success) mark("escape");
  }
  if (s.cash >= PINCH.grand) mark("grand");
}

// ---- Cards -------------------------------------------------------------------------

const BANDS = ["low", "warm", "hot", "wanted"] as const;

export function conditionsHold(s: GameState, c: Conditions): boolean {
  if (c.day !== undefined && s.day < c.day) return false;
  if (c.at !== undefined && s.place !== c.at) return false;
  if (c.holding) {
    const n = c.holding.good === "any" ? carried(s) : s.held[c.holding.good];
    if (n < c.holding.min) return false;
  }
  if (c.cash !== undefined && s.cash < c.cash) return false;
  const band = BANDS.indexOf(heatWord(s.heat));
  if (c.heatAtLeast && band < BANDS.indexOf(c.heatAtLeast)) return false;
  if (c.heatAtMost && band > BANDS.indexOf(c.heatAtMost)) return false;
  if (c.owns && !has(s, c.owns)) return false;
  if (c.lacks && has(s, c.lacks)) return false;
  if (c.detective === "announced" && !announced(s)) return false;
  if (c.detective === "operation" && !PLACES.some((p) => operationOn(s, p))) return false;
  if (c.promoted !== undefined && s.detective.promoted !== c.promoted) return false;
  if (c.flag) {
    const set = s.flags[c.flag.id];
    if (c.flag.set ? set === undefined || s.day - set < (c.flag.days ?? 0) : set !== undefined) return false;
  }
  return true;
}

/** A card that showed rests ten days; a once-only card never shows again. */
export function cardResting(s: GameState, id: CardId): boolean {
  const shown = s.cards[id];
  return shown !== undefined && (CARDS[id].once === true || s.day < shown + CARDS_RULES.rest);
}

export const chanceOdds = (s: GameState, c: Chance): number =>
  clamp(c.base + (c.skill ? CARDS_RULES.perLevel * skill(s, c.skill) : 0), RULES.oddsMin, RULES.oddsMax);

/** Goods a gain gives: up to the free pockets, at its share of the stated total. */
export function gainOf(s: GameState, e: Extract<Effect, { kind: "gain" }>): { units: number; cost: number } {
  const units = Math.max(0, Math.min(e.units, pockets(s) - carried(s)));
  return { units, cost: Math.round((e.cost * units) / e.units) };
}

/** A card sells only held units, and only where the good is dealt. */
export const cardSells = (s: GameState, e: Extract<Effect, { kind: "sell" }>): boolean =>
  deals(s.place, e.good) && s.held[e.good] >= e.units;

/** What a card's sale pays: the current price there × its factor; null where it can't sell. */
export const cardSale = (s: GameState, e: Extract<Effect, { kind: "sell" }>): number | null =>
  cardSells(s, e) ? Math.round(e.units * price(s, s.place, e.good) * e.factor) : null;

/**
 * Why a choice can't be taken now. Only its certain effects count; a chance's loss is capped by
 * the cash. A card sells only where the good is dealt.
 */
export function choiceBlock(s: GameState, choice: Choice): "noCash" | "noPockets" | "noGoods" | null {
  let cost = 0;
  for (const e of choice.effects) {
    if (e.kind === "cash" && e.amount < 0) cost -= e.amount;
    if (e.kind === "gain") {
      const g = gainOf(s, e);
      if (g.units === 0) return "noPockets";
      cost += g.cost;
    }
    if (e.kind === "sell" && !cardSells(s, e)) return "noGoods";
  }
  return s.cash < cost ? "noCash" : null;
}

/** Today's midday item, if it is a harmless line and already active. */
const harmlessToday = (s: GameState): string | null =>
  s.events.find((e) => e.slot === "midday" && e.kind === "harmless" && e.startDay === s.day && e.activated)?.id ?? null;

/** The first card of the pool that fits takes the harmless line's place. */
function encounter(s: GameState, rng: Rng, eventId: string, out: DomainEvent[]): void {
  const id = POOL.find((c) => !cardResting(s, c) && conditionsHold(s, CARDS[c].when));
  if (!id) return;
  s.events = s.events.filter((e) => e.id !== eventId);
  showCard(s, rng, id, out);
}

/** A card with choices waits for the player; a report applies at once. */
function showCard(s: GameState, rng: Rng, id: CardId, out: DomainEvent[]): void {
  const card = CARDS[id];
  s.cards[id] = s.day;
  if (card.choices.length === 0) return settle(s, rng, id, null, card.report ?? [], null, out);
  const chance = card.choices.find((c) => c.chance)?.chance;
  s.pending = { kind: "card", card: id, odds: chance ? chanceOdds(s, chance) : null };
  out.push({ type: "card", pending: s.pending });
}

function resolveCard(s: GameState, rng: Rng, choiceId: string, out: DomainEvent[]): void {
  const pending = s.pending as PendingCard;
  s.pending = null;
  const choice = CARDS[pending.card].choices.find((c) => c.id === choiceId) as Choice;
  let effects = choice.effects;
  let won: boolean | null = null;
  if (choice.chance) {
    won = rng.chance((pending.odds ?? chanceOdds(s, choice.chance)) / 100);
    effects = [...effects, ...(won ? choice.chance.win : choice.chance.lose)];
  }
  settle(s, rng, pending.card, choice.id, effects, won, out);
}

/** Applies a card's effects in order; a tip and any hours follow its result, so a day end comes last. */
function settle(
  s: GameState,
  rng: Rng,
  card: CardId,
  choice: string | null,
  effects: readonly Effect[],
  won: boolean | null,
  out: DomainEvent[],
): void {
  const cash = s.cash;
  const held = { ...s.held };
  let hours = 0;
  let tip = false;
  let places: PlaceId[] | null = null;
  for (const e of effects) {
    switch (e.kind) {
      case "cash":
        s.cash = Math.max(0, s.cash + e.amount);
        break;
      case "heat":
        addHeat(s, e.amount);
        break;
      case "gain": {
        const g = gainOf(s, e);
        s.cash -= g.cost;
        s.held[e.good] += g.units;
        s.paid[e.good] += g.cost;
        s.today.bought += g.units;
        s.today.spent += g.cost;
        break;
      }
      case "sell": {
        // Checked again here: a chance's or a report's effects skip choiceBlock.
        const proceeds = cardSale(s, e);
        if (proceeds === null) break;
        const cost = saleCost(s, e.good, e.units);
        s.paid[e.good] -= cost;
        s.held[e.good] -= e.units;
        s.cash += proceeds;
        logSale(s, e.good, e.units, proceeds);
        break;
      }
      case "lose": {
        const good = GOODS.reduce((a, b) => (s.held[b] > s.held[a] ? b : a));
        if (s.held[good] === 0) break;
        const units = Math.max(1, Math.floor(s.held[good] * e.share));
        s.paid[good] -= saleCost(s, good, units);
        s.held[good] -= units;
        s.today.seized += units;
        break;
      }
      case "xp":
        s.xp[e.skill] += e.amount;
        break;
      case "hours":
        hours += e.hours;
        break;
      case "flag":
        if (e.set) s.flags[e.id] = s.day;
        else delete s.flags[e.id];
        break;
      case "tip":
        tip = true;
        break;
      case "moveOperation": {
        const c = s.detective.case;
        const from = c?.places;
        places = moveOperation(s, rng);
        if (c && from && c.places !== from) c.trail = { from, cost: cash - s.cash };
        break;
      }
    }
  }
  const goods = perGood((g) => s.held[g] - held[g]);
  out.push({ type: "cardResolved", card, choice, won, cash: s.cash - cash, goods, places });
  if (tip) {
    const t = cardTip(s);
    const tipPrice = price(s, t.place, t.good);
    if (!s.priceTips.includes(`${t.place}:${t.good}`)) s.priceTips.push(`${t.place}:${t.good}`);
    s.memory[t.place][t.good] = { price: tipPrice, day: s.day, hour: s.hour };
    out.push({ type: "tip", tip: { kind: "price", ...t, price: tipPrice } });
  }
  if (hours > 0) {
    // Hours on a card (running, ducking into a doorway) are hours seen keeping your head down.
    const spent = Math.min(hours, hoursLeft(s));
    seenDoing(s, "lieLow", spent);
    pass(s, rng, spent, out);
  }
}
