// Helpers for tests and strategy runs; never imported by the app.

import { GOODS } from "./content.ts";
import { Rng } from "./rng.ts";
import { step, type Action, type DomainEvent } from "./sim.ts";
import type { GameState, PerGood } from "./state.ts";

/** Zero of every good, for building a goods record in a test. */
export const noGoods = (): PerGood<number> => Object.fromEntries(GOODS.map((g) => [g, 0])) as PerGood<number>;

/** Applies actions in order and fails loudly on a refusal. */
export function play(state: GameState, ...actions: Action[]): { state: GameState; events: DomainEvent[] } {
  let s = state;
  const events: DomainEvent[] = [];
  for (const a of actions) {
    const r = step(s, a);
    if (!r.ok) throw new Error(`refused ${JSON.stringify(a)}: ${r.reason}`);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/**
 * A generator position whose next draws satisfy the predicates in order, so a test can
 * force a stop, a job outcome or a leg-it result without touching the sim's code paths.
 */
export function rngWhere(...draws: ((x: number) => boolean)[]): number {
  for (let seed = 1; seed < 5_000_000; seed++) {
    const rng = new Rng(seed);
    if (draws.every((ok) => ok(rng.next()))) return seed;
  }
  throw new Error("no generator position found");
}

export const below = (p: number) => (x: number) => x < p;
export const atLeast = (p: number) => (x: number) => x >= p;
export const any = () => true;
