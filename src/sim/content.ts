// Stable content IDs and the loop's provisional numbers (docs/design.md, "The loop").
// Saves reference content by these IDs, never by display text; renaming an ID needs a
// save migration. Display text lives with the UI under its own keys.

export const GOODS = ["smokes", "tapes", "watches", "fireworks"] as const;
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
  /** Units sold per hour at Patter 0. */
  rate: number;
  /** Heat per unit sold, before the police and Savvy factors. */
  heat: number;
  /** Standard deviation of the daily drift noise. */
  vol: number;
  stockAtSource: number;
  stockElsewhere: number;
}

export const GOOD: Record<GoodId, Good> = {
  smokes: { base: 8, rate: 10, heat: 0.3, vol: 0.12, stockAtSource: 40, stockElsewhere: 12 },
  tapes: { base: 15, rate: 8, heat: 0.3, vol: 0.18, stockAtSource: 30, stockElsewhere: 8 },
  watches: { base: 50, rate: 4, heat: 0.6, vol: 0.18, stockAtSource: 12, stockElsewhere: 4 },
  fireworks: { base: 100, rate: 2, heat: 2.0, vol: 0.3, stockAtSource: 5, stockElsewhere: 1 },
};

export interface Place {
  /** Price factor per good; 0.75 marks a source. */
  factor: Record<GoodId, number>;
  police: number;
}

export const PLACE: Record<PlaceId, Place> = {
  docks: { factor: { smokes: 0.75, tapes: 1.0, watches: 0.75, fireworks: 0.75 }, police: 0.7 },
  oldtown: { factor: { smokes: 1.0, tapes: 0.75, watches: 1.0, fireworks: 1.2 }, police: 1.0 },
  uptown: { factor: { smokes: 1.25, tapes: 1.1, watches: 1.3, fireworks: 1.0 }, police: 1.4 },
  strip: { factor: { smokes: 1.15, tapes: 1.3, watches: 1.05, fireworks: 1.3 }, police: 1.0 },
};

export const isSource = (place: PlaceId, good: GoodId): boolean =>
  PLACE[place].factor[good] <= 0.75;

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
  driftMin: 0.6,
  driftMax: 1.8,
  stockNoise: [0.7, 1.3] as const,
  demandNoise: [0.8, 1.2] as const,
  demandHours: 4,

  shortage: { price: 1.7, stock: 0.3, demand: 1.5 },
  glut: { price: 0.55 },
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

  stopBase: 0.005,
  stopPerHeat: 0.001,
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
  /** Cases kept in full on his board; older ones live on as closed and cold totals, so a save stays bounded. */
  casesKept: 100,
} as const;

/** Cards: a shown card rests this many days; a chance's odds move this many points per skill level. */
export const CARDS_RULES = { rest: 10, perLevel: 5 } as const;

/** Day 1 fixture (docs/design.md): authored prices. Docks fireworks are sold out (stock 0). */
export const DAY1_PRICES: Record<PlaceId, Record<GoodId, number>> = {
  docks: { smokes: 6, tapes: 15, watches: 38, fireworks: 75 },
  oldtown: { smokes: 8, tapes: 11, watches: 50, fireworks: 120 },
  uptown: { smokes: 10, tapes: 16, watches: 65, fireworks: 100 },
  strip: { smokes: 10, tapes: 20, watches: 53, fireworks: 130 },
};

export const DAY1_DOCKS_STOCK: Record<GoodId, number> = {
  smokes: 40,
  tapes: 8,
  watches: 6,
  fireworks: 0,
};
