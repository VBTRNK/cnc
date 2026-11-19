// Authored cards as typed data (docs/design.md, "Events"): a fixed set of conditions and
// effects, no scripting. Encounters take the midday slot's harmless third; the false trail
// is the first card of the day before an operation. Text lives with the UI under
// `card.<id>...` keys; saves reference cards and choices by these IDs.

import { PINCH, type CastId, type FlagId, type GoodId, type PlaceId, type SkillId, type UpgradeId } from "./content.ts";

export type HeatBand = "low" | "warm" | "hot" | "wanted";

/** Every condition given must hold. */
export interface Conditions {
  /** Day at least. */
  day?: number;
  at?: PlaceId;
  holding?: { good: GoodId | "any"; min: number };
  /** Cash at least. */
  cash?: number;
  heatAtLeast?: HeatBand;
  heatAtMost?: HeatBand;
  owns?: UpgradeId;
  lacks?: UpgradeId;
  /** The open case: announced and not yet on, or its operation on today. */
  detective?: "announced" | "operation";
  promoted?: boolean;
  /** A flag set (at least `days` ago) or not set. */
  flag?: { id: FlagId; set: boolean; days?: number };
}

export type Effect =
  | { kind: "cash"; amount: number }
  | { kind: "heat"; amount: number }
  /** Goods for a stated total, scaled down to the free pockets, so profit still works. */
  | { kind: "gain"; good: GoodId; units: number; cost: number }
  /** Sells held units at the current price × factor. */
  | { kind: "sell"; good: GoodId; units: number; factor: number }
  /** Loses this share (rounded down, at least 1) of the good held most. */
  | { kind: "lose"; share: number }
  | { kind: "xp"; skill: SkillId; amount: number }
  | { kind: "hours"; hours: number }
  | { kind: "flag"; id: FlagId; set: boolean }
  /** A price tip, as from asking around. */
  | { kind: "tip" }
  /** Moves the open operation to the places with his lowest tallies. */
  | { kind: "moveOperation" };

/** A draw between two effect lists: base odds plus points per skill level, clamped 10-90%. */
export interface Chance {
  base: number;
  skill?: SkillId;
  win: Effect[];
  lose: Effect[];
}

export interface Choice {
  id: string;
  effects: Effect[];
  chance?: Chance;
}

export interface Card {
  who: CastId | null;
  when: Conditions;
  /** Two or three choices; empty for a report, whose effects apply when it shows. */
  choices: Choice[];
  report?: Effect[];
  once?: boolean;
}

const pass: Choice = { id: "pass", effects: [] };

/** In the pool's order: narrower conditions first, so the general cards don't shadow them. */
export const CARD_IDS = [
  "oldMatePays",
  "genuineWatch",
  "tradingStandards",
  "churchRoof",
  "doubleOrNothing",
  "customs",
  "terry",
  "oldMate",
  "noQuestions",
  "mugger",
  "falseTrail",
  "falseTrailInspector",
] as const;
export type CardId = (typeof CARD_IDS)[number];

const story = (cost: number): Choice => ({
  id: "feed",
  effects: [{ kind: "cash", amount: -cost }],
  chance: { base: PINCH.trailBase, skill: "savvy", win: [{ kind: "moveOperation" }], lose: [] },
});

export const CARDS: Record<CardId, Card> = {
  oldMatePays: {
    who: null,
    when: { flag: { id: "loan", set: true, days: 4 } },
    choices: [],
    report: [{ kind: "cash", amount: 150 }, { kind: "tip" }, { kind: "flag", id: "loan", set: false }],
  },
  genuineWatch: {
    who: null,
    when: { at: "uptown", holding: { good: "watches", min: 1 } },
    choices: [{ id: "sell", effects: [{ kind: "sell", good: "watches", units: 1, factor: 1.5 }, { kind: "heat", amount: 5 }] }, pass],
  },
  churchRoof: {
    who: null,
    when: { at: "oldtown", cash: 500 },
    choices: [{ id: "give", effects: [{ kind: "cash", amount: -50 }, { kind: "heat", amount: -8 }] }, { id: "walkOn", effects: [] }],
  },
  doubleOrNothing: {
    who: null,
    when: { at: "strip", cash: 300 },
    choices: [
      { id: "bet", effects: [], chance: { base: 50, win: [{ kind: "cash", amount: 100 }], lose: [{ kind: "cash", amount: -100 }] } },
      pass,
    ],
  },
  customs: {
    who: null,
    when: { at: "docks", day: 6 },
    choices: [{ id: "buy", effects: [{ kind: "gain", good: "tapes", units: 10, cost: 90 }, { kind: "heat", amount: 5 }] }, pass],
  },
  terry: {
    who: null,
    when: { at: "docks" },
    choices: [{ id: "buy", effects: [{ kind: "gain", good: "smokes", units: 20, cost: 90 }] }, pass],
  },
  mugger: {
    who: null,
    when: { cash: 300 },
    choices: [
      { id: "handOver", effects: [{ kind: "cash", amount: -50 }] },
      {
        id: "stand",
        effects: [],
        chance: { base: 50, skill: "nerve", win: [{ kind: "xp", skill: "nerve", amount: 2 }], lose: [{ kind: "cash", amount: -120 }] },
      },
      { id: "run", effects: [{ kind: "hours", hours: 1 }] },
    ],
  },
  tradingStandards: {
    who: null,
    when: { heatAtLeast: "warm", holding: { good: "any", min: 1 } },
    choices: [
      { id: "duck", effects: [{ kind: "hours", hours: 1 }] },
      { id: "brazen", effects: [], chance: { base: 50, skill: "patter", win: [], lose: [{ kind: "lose", share: 0.5 }] } },
    ],
  },
  oldMate: {
    who: null,
    when: { cash: 400, flag: { id: "loan", set: false } },
    once: true,
    choices: [
      { id: "lend", effects: [{ kind: "cash", amount: -100 }, { kind: "flag", id: "loan", set: true }] },
      { id: "notNow", effects: [] },
    ],
  },
  noQuestions: {
    who: null,
    when: { day: 5 },
    choices: [{ id: "buy", effects: [{ kind: "gain", good: "fireworks", units: 3, cost: 360 }, { kind: "heat", amount: 5 }] }, pass],
  },
  falseTrail: {
    who: "lenny",
    when: { detective: "announced", promoted: false, cash: 150 },
    choices: [story(150), { id: "leave", effects: [] }],
  },
  falseTrailInspector: {
    who: "lenny",
    when: { detective: "announced", promoted: true, cash: 300 },
    choices: [story(300), { id: "leave", effects: [] }],
  },
};

/** The encounter pool in the order it is tried at 16:00: the first card whose conditions hold shows. */
export const POOL: readonly CardId[] = CARD_IDS.filter((id) => !id.startsWith("falseTrail"));

/** The false trail's cards, tried at the start of the day between the announcement and the operation. */
export const TRAIL: readonly CardId[] = ["falseTrail", "falseTrailInspector"];
