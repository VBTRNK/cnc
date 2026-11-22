// Detective Sergeant Percy Pinch (docs/design.md, "The detective, events and cast"): a
// tally of where the player is seen, a theory on the top place, a warned operation, its
// resolution and his one promotion. Works on a state the caller owns, like market.ts.

import { HABITS, PINCH, PLACES, RULES, type HabitId, type PlaceId } from "./content.ts";
import { at, operationOn, operationStart, operationWindow, sweepCovers } from "./market.ts";
import type { Rng } from "./rng.ts";
import type { Detective, GameState, OpenCase, PastCase, PinchItem } from "./state.ts";

export const newDetective = (): Detective => ({
  seen: { docks: {}, oldtown: {}, uptown: {}, strip: {} },
  case: null,
  next: PINCH.firstCase,
  promoted: false,
});

/** His tally for a place: every hour seen there, halved each night. */
export const tally = (s: GameState, place: PlaceId): number =>
  Object.values(s.detective.seen[place]).reduce((sum, n) => sum + (n ?? 0), 0);

/** Hours of a timed action where the player stands. Travel adds nothing. */
export function seenDoing(s: GameState, habit: HabitId, hours: number): void {
  const seen = s.detective.seen[s.place];
  seen[habit] = (seen[habit] ?? 0) + hours;
}

/** What he saw most at a place; a tie goes to the first in catalogue order. */
function topHabit(s: GameState, place: PlaceId): HabitId {
  const seen = s.detective.seen[place];
  return HABITS.reduce((best, h) => ((seen[h] ?? 0) > (seen[best] ?? 0) ? h : best), HABITS[0]);
}

/**
 * The `n` places with the highest (or lowest) tallies among `from`, in that order. Ties are
 * drawn from the generator, and only when there is a tie.
 */
function ranked(s: GameState, rng: Rng, from: readonly PlaceId[], n: number, order: "top" | "bottom"): PlaceId[] {
  const left = [...from];
  const out: PlaceId[] = [];
  while (out.length < n && left.length > 0) {
    const values = left.map((p) => tally(s, p));
    const best = order === "top" ? Math.max(...values) : Math.min(...values);
    const tied = left.filter((_, i) => values[i] === best);
    const pick = tied.length > 1 ? rng.pick(tied) : (tied[0] as PlaceId);
    out.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return out;
}

/** The player was caught inside the operation: an arrest, or goods handed over. */
export function caughtHere(s: GameState): OpenCase | null {
  const c = s.detective.case;
  if (!c || !operationOn(s, s.place)) return null;
  c.caught = true;
  return c;
}

/** The day between the announcement and the operation: the false trail's day. */
export const announced = (s: GameState): boolean =>
  s.detective.case !== null && s.day < operationStart(s.detective.case);

/** A single-site repeat of safe work or information gathering after a cold case. */
export function isSafeRepeat(c: OpenCase, previous?: PastCase): boolean {
  return previous?.outcome === "cold" && c.n === previous.n + 1 && c.place === previous.place
    && c.habit === previous.habit && ["oddJob", "lieLow", "ask"].includes(c.habit)
    && c.places.length === 1 && !c.trail;
}

function relocationPools(s: GameState, c: OpenCase, confirmedOnly: boolean) {
  const [start, end] = operationWindow(c);
  const free = PLACES.filter((p) => !sweepCovers(s, p, start, end, confirmedOnly));
  return { fresh: free.filter((p) => !c.places.includes(p)), kept: free.filter((p) => c.places.includes(p)) };
}

export function canRelocate(s: GameState, c: OpenCase): boolean {
  const { fresh, kept } = relocationPools(s, c, true);
  return fresh.length > 0 && fresh.length + kept.length >= c.places.length;
}

/** All tied sets that could be drawn from the lowest tallies in a pool. */
function lowestSets(s: GameState, from: PlaceId[], count: number): PlaceId[][] {
  if (count === 0) return [[]];
  if (count === from.length) return [from];
  const lowest = Math.min(...from.map((p) => tally(s, p)));
  return from.filter((p) => tally(s, p) === lowest).flatMap((p) =>
    lowestSets(s, from.filter((q) => q !== p), count - 1).map((rest) => [p, ...rest]));
}

/** Quote alternatives without looking at the hidden 16:00 item or drawing from the generator. */
export function trailDestinations(s: GameState, c: OpenCase): PlaceId[][] {
  const { fresh, kept } = relocationPools(s, c, true);
  const pools = [fresh];
  // Today's midday sweep, if there is one, can rule out one new site during the operation.
  if (s.hour < RULES.midday) {
    const start = at(s.day, RULES.midday);
    const end = at(s.day + 1, RULES.dayEnd);
    for (const p of fresh) {
      if (!sweepCovers(s, p, start, end, true)) pools.push(fresh.filter((q) => q !== p));
    }
  }
  const destinations = new Map<string, PlaceId[]>();
  for (const pool of pools) {
    if (pool.length === 0 || pool.length + kept.length < c.places.length) continue;
    const move = Math.min(pool.length, c.places.length);
    for (const next of lowestSets(s, pool, move)) {
      for (const stay of lowestSets(s, kept, c.places.length - move)) {
        const sites = [...next, ...stay];
        destinations.set(PLACES.filter((p) => sites.includes(p)).join(","), sites);
      }
    }
  }
  return [...destinations.values()];
}

/**
 * The false trail swallowed: the operation moves to the places with his lowest tallies,
 * never one a sweep covers during it, and keeps its size. New places come first; only
 * when too few are free does it keep one of its own (the lowest). Returns where it runs now.
 */
export function moveOperation(s: GameState, rng: Rng): PlaceId[] {
  const c = s.detective.case;
  if (!c) return [];
  const pools = relocationPools(s, c, false);
  const fresh = ranked(s, rng, pools.fresh, c.places.length, "bottom");
  const kept = ranked(s, rng, pools.kept, c.places.length - fresh.length, "bottom");
  const to = [...fresh, ...kept];
  if (fresh.length > 0 && to.length === c.places.length) c.places = to;
  return [...c.places];
}

/**
 * Pinch at a day end, before tomorrow's midday item is rolled (so it can't land on his
 * operation): the Crown's tally, the open case resolved, his promotion, a new theory, and
 * the tallies halved. Returns what the paper reports.
 */
export function pinchAtNight(s: GameState, rng: Rng, crown: boolean): PinchItem[] {
  const d = s.detective;
  const items: PinchItem[] = [];
  if (s.day === PINCH.introDay) items.push({ kind: "intro" });
  if (crown) d.seen.strip.drink = (d.seen.strip.drink ?? 0) + PINCH.crownTally;

  let closed = false;
  if (d.case) {
    const lastDay = operationStart(d.case) + PINCH.operationDays - 1;
    if (d.case.caught || s.day >= lastDay) {
      const outcome = d.case.caught ? "closed" : "cold";
      const past: PastCase = { n: d.case.n, place: d.case.place, habit: d.case.habit, outcome, day: s.day };
      if (d.case.observed) past.observed = true;
      if (d.case.trail) past.trail = { from: d.case.trail.from, to: d.case.places };
      if (d.case.evidence) past.evidence = d.case.evidence;
      const m = s.milestones;
      m.cases.push({ ...past });
      // The latest result survives in the collapsed recap even after its edition ages
      // out. Earlier cases use their retained editions for detailed closure facts.
      const previous = m.cases.at(-2);
      if (previous) {
        delete previous.trail;
        delete previous.evidence;
      }
      while (m.cases.length > PINCH.casesKept) {
        const old = m.cases.shift() as PastCase;
        m.older[old.outcome] += 1;
      }
      d.case = null;
      d.next = s.day + PINCH.rest;
      closed = outcome === "closed";
      items.push({ kind: outcome, case: past });
    }
  }
  if (s.today.arrested && !closed && s.day >= PINCH.introDay) items.push({ kind: "credit" });

  const crownDay = s.milestones.firsts.crown;
  if (!d.promoted && crownDay !== undefined && s.day >= crownDay + PINCH.promotion) {
    d.promoted = true;
    s.milestones.firsts.promotion ??= s.day;
    items.push({ kind: "promoted" });
  }

  if (!d.case && s.day >= d.next && PLACES.some((p) => tally(s, p) > 0)) {
    const places = ranked(s, rng, PLACES, d.promoted ? 2 : 1, "top");
    const place = places[0] as PlaceId;
    const habit = topHabit(s, place);
    const opened: OpenCase = {
      n: (s.milestones.cases.at(-1)?.n ?? 0) + 1,
      place,
      habit,
      announced: s.day,
      places,
      caught: false,
    };
    if ((d.seen[place][habit] ?? 0) > 0) opened.observed = true;
    d.case = opened;
    s.milestones.firsts.case ??= s.day;
    items.push({ kind: "announced", case: structuredClone(opened) });
  }

  for (const p of PLACES) {
    const seen = d.seen[p];
    for (const h of HABITS) {
      const n = (seen[h] ?? 0) / 2;
      if (n >= PINCH.tallyFloor) seen[h] = n;
      else delete seen[h];
    }
  }
  return items;
}
