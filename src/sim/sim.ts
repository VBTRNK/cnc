// The simulation: state plus a validated action gives a new state plus domain events.
// Pure and deterministic: no wall clock, no UI, randomness only from the generator
// position saved in the state. An invalid action returns a refusal and draws nothing.

import {
  GOOD,
  GOODS,
  PLACES,
  RULES,
  SKILLS,
  UPGRADES,
  UPGRADE_COST,
  type GoodId,
  type PlaceId,
  type SkillId,
  type UpgradeId,
} from "./content.ts";
import {
  activateUpTo,
  clamp,
  drawRumour,
  expireToday,
  fixtureMarket,
  flatDrift,
  perGood,
  police,
  price,
  ringDistance,
  rollMarket,
  scheduleMidday,
  scheduleMorning,
  skill,
} from "./market.ts";
import { Rng, seedState } from "./rng.ts";
import type {
  DayLog,
  GameState,
  JobQuote,
  Paper,
  PendingStop,
  PerGood,
  Quote,
  Rumour,
  SaleQuote,
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
  | { type: "stash"; good: GoodId; units: number }
  | { type: "unstash"; good: GoodId; units: number }
  | { type: "callItADay" }
  | { type: "resolveStop"; choice: "bribe" | "legIt" | "handOver" }
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
  | "noGoods"
  | "samePlace"
  | "jobDone"
  | "noTips"
  | "owned"
  | "notHere"
  | "noLockup"
  | "lockupFull"
  | "bribeRefused";

export interface PriceTip {
  kind: "price";
  place: PlaceId;
  good: GoodId;
  price: number;
}

export type DomainEvent =
  | { type: "bought"; good: GoodId; units: number; cost: number }
  | { type: "sold"; good: GoodId; units: number; proceeds: number; hours: number }
  | { type: "travelled"; from: PlaceId; to: PlaceId; hours: number }
  | { type: "tip"; tip: PriceTip | ({ kind: "rumour" } & Rumour) }
  | { type: "laidLow"; heat: number }
  | { type: "oddJob"; pay: number }
  | { type: "job"; outcome: "success" | "nothing" | "hurt" | "arrested"; pay: number }
  | { type: "stopped"; stop: PendingStop }
  | { type: "pattedDown" }
  | { type: "bribed"; amount: number }
  | { type: "leggedIt"; success: boolean }
  | { type: "handedOver"; seized: PerGood<number>; saleOff: boolean }
  | { type: "arrested"; seized: PerGood<number>; fine: number }
  | { type: "upgraded"; upgrade: UpgradeId; cost: number }
  | { type: "stashed"; good: GoodId; units: number }
  | { type: "unstashed"; good: GoodId; units: number }
  | { type: "eventStarted"; event: WorldEvent }
  | { type: "levelUp"; skill: SkillId; level: number }
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
    lockup: zeroGoods(),
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
    seenToday: [RULES.startPlace],
    tipsGiven: {},
    priceTips: [],
    rumour: null,
    memory: { docks: {}, oldtown: {}, uptown: {}, strip: {} },
    pending: null,
    today: emptyLog(RULES.startCash),
    paper: null,
    news: [],
  };
  remember(s);
  return s;
}

// ---- Queries -----------------------------------------------------------------------

export const has = (s: GameState, u: UpgradeId): boolean => s.upgrades.includes(u);
export const pockets = (s: GameState): number => (has(s, "coat") ? RULES.coatPockets : RULES.pockets);
export const carried = (s: GameState): number => GOODS.reduce((n, g) => n + s.held[g], 0);
export const stored = (s: GameState): number => GOODS.reduce((n, g) => n + s.lockup[g], 0);
export const hoursLeft = (s: GameState): number => RULES.dayEnd - s.hour;

/** Patter's selling rate as tenths of units per hour, so the rounding is exact. */
const rateTenths = (s: GameState, good: GoodId): number => GOOD[good].rate * (10 + skill(s, "patter"));
export const saleHours = (s: GameState, good: GoodId, units: number): number =>
  Math.ceil((units * 10) / rateTenths(s, good));
const unitsIn = (s: GameState, good: GoodId, hours: number): number =>
  Math.floor((hours * rateTenths(s, good)) / 10);

export function stopChance(s: GameState, hours: number): number {
  const perHour = (RULES.stopBase + RULES.stopPerHeat * s.heat) * police(s, s.place);
  return 1 - (1 - perHour) ** hours;
}

const odds = (s: GameState, base: number): number =>
  clamp(base + RULES.oddsPerNerve * skill(s, "nerve") - RULES.oddsPerHeat * s.heat, RULES.oddsMin, RULES.oddsMax);

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
  if (has(s, "phone")) return null;
  const places = PLACES.filter((p) => !s.seenToday.includes(p)).sort(
    (a, b) => ringDistance(s.place, a) - ringDistance(s.place, b) || PLACES.indexOf(a) - PLACES.indexOf(b),
  );
  for (const good of tipGoods(s)) {
    const place = places.find((p) => !s.priceTips.includes(`${p}:${good}`));
    if (place) return { place, good };
  }
  return null;
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
    if (!s.pending) return "noPending";
    if (a.choice === "bribe" && s.pending.bribe === null) return "bribeRefused";
    return ["bribe", "legIt", "handOver"].includes(a.choice) ? null : "unknown";
  }
  if (s.pending) return "pending";
  switch (a.type) {
    case "buy": {
      if (!isGood(a.good)) return "unknown";
      if (!isUnits(a.units)) return "badUnits";
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
    case "stash":
    case "unstash": {
      if (!isGood(a.good)) return "unknown";
      if (!isUnits(a.units)) return "badUnits";
      if (!has(s, "lockup")) return "noLockup";
      if (s.place !== RULES.lockupPlace) return "notHere";
      if (a.type === "stash") {
        if (s.held[a.good] < a.units) return "noGoods";
        return stored(s) + a.units > RULES.lockupCapacity ? "lockupFull" : null;
      }
      if (s.lockup[a.good] < a.units) return "noGoods";
      return carried(s) + a.units > pockets(s) ? "noPockets" : null;
    }
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

  apply(s, rng, action, out);

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
      s.xp.savvy += 1;
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
      s.heat = Math.max(0, s.heat - RULES.lieLowHeat);
      out.push({ type: "laidLow", heat: s.heat });
      return pass(s, rng, RULES.lieLowHours, out);
    case "oddJob":
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
    case "stash":
      s.held[a.good] -= a.units;
      s.lockup[a.good] += a.units;
      out.push({ type: "stashed", good: a.good, units: a.units });
      return;
    case "unstash":
      s.lockup[a.good] -= a.units;
      s.held[a.good] += a.units;
      out.push({ type: "unstashed", good: a.good, units: a.units });
      return;
    case "callItADay":
      return endDay(s, rng, "called", out);
    case "resolveStop":
      return resolveStop(s, rng, a.choice, out);
    case "startDay":
      return startDay(s, out);
  }
}

/** A sale or a job: the stop check at commit, then the card or the action as quoted. */
function commitChecked(s: GameState, rng: Rng, quote: Quote, out: DomainEvent[]): void {
  if (!rng.chance(quote.stopChance)) return run(s, rng, quote, out);
  s.today.stops += 1;
  if (carried(s) === 0) {
    out.push({ type: "pattedDown" });
    return run(s, rng, quote, out);
  }
  const value = GOODS.reduce((sum, g) => sum + s.held[g] * price(s, s.place, g), 0);
  const bribe = Math.ceil(RULES.bribeBase + RULES.bribeShare * value + RULES.bribePerHeat * s.heat);
  const refusal = s.heat >= RULES.bribeMaxHeat ? "wanted" : s.cash < bribe ? "short" : null;
  s.pending = { kind: "stop", quote, bribe: refusal ? null : bribe, bribeRefusal: refusal };
  out.push({ type: "stopped", stop: s.pending });
}

function resolveStop(s: GameState, rng: Rng, choice: "bribe" | "legIt" | "handOver", out: DomainEvent[]): void {
  const stop = s.pending as PendingStop;
  s.pending = null;
  s.xp.nerve += RULES.xpNervePerStop;
  if (choice === "bribe") {
    const amount = stop.bribe as number;
    s.cash -= amount;
    addHeat(s, RULES.bribeHeat);
    out.push({ type: "bribed", amount });
    return run(s, rng, stop.quote, out);
  }
  if (choice === "legIt") {
    const success = rng.chance(stop.quote.legIt / 100);
    out.push({ type: "leggedIt", success });
    if (!success) return arrest(s, rng, out);
    addHeat(s, RULES.legItHeat);
    return run(s, rng, stop.quote, out);
  }
  const seized = { ...s.held };
  s.held = zeroGoods();
  out.push({ type: "handedOver", seized, saleOff: stop.quote.type === "sell" });
  if (stop.quote.type === "job") run(s, rng, stop.quote, out);
}

/** Runs a committed action exactly as quoted. Never checked again. */
function run(s: GameState, rng: Rng, q: Quote, out: DomainEvent[]): void {
  if (q.type === "sell") {
    s.held[q.good] -= q.units;
    s.market[s.place][q.good].demand -= q.units;
    s.cash += q.proceeds;
    addHeat(s, q.heat);
    s.xp.patter += q.hours;
    s.today.sold += q.units;
    s.today.proceeds += q.proceeds;
    out.push({ type: "sold", good: q.good, units: q.units, proceeds: q.proceeds, hours: q.hours });
    return pass(s, rng, q.hours, out);
  }
  s.xp.nerve += RULES.xpNervePerJob;
  const success = q.success / 100;
  const r = rng.next();
  const outcome = r < success ? "success" : (r - success) / (1 - success) < 0.5 ? "nothing" : (r - success) / (1 - success) < 0.75 ? "hurt" : "arrested";
  const pay = outcome === "success" ? rng.int(q.pay[0], q.pay[1]) : 0;
  moveClock(s, rng, s.hour + q.hours, out);
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
  if (outcome === "arrested") return arrest(s, rng, out);
  if (s.hour >= RULES.dayEnd) endDay(s, rng, "clock", out);
}

const addHeat = (s: GameState, h: number): void => {
  s.heat = clamp(s.heat + h, 0, RULES.heatMax);
};

/** Moves the clock after an action and applies what was scheduled; 22:00 ends the day. */
function pass(s: GameState, rng: Rng, hours: number, out: DomainEvent[]): void {
  moveClock(s, rng, s.hour + hours, out);
  if (s.hour >= RULES.dayEnd) endDay(s, rng, "clock", out);
}

/**
 * The clock after an action. An action that reaches 22:00 leaves today's remaining
 * activations to the day end, so a midday item nobody saw leads the paper.
 */
function moveClock(s: GameState, rng: Rng, hour: number, out: DomainEvent[]): void {
  if (hour >= RULES.dayEnd) s.hour = hour;
  else clockTo(s, hour, out, rng);
}

/** Applies activations up to `hour`. With a generator, the phone's midday line can fire. */
function clockTo(s: GameState, hour: number, out: DomainEvent[], rng?: Rng): void {
  s.hour = hour;
  for (const event of activateUpTo(s, hour)) {
    out.push({ type: "eventStarted", event });
    // The phone's midday line spends the day's rumour if nobody has used it yet.
    if (rng && event.slot === "midday" && has(s, "phone") && s.rumour === null) {
      s.rumour = drawRumour(s, rng, "phone");
      out.push({ type: "tip", tip: { kind: "rumour", ...s.rumour } });
    }
  }
}

function arrest(s: GameState, rng: Rng, out: DomainEvent[]): void {
  const seized = { ...s.held };
  s.held = zeroGoods();
  const fine = Math.min(s.cash, Math.max(RULES.fineMin, Math.ceil(RULES.fineShare * s.cash)));
  s.cash -= fine;
  s.heat = RULES.arrestHeat;
  s.today.arrested = true;
  s.nextStart = RULES.arrestStart;
  out.push({ type: "arrested", seized, fine });
  endDay(s, rng, "arrest", out);
}

/** The day end, the same however it comes (docs/design.md, "Timing"). */
function endDay(s: GameState, rng: Rng, cause: DayEndCause, out: DomainEvent[]): void {
  const endedAt = s.hour;
  const before = new Set(s.events.filter((e) => e.activated).map((e) => e.id));
  clockTo(s, RULES.dayEnd, out);
  const unseenMidday = s.events.find((e) => e.slot === "midday" && e.startDay === s.day && !before.has(e.id)) ?? null;

  const voluntary = cause === "clock" || cause === "called";
  if (voluntary) s.heat = Math.max(0, s.heat - RULES.idleCoolPerHour * (RULES.dayEnd - endedAt));
  s.heat = Math.max(0, s.heat - RULES.overnightCool);

  expireToday(s);
  rollMarket(s, rng, s.day + 1);
  scheduleMidday(s, rng, s.day + 1);
  scheduleMorning(s, rng, s.day + 2);

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
    log: { ...s.today },
    cash: s.cash,
    heat: s.heat,
  };
  s.paper = paper;
  s.news = [...s.news, paper].slice(-RULES.newsCap);
  s.phase = "night";
  s.pending = null;
  out.push({ type: "dayEnded", cause, paper });
}

function startDay(s: GameState, out: DomainEvent[]): void {
  s.day += 1;
  s.phase = "day";
  s.paper = null;
  s.jobDone = false;
  s.seenToday = [s.place];
  s.tipsGiven = {};
  s.priceTips = [];
  s.rumour = null;
  s.today = emptyLog(s.cash);
  const hour = s.nextStart;
  s.nextStart = RULES.dayStart;
  clockTo(s, hour, out);
  out.push({ type: "dayStarted", day: s.day, hour });
}

/** Records the prices where the player stands. */
function remember(s: GameState): void {
  for (const g of GOODS) s.memory[s.place][g] = { price: price(s, s.place, g), day: s.day, hour: s.hour };
}
