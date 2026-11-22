// The market and the world-event schedule: daily rolls, reservations, activation, and the
// values derived from them (prices, police). Everything here works on a state the caller
// owns; `step` in sim.ts clones before calling in.

import {
  DAY1_PRICES as DAY1,
  GOOD,
  GOODS,
  HARMLESS,
  PINCH,
  PLACE,
  PLACES,
  RULES,
  day1DocksStock,
  deals,
  dealers,
  factor,
  isSource,
  type GoodId,
  type PlaceId,
  type SkillId,
} from "./content.ts";
import type { Rng } from "./rng.ts";
import type { Cell, GameState, MarketKind, OpenCase, PerGood, PerPlace, Rumour, WorldEvent } from "./state.ts";

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const atLeast1 = (x: number): number => Math.max(1, Math.round(x));

export const level = (xp: number): number => RULES.levels.filter((t) => xp >= t).length;
export const skill = (s: GameState, id: SkillId): number => level(s.xp[id]);

/** Absolute hour, for comparing times across days. */
export const at = (day: number, hour: number): number => day * 24 + hour;
const startOf = (e: WorldEvent): number => at(e.startDay, e.startHour);
const endOf = (e: WorldEvent): number => at(e.endDay, RULES.dayEnd);

export const ringDistance = (a: PlaceId, b: PlaceId): number => {
  const d = Math.abs(PLACES.indexOf(a) - PLACES.indexOf(b));
  return Math.min(d, PLACES.length - d);
};

// ---- Derived values ----------------------------------------------------------------

export const marketEventOn = (s: GameState, place: PlaceId, good: GoodId) =>
  s.events.find(
    (e): e is Extract<WorldEvent, { kind: MarketKind }> =>
      e.activated && (e.kind === "shortage" || e.kind === "glut") && e.place === place && e.good === good,
  );

export const sweepOn = (s: GameState, place: PlaceId): boolean =>
  s.events.some((e) => e.activated && e.kind === "sweep" && e.place === place);

export function price(s: GameState, place: PlaceId, good: GoodId): number {
  const cell = s.market[place][good];
  const ev = marketEventOn(s, place, good);
  if (!ev) return cell.baseline;
  return atLeast1(cell.baseline * (ev.kind === "shortage" ? RULES.shortage.price : RULES.glut.price));
}

/** The first day of a case's operation; it runs from 10:00 that day for `PINCH.operationDays` days. */
export const operationStart = (c: OpenCase): number => c.announced + PINCH.warning;
export const operationWindow = (c: OpenCase): [number, number] => [
  at(operationStart(c), RULES.dayStart),
  at(operationStart(c) + PINCH.operationDays - 1, RULES.dayEnd),
];

/** Pinch's operation is on at this place today. */
export function operationOn(s: GameState, place: PlaceId): boolean {
  const c = s.detective.case;
  if (!c || !c.places.includes(place)) return false;
  const start = operationStart(c);
  return s.day >= start && s.day < start + PINCH.operationDays;
}

/** A sweep and an operation never overlap, so a place's police factor doubles at most once. */
export const police = (s: GameState, place: PlaceId): number =>
  PLACE[place].police * (sweepOn(s, place) ? RULES.sweepPolice : operationOn(s, place) ? PINCH.police : 1);

/** The city's usual price for a good: base × the mean factor of the places that deal in it. Hints compare against it. */
export const usualPrice = (good: GoodId): number => {
  const at = dealers(good);
  return (GOOD[good].base * at.reduce((sum, p) => sum + factor(p, good), 0)) / at.length;
};

export function priceHint(s: GameState, place: PlaceId, good: GoodId): "cheap" | "pricey" | null {
  const ratio = price(s, place, good) / usualPrice(good);
  if (ratio <= 0.8) return "cheap";
  if (ratio >= 1.2) return "pricey";
  return null;
}

export function heatWord(heat: number): "low" | "warm" | "hot" | "wanted" {
  for (const [min, word] of RULES.heatWords) if (heat >= min) return word;
  return "low";
}

export function riskWord(p: number): "slight" | "some" | "real" | "high" {
  if (p < 0.05) return "slight";
  if (p < 0.15) return "some";
  if (p < 0.3) return "real";
  return "high";
}

// ---- Market effects and rolls ------------------------------------------------------

/** Applies a market event to a cell's remaining stock and demand (R and Rd in the design). */
function applyEffect(cell: Cell, kind: MarketKind): void {
  if (kind === "shortage") {
    cell.stock = Math.floor(RULES.shortage.stock * cell.stock);
    cell.demand = Math.round(RULES.shortage.demand * cell.demand);
  } else {
    cell.stock = cell.stock + cell.freshStock;
  }
}

/** Base stock and demand of a dealt pair (an undealt one has neither). */
export const baseStock = (place: PlaceId, good: GoodId): number =>
  !deals(place, good) ? 0 : isSource(place, good) ? GOOD[good].stockAtSource : GOOD[good].stockElsewhere;
const baseDemand = (place: PlaceId, good: GoodId): number => GOOD[good].rate * RULES.demandHours * factor(place, good);
/** A dealt pair's demand before noise: `RULES.demandHours` of selling, at least one unit. */
export const neutralDemand = (place: PlaceId, good: GoodId): number => (deals(place, good) ? atLeast1(baseDemand(place, good)) : 0);
/** A dealt pair's price at drift 1, no event. */
export const neutralPrice = (place: PlaceId, good: GoodId): number => atLeast1(GOOD[good].base * factor(place, good));

/**
 * An undealt pair's cell: no stock, no demand. Its baseline is never shown or traded at; it
 * holds the usual price so every cell stays a valid price.
 */
export const undealtCell = (good: GoodId): Cell => ({
  baseline: atLeast1(usualPrice(good)),
  freshStock: 0,
  freshDemand: 0,
  stock: 0,
  demand: 0,
});

function perPlace<T>(make: (p: PlaceId) => T): PerPlace<T> {
  return Object.fromEntries(PLACES.map((p) => [p, make(p)])) as PerPlace<T>;
}
export function perGood<T>(make: (g: GoodId) => T): PerGood<T> {
  return Object.fromEntries(GOODS.map((g) => [g, make(g)])) as PerGood<T>;
}

/** Day 1's authored market: fixture prices, base totals without noise. */
export function fixtureMarket(): PerPlace<PerGood<Cell>> {
  return perPlace((p) =>
    perGood((g) => {
      if (!deals(p, g)) return undealtCell(g);
      const freshStock = (p === "docks" ? day1DocksStock(g) : null) ?? baseStock(p, g);
      const freshDemand = neutralDemand(p, g);
      return { baseline: DAY1[p][g] ?? neutralPrice(p, g), freshStock, freshDemand, stock: freshStock, demand: freshDemand };
    }),
  );
}

export const flatDrift = (): PerPlace<PerGood<number>> => perPlace(() => perGood(() => 1));

/** Rolls `day`'s baseline, stock and demand; events still running that day apply at once. Undealt pairs draw nothing. */
export function rollMarket(s: GameState, rng: Rng, day: number): void {
  for (const p of PLACES) {
    for (const g of GOODS) {
      if (!deals(p, g)) {
        s.market[p][g] = undealtCell(g);
        continue;
      }
      const drift = clamp(
        1 + RULES.driftReversion * (s.drift[p][g] - 1) + rng.normal() * GOOD[g].vol,
        RULES.driftMin,
        RULES.driftMax,
      );
      s.drift[p][g] = drift;
      const freshStock = Math.max(0, Math.round(baseStock(p, g) * rng.range(...RULES.stockNoise)));
      const freshDemand = atLeast1(baseDemand(p, g) * rng.range(...RULES.demandNoise));
      s.market[p][g] = {
        baseline: atLeast1(GOOD[g].base * factor(p, g) * drift),
        freshStock,
        freshDemand,
        stock: freshStock,
        demand: freshDemand,
      };
    }
  }
  for (const e of s.events) {
    if (e.activated && e.endDay >= day && (e.kind === "shortage" || e.kind === "glut")) {
      applyEffect(s.market[e.place][e.good], e.kind);
    }
  }
}

// ---- The schedule ------------------------------------------------------------------

const overlaps = (e: WorldEvent, start: number, end: number): boolean =>
  startOf(e) <= end && start <= endOf(e);

function freePairs(s: GameState, start: number, end: number): { place: PlaceId; good: GoodId }[] {
  const out: { place: PlaceId; good: GoodId }[] = [];
  for (const place of PLACES) {
    for (const good of GOODS) {
      if (!deals(place, good)) continue;
      const taken = s.events.some(
        (e) =>
          (e.kind === "shortage" || e.kind === "glut") &&
          e.place === place &&
          e.good === good &&
          overlaps(e, start, end),
      );
      if (!taken) out.push({ place, good });
    }
  }
  return out;
}

/** A sweep covers this place at some time in [start, end]. */
export const sweepCovers = (s: GameState, place: PlaceId, start: number, end: number): boolean =>
  s.events.some((e) => e.kind === "sweep" && e.place === place && overlaps(e, start, end));

/** Places a sweep may cover in [start, end]: no sweep there and no operation, under the overlap rule. */
function freePlaces(s: GameState, start: number, end: number): PlaceId[] {
  const c = s.detective.case;
  const [opStart, opEnd] = c ? operationWindow(c) : [0, -1];
  return PLACES.filter(
    (place) =>
      !sweepCovers(s, place, start, end) && !(c?.places.includes(place) && opStart <= end && start <= opEnd),
  );
}

const marketKind = (rng: Rng): MarketKind => (rng.chance(0.5) ? "shortage" : "glut");

/** The midday item for `day`: hidden until 16:00, active until 22:00 the next day. */
export function scheduleMidday(s: GameState, rng: Rng, day: number): void {
  const base = { id: `d${day}-midday`, slot: "midday", startDay: day, startHour: RULES.midday, endDay: day + 1, activated: false } as const;
  const start = at(day, RULES.midday);
  const end = at(day + 1, RULES.dayEnd);
  const r = rng.next();
  if (r < RULES.middayMarketChance) {
    const free = freePairs(s, start, end);
    if (free.length > 0) {
      const { place, good } = rng.pick(free);
      s.events.push({ ...base, kind: marketKind(rng), place, good });
      return;
    }
  } else if (r < RULES.middayMarketChance + RULES.middaySweepChance) {
    const free = freePlaces(s, start, end);
    if (free.length > 0) {
      s.events.push({ ...base, kind: "sweep", place: rng.pick(free) });
      return;
    }
  }
  s.events.push({ ...base, kind: "harmless", line: rng.pick(HARMLESS) });
}

/** The morning event for `day`, on half of all days: active 10:00 that day through 22:00 the next. */
export function scheduleMorning(s: GameState, rng: Rng, day: number): void {
  if (!rng.chance(RULES.morningEventChance)) return;
  const free = freePairs(s, at(day, RULES.dayStart), at(day + 1, RULES.dayEnd));
  if (free.length === 0) return;
  const { place, good } = rng.pick(free);
  s.events.push({
    id: `d${day}-morning`,
    slot: "morning",
    startDay: day,
    startHour: RULES.dayStart,
    endDay: day + 1,
    activated: false,
    kind: marketKind(rng),
    place,
    good,
  });
}

/** Applies every activation scheduled today at or before `hour`, in time order. */
export function activateUpTo(s: GameState, hour: number): WorldEvent[] {
  const due = s.events
    .filter((e) => !e.activated && e.startDay === s.day && e.startHour <= hour)
    .sort((a, b) => a.startHour - b.startHour);
  for (const e of due) {
    e.activated = true;
    if (e.kind === "shortage" || e.kind === "glut") applyEffect(s.market[e.place][e.good], e.kind);
  }
  return due;
}

export function expireToday(s: GameState): void {
  s.events = s.events.filter((e) => e.endDay > s.day);
}

/** The morning event scheduled for tomorrow, if any. */
export const tomorrowsMorning = (s: GameState) =>
  s.events.find(
    (e): e is Extract<WorldEvent, { kind: MarketKind }> =>
      e.slot === "morning" && e.startDay === s.day + 1 && (e.kind === "shortage" || e.kind === "glut"),
  );

export const rumourAccuracy = (savvy: number): number => RULES.rumourTruth + RULES.savvyRumour * savvy;

/** Draws the day's rumour about tomorrow. True with 70% + 5 points per Savvy level. */
export function drawRumour(s: GameState, rng: Rng, via: Rumour["via"]): Rumour {
  const truthChance = rumourAccuracy(skill(s, "savvy")) / 100;
  const event = tomorrowsMorning(s);
  if (rng.chance(truthChance)) {
    return { claim: event ? { kind: event.kind, place: event.place, good: event.good } : null, truthful: true, via };
  }
  const tomorrow = s.day + 1;
  const free = freePairs(s, at(tomorrow, RULES.dayStart), at(tomorrow, RULES.dayEnd));
  const { place, good } = rng.pick(free.length > 0 ? free : [{ place: "docks" as PlaceId, good: "smokes" as GoodId }]);
  return { claim: { kind: marketKind(rng), place, good }, truthful: false, via };
}
