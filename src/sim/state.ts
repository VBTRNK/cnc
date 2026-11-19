import type { CardId } from "./cards.ts";
import type { FlagId, GoodId, HabitId, HarmlessId, MilestoneId, PlaceId, SkillId, UpgradeId } from "./content.ts";

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
  /** null when not offered: Pinch's operation, at wanted, or unaffordable. */
  bribe: number | null;
  /** Odds in percent that he takes the bribe, frozen with the stop. */
  bribeOdds: number;
  /** "pinch": the stop is Pinch himself, inside his operation, and he can't be bribed. */
  bribeRefusal: "pinch" | "wanted" | "short" | null;
}

/** An authored card waiting for the player's choice; a chance choice's odds are frozen with it. */
export interface PendingCard {
  kind: "card";
  card: CardId;
  /** Odds in percent for the card's chance choice, if it has one. */
  odds: number | null;
}

export type Pending = PendingStop | PendingCard;

/** Pinch's open case. The operation runs `PINCH.warning` days after the announcement, for two days. */
export interface OpenCase {
  /** Case number, from 1; it picks the codename. */
  n: number;
  /** The place his theory is about, and what he saw there most: the case's label. */
  place: PlaceId;
  habit: HabitId;
  /** The day whose evening paper announced it. */
  announced: number;
  /** Where the operation runs: one place, two once he is promoted. A false trail moves it. */
  places: PlaceId[];
  /** He caught the player inside the operation: an arrest, or goods handed over. */
  caught: boolean;
}

export interface PastCase {
  n: number;
  place: PlaceId;
  habit: HabitId;
  outcome: "closed" | "cold";
  /** The day it closed or went cold. */
  day: number;
}

export interface Detective {
  /** Hours seen per place, by what the player was doing; halved every night. */
  seen: PerPlace<Partial<Record<HabitId, number>>>;
  case: OpenCase | null;
  /** The first day at whose end he may open a case. */
  next: number;
  promoted: boolean;
}

export interface Milestones {
  /** The day of each first. */
  firsts: Partial<Record<MilestoneId, number>>;
  /** The best day's takings: sales and jobs. */
  best: { day: number; takings: number } | null;
  /** Every case, closed or cold, oldest first. */
  cases: PastCase[];
  /** Cases older than the last `PINCH.casesKept`, as totals by outcome. */
  older: { closed: number; cold: number };
}

/** What Pinch did tonight, for the paper. */
export type PinchItem =
  | { kind: "intro" }
  | { kind: "announced"; case: OpenCase }
  | { kind: "closed" | "cold"; case: PastCase }
  | { kind: "promoted" }
  /** An arrest outside his operation: he takes the credit anyway. */
  | { kind: "credit" };

export interface BestSale {
  good: GoodId;
  units: number;
  proceeds: number;
  place: PlaceId;
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
  /** Units taken today: handed over, refused bribes, arrests and cards. */
  seized: number;
  /** The Crown & Anchor's takings tonight. */
  pub: number;
  /** The day's best sale by proceeds. */
  best: BestSale | null;
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
  /** Pinch tonight, and his open case after the night. */
  pinch: PinchItem[];
  case: OpenCase | null;
  /** Milestones reached today. */
  firsts: MilestoneId[];
  crown: boolean;
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
  pending: Pending | null;
  today: DayLog;
  /** The last newspaper while the night is shown; null during the day. */
  paper: Paper | null;
  /** Capped log of past papers, newest last. */
  news: Paper[];
  detective: Detective;
  milestones: Milestones;
  /** The day each card last showed. */
  cards: Partial<Record<CardId, number>>;
  /** The day each flag was set. */
  flags: Partial<Record<FlagId, number>>;
}
