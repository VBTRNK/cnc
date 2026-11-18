import type { GoodId, HarmlessId, PlaceId, SkillId, UpgradeId } from "./content.ts";

export type PerGood<T> = Record<GoodId, T>;
export type PerPlace<T> = Record<PlaceId, T>;

/** One place and good for the day. Stock and demand are what is left. */
export interface Cell {
  /** Today's baseline price, before any event multiplier. */
  baseline: number;
  /** Today's fresh totals (B and D in the design). */
  freshStock: number;
  freshDemand: number;
  stock: number;
  demand: number;
}

export type MarketKind = "shortage" | "glut";

/**
 * A scheduled or active world event. It is active from its start to 22:00 on `endDay`;
 * `activated` records that its start has been applied (market effects apply once).
 */
export type WorldEvent = {
  id: string;
  slot: "morning" | "midday";
  startDay: number;
  startHour: number;
  endDay: number;
  activated: boolean;
} & (
  | { kind: MarketKind; place: PlaceId; good: GoodId }
  | { kind: "sweep"; place: PlaceId }
  | { kind: "harmless"; line: HarmlessId }
);

export interface Seen {
  price: number;
  day: number;
  hour: number;
}

/** Tomorrow's rumour as heard: what it claims, and whether that was true (the UI never shows the flag). */
export interface Rumour {
  claim: { kind: MarketKind; place: PlaceId; good: GoodId } | null;
  truthful: boolean;
  via: "ask" | "phone";
}

export interface SaleQuote {
  type: "sell";
  good: GoodId;
  units: number;
  proceeds: number;
  hours: number;
  heat: number;
  stopChance: number;
  legIt: number;
}

export interface JobQuote {
  type: "job";
  hours: number;
  stopChance: number;
  success: number;
  pay: readonly [number, number];
  legIt: number;
}

export type Quote = SaleQuote | JobQuote;

/** A police stop waiting for the player's choice; saved with the frozen quote. */
export interface PendingStop {
  kind: "stop";
  quote: Quote;
  /** null when not offered: at wanted, or unaffordable. */
  bribe: number | null;
  /** Odds in percent that he takes the bribe, frozen with the stop. */
  bribeOdds: number;
  bribeRefusal: "wanted" | "short" | null;
}

export interface DayLog {
  startCash: number;
  sold: number;
  proceeds: number;
  bought: number;
  spent: number;
  stops: number;
  arrested: boolean;
  hurt: boolean;
  jobPaid: number;
  /** The arrest fine, 0 without an arrest. */
  fine: number;
  /** Units the police took today: handed over, refused bribes and arrests. */
  seized: number;
}

/** The evening paper: committed results and scheduled facts only, so it is always true. */
export interface Paper {
  day: number;
  /** The midday item applied only at day end, so the player never saw it during the day. */
  unseenMidday: WorldEvent | null;
  /** Events active tomorrow that the player may know of: new morning events first. Hidden midday items excluded. */
  tomorrow: WorldEvent[];
  log: DayLog;
  cash: number;
  heat: number;
}

export interface GameState {
  runId: string;
  rng: number;
  phase: "day" | "night";
  day: number;
  hour: number;
  /** First hour of the next day: 14 after an arrest. */
  nextStart: number;
  place: PlaceId;
  cash: number;
  held: PerGood<number>;
  /** What the held units cost in total, for a sale's profit. */
  paid: PerGood<number>;
  /** Heat 0-100, kept unrounded. */
  heat: number;
  xp: Record<SkillId, number>;
  upgrades: UpgradeId[];
  drift: PerPlace<PerGood<number>>;
  market: PerPlace<PerGood<Cell>>;
  events: WorldEvent[];
  jobDone: boolean;
  /** Phone calls made today; each costs more heat than the last. */
  calls: number;
  /** Places stood in today. */
  seenToday: PlaceId[];
  /** Tips given per place today. */
  tipsGiven: Partial<PerPlace<number>>;
  /** Price tips already given today, as "place:good". */
  priceTips: string[];
  rumour: Rumour | null;
  /** Last seen price per place and good, from standing there or a tip. */
  memory: PerPlace<Partial<PerGood<Seen>>>;
  pending: PendingStop | null;
  today: DayLog;
  /** The last newspaper while the night is shown; null during the day. */
  paper: Paper | null;
  /** Capped log of past papers, newest last. */
  news: Paper[];
}
