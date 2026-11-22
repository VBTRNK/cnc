// Stable content IDs and the loop's provisional numbers (docs/design.md, "The loop").
// Saves reference content by these IDs, never by display text; renaming an ID needs a
// save migration. Display text lives with the UI under its own keys.

/**
 * The goods in simulation order: the order of the market's seeded draws and of every tie the
 * sim or the strategy runner breaks by good. It changes only with a balance rerun (ADR-014);
 * screens list goods by name instead. The first four are the goods of save format 3.
 */
export const GOODS = [
  "smokes",
  "tapes",
  "watches",
  "fireworks",
  "gum",
  "soda",
  "alibi",
  "trainers",
  "phones",
  "brie",
  "bingo",
  "ebikes",
] as const;
export type GoodId = (typeof GOODS)[number];

/** Ring order: neighbours are 1 h apart, opposites 2 h. */
export const PLACES = ["docks", "oldtown", "uptown", "strip"] as const;
export type PlaceId = (typeof PLACES)[number];

/** The coat and the phone, then the Crown & Anchor: the first chapter's goal. */
export const UPGRADES = ["coat", "phone", "crown"] as const;
export type UpgradeId = (typeof UPGRADES)[number];

export const SKILLS = ["patter", "nerve", "savvy"] as const;
export type SkillId = (typeof SKILLS)[number];

/** Harmless midday lines, by ID. */
export const HARMLESS = ["pigeons", "parade", "heatwave"] as const;
export type HarmlessId = (typeof HARMLESS)[number];

/** What Pinch sees the player doing at a place: selling a good, or one of the timed actions; "drink" is the Crown. */
export const HABITS = [...GOODS, "ask", "lieLow", "oddJob", "job", "drink"] as const;
export type HabitId = (typeof HABITS)[number];

/** Operation codenames, by case number (case 1 is the first), repeating after the last. */
export const CODENAMES = ["kipper", "winkle", "teapot", "bowler", "crumpet", "brolly", "haddock", "mothball"] as const;
export type CodenameId = (typeof CODENAMES)[number];

/** The run's firsts, kept beside the news log so trimming old papers loses none. */
export const MILESTONES = ["sale", "grand", "coat", "phone", "job", "arrest", "escape", "case", "crown", "promotion"] as const;
export type MilestoneId = (typeof MILESTONES)[number];

/** Flags that cards set and test. */
export const FLAGS = ["loan"] as const;
export type FlagId = (typeof FLAGS)[number];

/** The authored cast. */
export const CAST = ["pinch", "lenny", "mags", "reg"] as const;
export type CastId = (typeof CAST)[number];

export interface Good {
  base: number;
  /** Units sold per hour at Patter 0; a fraction for the slow, dear goods. */
  rate: number;
  /** Heat per unit sold, before the police and Savvy factors. */
  heat: number;
  /** Standard deviation of the daily drift noise. */
  vol: number;
  stockAtSource: number;
  stockElsewhere: number;
  /** Price factor per place that deals in the good; a place missing here never deals in it. */
  factor: Partial<Record<PlaceId, number>>;
}

const good = (
  base: number,
  rate: number,
  heat: number,
  vol: number,
  [stockAtSource, stockElsewhere]: [number, number],
  [docks, oldtown, uptown, strip]: (number | null)[],
): Good => {
  const factor: Partial<Record<PlaceId, number>> = {};
  ([["docks", docks], ["oldtown", oldtown], ["uptown", uptown], ["strip", strip]] as const).forEach(([p, f]) => {
    if (f !== null && f !== undefined) factor[p] = f;
  });
  return { base, rate, heat, vol, stockAtSource, stockElsewhere, factor };
};

/**
 * The catalogue (docs/design.md, "The loop"; ADR-014): price × rate in a band, heat per
 * selling hour by character, the city's daily units split across the goods and trimmed (the
 * owner's choice of the measured profiles). Stock is [at the source, elsewhere]; factors are
 * Docks, Old Town, Uptown, Strip, null where the place doesn't deal in the good.
 */
export const GOOD: Record<GoodId, Good> = {
  smokes: good(8, 10, 0.3, 0.1, [20, 6], [0.85, 1.0, 1.15, 1.09]),
  tapes: good(15, 8, 0.3, 0.14, [12, 3], [1.0, 0.85, 1.06, 1.18]),
  watches: good(50, 4, 0.6, 0.14, [4, 1], [0.85, 1.0, 1.18, 1.03]),
  fireworks: good(100, 2, 2.0, 0.2, [2, 1], [0.85, 1.12, 1.0, 1.18]),
  gum: good(12, 10, 0.15, 0.18, [14, 4], [null, 0.85, 1.12, 1.06]),
  soda: good(20, 6, 0.6, 0.12, [10, 3], [0.85, null, 1.06, 1.18]),
  alibi: good(35, 5, 0.2, 0.12, [7, 2], [1.0, 0.85, 1.18, null]),
  trainers: good(80, 3, 0.4, 0.22, [3, 1], [null, 1.0, 1.12, 0.88]),
  phones: good(150, 1.5, 3.3, 0.16, [2, 1], [1.12, 1.0, null, 0.85]),
  brie: good(220, 1, 2.5, 0.12, [1, 1], [1.06, 0.9, null, 1.1]),
  bingo: good(300, 0.75, 8, 0.2, [1, 0], [1.18, 1.06, 0.85, null]),
  ebikes: good(450, 0.5, 6, 0.14, [1, 0], [1.1, null, 0.9, 1.05]),
};

export interface Place {
  police: number;
}

export const PLACE: Record<PlaceId, Place> = {
  docks: { police: 0.7 },
  oldtown: { police: 1.0 },
  uptown: { police: 1.4 },
  strip: { police: 1.0 },
};

/** A place deals in a good or never does: an undealt pair has no stock, no buyers and no price. */
export const deals = (place: PlaceId, good: GoodId): boolean => GOOD[good].factor[place] !== undefined;

/** The good's price factor at a place that deals in it. */
export function factor(place: PlaceId, good: GoodId): number {
  const f = GOOD[good].factor[place];
  if (f === undefined) throw new Error(`${place} doesn't deal in ${good}`);
  return f;
}

/** The places that deal in a good, in ring order. */
export const dealers = (good: GoodId): PlaceId[] => PLACES.filter((p) => deals(p, good));

/** The dealing place with the lowest factor for a good is its source. */
export const isSource = (place: PlaceId, good: GoodId): boolean =>
  deals(place, good) && factor(place, good) <= Math.min(...dealers(good).map((p) => factor(p, good)));

export const UPGRADE_COST: Record<UpgradeId, number> = { coat: 800, phone: 1200, crown: 2500 };

export const RULES = {
  startCash: 250,
  startPlace: "docks" as PlaceId,
  pockets: 20,
  coatPockets: 35,
  dayStart: 10,
  midday: 16,
  dayEnd: 22,
  arrestStart: 14,

  driftReversion: 0.5,
  driftMin: 0.7,
  driftMax: 1.5,
  stockNoise: [0.7, 1.3] as const,
  demandNoise: [0.8, 1.2] as const,
  demandHours: 3,

  shortage: { price: 1.4, stock: 0.3, demand: 1.5 },
  glut: { price: 0.7 },
  sweepPolice: 2,
  morningEventChance: 0.5,
  /** Midday item kinds, a third each: market event, sweep, harmless. */
  middayMarketChance: 1 / 3,
  middaySweepChance: 1 / 3,

  lieLowHours: 2,
  lieLowHeat: 12,
  oddJobHours: 3,
  oddJobPay: 30,
  oddJobHeat: 3,
  jobHours: 4,
  jobBase: 60,
  jobPay: [175, 325] as const,
  jobSuccessHeat: 8,
  jobFailHeat: 15,
  askHours: 1,
  askSavvy: 1,
  tipsPerPlace: 2,
  rumourTruth: 70,

  heatMax: 100,
  idleCoolPerHour: 1.5,
  overnightCool: 8,
  arrestHeat: 25,
  heatWords: [
    [70, "wanted"],
    [45, "hot"],
    [25, "warm"],
    [0, "low"],
  ] as const,

  stopBase: 0.003,
  stopPerHeat: 0.0007,
  bribeBase: 40,
  bribeShare: 0.25,
  bribePerHeat: 2,
  bribeHeat: 10,
  bribeMaxHeat: 70,
  /** The copper takes the money at these odds (the usual odds formula); otherwise he takes the goods. */
  bribeOddsBase: 80,
  legItBase: 50,
  legItHeat: 10,
  oddsPerNerve: 5,
  oddsPerHeat: 0.3,
  oddsMin: 10,
  oddsMax: 90,

  fineShare: 0.15,
  fineMin: 50,

  levels: [10, 25, 45, 70, 100] as const,
  patterRate: 0.1,
  savvyHeat: 0.08,
  savvyRumour: 5,
  xpNervePerJob: 2,
  xpNervePerStop: 2,

  /** Ringing round with the phone: heat + this × the call's number today (5, 10, 15, ...). */
  phoneHeat: 5,

  newsCap: 30,
} as const;

/** The detective, his cases and the Crown (docs/design.md, "The detective, events and cast"). */
export const PINCH = {
  /** He is introduced in this day's paper. */
  introDay: 3,
  /** The first day end at which he may open a case. */
  firstCase: 5,
  /** The operation runs this many days after the paper that announced it... */
  warning: 2,
  /** ...for this many days. */
  operationDays: 2,
  police: 2,
  /** Days of rest after a case closes or goes cold. */
  rest: 3,
  /** He is promoted at the day end this many days after the Crown is bought (its third day end). */
  promotion: 2,
  /** The false trail's odds: this base, plus the cards' points per Savvy level. */
  trailBase: 55,
  /** The Crown & Anchor's nightly takings, and what it adds to his tally for the Strip. */
  crownTakings: 75,
  crownTally: 2,
  /** A tally share below this is dropped when the tallies halve. */
  tallyFloor: 0.1,
  /** A milestone: cash at or above this. */
  grand: 1000,
  /** Case summaries on the board; older ones live on as closed and cold totals. */
  casesKept: 100,
} as const;

/** Cards: a shown card rests this many days; a chance's odds move this many points per skill level. */
export const CARDS_RULES = { rest: 10, perLevel: 5 } as const;

/** Day 1's authored prices for the first four goods; the others open at their neutral price. */
const AUTHORED: Record<PlaceId, Partial<Record<GoodId, number>>> = {
  docks: { smokes: 7, tapes: 15, watches: 43, fireworks: 85 },
  oldtown: { smokes: 8, tapes: 13, watches: 50, fireworks: 112 },
  uptown: { smokes: 9, tapes: 16, watches: 59, fireworks: 100 },
  strip: { smokes: 9, tapes: 18, watches: 52, fireworks: 118 },
};

/** Day 1 fixture (docs/design.md): a price for every pair a place deals in. */
export const DAY1_PRICES: Record<PlaceId, Partial<Record<GoodId, number>>> = Object.fromEntries(
  PLACES.map((p) => [
    p,
    Object.fromEntries(
      GOODS.filter((g) => deals(p, g)).map((g) => [g, AUTHORED[p][g] ?? Math.round(GOOD[g].base * factor(p, g))]),
    ),
  ]),
) as Record<PlaceId, Partial<Record<GoodId, number>>>;

/**
 * The Docks' day-1 stock of the first four goods: smokes plentiful, a few tapes and watches,
 * fireworks sold out, by the same rule as before the stock was split. Read from the catalogue
 * when the fixture is built, so it follows any change to the stock. The rest open at base stock.
 */
export function day1DocksStock(good: GoodId): number | null {
  switch (good) {
    case "smokes":
      return GOOD.smokes.stockAtSource;
    case "tapes":
      return GOOD.tapes.stockElsewhere;
    case "watches":
      return Math.round(GOOD.watches.stockAtSource / 2);
    case "fireworks":
      return 0;
    default:
      return null;
  }
}
