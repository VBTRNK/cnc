// The save snapshot and its loading contract (docs/design.md, "Saves"). A save is one
// versioned JSON document. Loading validates it at runtime, migrates older formats on a
// copy, and refuses newer ones so the caller never overwrites them. Keeping the original
// and falling back to the last valid snapshot belong to the store that calls this.

import { CARD_IDS, CARDS } from "./cards.ts";
import {
  FLAGS,
  GOODS,
  HABITS,
  HARMLESS,
  MILESTONES,
  PINCH,
  PLACES,
  RULES,
  SKILLS,
  UPGRADES,
  deals,
  type GoodId,
  type PlaceId,
} from "./content.ts";
import { baseStock, neutralDemand, neutralPrice, undealtCell, usualPrice } from "./market.ts";
import type { GameState } from "./state.ts";

export const SAVE_FORMAT = "crime-and-crown-save";
export const SAVE_VERSION = 5;

/** The goods of save formats 1-3, dealt everywhere; format 4 added the rest (ADR-014). */
const FIRST_GOODS: readonly GoodId[] = ["smokes", "tapes", "watches", "fireworks"];

export interface SaveDocument {
  format: typeof SAVE_FORMAT;
  version: number;
  state: GameState;
}

/** Upgrades a document of version `n` to `n + 1`. Each works on its own copy. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Migrations by the version they upgrade from. Version 1 is the first format. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 2: cost basis, phone calls, bribe odds, and the fine and seizures in the day log.
  1: (doc) => {
    const state = structuredClone(doc.state) as Record<string, any>;
    const held = state.held as Record<string, number>;
    // Goods held before costs were kept count at the city's usual price.
    state.paid = Object.fromEntries(FIRST_GOODS.map((g) => [g, Math.round((held?.[g] ?? 0) * usualPrice(g))]));
    state.calls = 0;
    if (isObject(state.pending)) {
      const xp = Number((state.xp as Record<string, number>)?.nerve ?? 0);
      const nerve = RULES.levels.filter((t) => xp >= t).length;
      const odds = RULES.bribeOddsBase + RULES.oddsPerNerve * nerve - RULES.oddsPerHeat * Number(state.heat);
      state.pending.bribeOdds = Math.min(RULES.oddsMax, Math.max(RULES.oddsMin, odds));
    }
    const log = (l: unknown) => {
      if (isObject(l)) Object.assign(l, { fine: 0, seized: 0 });
    };
    log(state.today);
    if (isObject(state.paper)) log(state.paper.log);
    if (Array.isArray(state.news)) for (const p of state.news) if (isObject(p)) log(p.log);
    return { ...doc, state };
  },
  // 3: the detective, milestones, cards and flags; the pub and the best sale in the day log.
  2: (doc) => {
    const state = structuredClone(doc.state) as Record<string, any>;
    const log = (l: unknown) => {
      if (isObject(l)) Object.assign(l, { pub: 0, best: null });
    };
    const paper = (p: unknown) => {
      if (!isObject(p)) return;
      log(p.log);
      Object.assign(p, { pinch: [], case: null, firsts: [], crown: false });
    };
    log(state.today);
    paper(state.paper);
    const news: Record<string, any>[] = Array.isArray(state.news) ? state.news.filter(isObject) : [];
    for (const p of news) paper(p);

    // Firsts come from the papers still kept; a version 2 save never recorded when an
    // upgrade was bought, so the board dates one to the day of the migration.
    const firsts: Record<string, number> = {};
    let best: { day: number; takings: number } | null = null;
    for (const p of news) {
      const l = p.log as Record<string, any>;
      if (l.sold > 0) firsts.sale ??= p.day;
      if (l.jobPaid > 0) firsts.job ??= p.day;
      if (l.arrested) firsts.arrest ??= p.day;
      if (p.cash >= PINCH.grand) firsts.grand ??= p.day;
      const takings = Number(l.proceeds) + Number(l.jobPaid);
      if (takings > 0 && (!best || takings > best.takings)) best = { day: p.day, takings };
    }
    // The day in progress (by day) is in the log, not yet in a paper.
    if (state.phase === "day" && isObject(state.today)) {
      if (Number(state.today.sold) > 0) firsts.sale ??= state.day;
      if (Number(state.today.jobPaid) > 0) firsts.job ??= state.day;
    }
    if (Number(state.cash) >= PINCH.grand) firsts.grand ??= state.day;
    if (Array.isArray(state.upgrades)) for (const u of state.upgrades) firsts[u] ??= state.day;

    state.detective = { seen: { docks: {}, oldtown: {}, uptown: {}, strip: {} }, case: null, next: PINCH.firstCase, promoted: false };
    state.milestones = { firsts, best, cases: [], older: { closed: 0, cold: 0 } };
    state.cards = {};
    state.flags = {};
    return { ...doc, state };
  },
  // 4: eight more goods (ADR-014). The market already rolled in the snapshot (today's by day,
  // tomorrow's at night) gains the new goods' cells at their neutral price, base stock and
  // demand, without a draw; the first four's cells, the generator, every event, the rumour
  // and any pending quote stay as saved. The new catalogue's numbers apply from the next roll.
  3: (doc) => {
    const state = structuredClone(doc.state) as Record<string, any>;
    const added = GOODS.filter((g) => !FIRST_GOODS.includes(g));
    for (const g of added) {
      state.held[g] = 0;
      state.paid[g] = 0;
      for (const p of PLACES) {
        state.drift[p][g] = 1;
        state.market[p][g] = deals(p, g)
          ? { baseline: neutralPrice(p, g), freshStock: baseStock(p, g), freshDemand: neutralDemand(p, g), stock: baseStock(p, g), demand: neutralDemand(p, g) }
          : undealtCell(g);
      }
    }
    return { ...doc, state };
  },
  // 5: case evidence is optional. The original facts and current choices are kept as saved.
  4: (doc) => doc,
};

export type LoadResult =
  | { ok: true; state: GameState; migratedFrom: number | null }
  | { ok: false; error: "corrupt" | "future" | "unsupported" | "invalid"; detail: string; version?: number };

export function toSave(state: GameState): string {
  const doc: SaveDocument = { format: SAVE_FORMAT, version: SAVE_VERSION, state };
  return JSON.stringify(doc);
}

export function loadSave(
  text: string,
  options: { migrations?: Readonly<Record<number, Migration>>; current?: number } = {},
): LoadResult {
  const migrations = options.migrations ?? MIGRATIONS;
  const current = options.current ?? SAVE_VERSION;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: "corrupt", detail: "not JSON" };
  }
  if (!isObject(doc) || doc.format !== SAVE_FORMAT) return { ok: false, error: "corrupt", detail: "not a save" };
  const version = doc.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "corrupt", detail: "no version" };
  }
  if (version > current) return { ok: false, error: "future", detail: `version ${version}`, version };

  let working: Record<string, unknown> = structuredClone(doc);
  for (let v = version; v < current; v++) {
    const migrate = migrations[v];
    if (!migrate) return { ok: false, error: "unsupported", detail: `no migration from ${v}`, version };
    try {
      working = { ...migrate(working), version: v + 1 };
    } catch (e) {
      return { ok: false, error: "invalid", detail: `migration from ${v}: ${String(e)}`, version };
    }
  }

  const problem = validateState(working.state);
  if (problem) return { ok: false, error: "invalid", detail: problem, version };
  return { ok: true, state: working.state as GameState, migratedFrom: version < current ? version : null };
}

// ---- Validation --------------------------------------------------------------------
// Hand-written so the bundle needs no schema library. Each check returns the path of the
// first problem, or null. Saves are editable by the player (accepted); this only makes
// sure the sim can run on what it loads.

type Check = (x: unknown, path: string) => string | null;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const int =
  (min: number, max = Number.MAX_SAFE_INTEGER): Check =>
  (x, path) =>
    Number.isInteger(x) && (x as number) >= min && (x as number) <= max ? null : `${path}: whole number ${min}-${max}`;
const num =
  (min: number, max: number): Check =>
  (x, path) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? null : `${path}: number ${min}-${max}`;
const bool: Check = (x, path) => (typeof x === "boolean" ? null : `${path}: boolean`);
const str: Check = (x, path) => (typeof x === "string" && x.length > 0 && x.length <= 200 ? null : `${path}: text`);
const oneOf =
  (values: readonly unknown[]): Check =>
  (x, path) =>
    values.includes(x) ? null : `${path}: unknown value`;
const nullable =
  (inner: Check): Check =>
  (x, path) =>
    x === null ? null : inner(x, path);
const list =
  (inner: Check, max = 1000): Check =>
  (x, path) => {
    if (!Array.isArray(x) || x.length > max) return `${path}: list`;
    for (let i = 0; i < x.length; i++) {
      const p = inner(x[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  };
/** An object with exactly these keys (optional ones may be missing). */
const shape =
  (fields: Record<string, Check>, optional: readonly string[] = []): Check =>
  (x, path) => {
    if (!isObject(x)) return `${path}: object`;
    for (const key of Object.keys(x)) if (!(key in fields)) return `${path}.${key}: unexpected`;
    for (const [key, check] of Object.entries(fields)) {
      if (!(key in x)) {
        if (optional.includes(key)) continue;
        return `${path}.${key}: missing`;
      }
      const p = check(x[key], `${path}.${key}`);
      if (p) return p;
    }
    return null;
  };
const keyed = (keys: readonly string[], inner: Check, partial = false): Check =>
  shape(Object.fromEntries(keys.map((k) => [k, inner])), partial ? keys : []);
const all =
  (...checks: Check[]): Check =>
  (x, path) => {
    for (const c of checks) {
      const p = c(x, path);
      if (p) return p;
    }
    return null;
  };

const MAX_CASH = 1e12;
/**
 * New rolls clamp drift to RULES.driftMin-driftMax, but saves from before ADR-012 hold drift
 * rolled within 0.6-1.8; the next roll brings it inside the new clamp.
 */
const savedDrift = num(Math.min(RULES.driftMin, 0.6), Math.max(RULES.driftMax, 1.8));
const day = int(1, 1_000_000);
const hour = int(RULES.dayStart, RULES.dayEnd);
const goods = keyed(GOODS, int(0, 10_000));
const cell = shape({
  baseline: int(1, 1_000_000),
  freshStock: int(0, 10_000),
  freshDemand: int(0, 10_000),
  stock: int(0, 100_000),
  demand: int(0, 100_000),
});
const pair = { place: oneOf(PLACES), good: oneOf(GOODS) };

const worldEvent: Check = (x, path) => {
  const common = {
    id: str,
    slot: oneOf(["morning", "midday"]),
    startDay: day,
    startHour: oneOf([RULES.dayStart, RULES.midday]),
    endDay: day,
    activated: bool,
  };
  if (!isObject(x)) return `${path}: object`;
  switch (x.kind) {
    case "shortage":
    case "glut":
      return shape({ ...common, kind: oneOf(["shortage", "glut"]), ...pair })(x, path);
    case "sweep":
      return shape({ ...common, kind: oneOf(["sweep"]), place: oneOf(PLACES) })(x, path);
    case "harmless":
      return shape({ ...common, kind: oneOf(["harmless"]), line: oneOf(HARMLESS) })(x, path);
    default:
      return `${path}.kind: unknown value`;
  }
};

const odds = num(0, 100);
const quote: Check = (x, path) => {
  if (!isObject(x)) return `${path}: object`;
  if (x.type === "sell") {
    return shape({
      type: oneOf(["sell"]),
      good: oneOf(GOODS),
      units: int(1, 10_000),
      proceeds: int(0, MAX_CASH),
      hours: int(1, 12),
      heat: num(0, 1000),
      stopChance: num(0, 1),
      legIt: odds,
    })(x, path);
  }
  return shape({
    type: oneOf(["job"]),
    hours: int(1, 12),
    stopChance: num(0, 1),
    success: odds,
    pay: all(list(int(0, MAX_CASH), 2), (p, at) => ((p as unknown[]).length === 2 ? null : `${at}: pair`)),
    legIt: odds,
  })(x, path);
};

const dayLog = shape({
  startCash: int(0, MAX_CASH),
  sold: int(0),
  proceeds: int(0, MAX_CASH),
  bought: int(0),
  spent: int(0, MAX_CASH),
  stops: int(0),
  arrested: bool,
  hurt: bool,
  jobPaid: int(0, MAX_CASH),
  fine: int(0, MAX_CASH),
  seized: int(0),
  pub: int(0, MAX_CASH),
  best: nullable(shape({ good: oneOf(GOODS), units: int(1, 10_000), proceeds: int(0, MAX_CASH), place: oneOf(PLACES) })),
});

const places = all(list(oneOf(PLACES), 2), (x, path) => {
  const a = x as unknown[];
  return a.length > 0 && new Set(a).size === a.length ? null : `${path}: places`;
});
const theory = {
  n: int(1),
  place: oneOf(PLACES),
  habit: oneOf(HABITS),
  observed: oneOf([true]),
};
const seizure = all(list((x, path) => {
  if (!Array.isArray(x) || x.length !== 2) return `${path}: pair`;
  return oneOf(GOODS)(x[0], `${path}[0]`) ?? int(1, RULES.coatPockets)(x[1], `${path}[1]`);
}, GOODS.length), (x, path) => {
  const goods = x as [GoodId, number][];
  return new Set(goods.map(([g]) => g)).size === goods.length &&
    goods.reduce((sum, [, n]) => sum + n, 0) <= RULES.coatPockets ? null : `${path}: goods in pockets`;
});
const handover = shape({
  place: oneOf(PLACES),
  action: oneOf(["sell", "job"]),
  goods: seizure,
  job: shape({ outcome: oneOf(["success", "nothing", "hurt", "arrested"]), pay: int(0, MAX_CASH) }),
}, ["job"]);
const arrest = shape({
  place: oneOf(PLACES),
  cause: oneOf(["escape", "job"]),
  goods: seizure,
  fine: int(0, MAX_CASH),
});
const evidence = shape({ handover, arrest }, ["handover", "arrest"]);
const openCase = shape({
  ...theory,
  announced: day,
  places,
  caught: bool,
  trail: shape({ from: places, cost: int(1, MAX_CASH) }),
  evidence,
}, ["observed", "trail", "evidence"]);
const pastCase = shape({
  ...theory,
  outcome: oneOf(["closed", "cold"]),
  day,
  trail: shape({ from: places, to: places }),
  evidence,
}, ["observed", "trail", "evidence"]);
const pinchItem: Check = (x, path) => {
  if (!isObject(x)) return `${path}: object`;
  switch (x.kind) {
    case "announced":
      return shape({ kind: oneOf(["announced"]), case: openCase })(x, path);
    case "closed":
    case "cold":
      return shape({ kind: oneOf(["closed", "cold"]), case: pastCase })(x, path);
    case "intro":
    case "promoted":
    case "credit":
      return shape({ kind: oneOf(["intro", "promoted", "credit"]) })(x, path);
    default:
      return `${path}.kind: unknown value`;
  }
};

const paper = shape({
  day,
  unseenMidday: nullable(worldEvent),
  tomorrow: list(worldEvent, 10),
  log: dayLog,
  cash: int(0, MAX_CASH),
  heat: num(0, RULES.heatMax),
  pinch: list(pinchItem, 10),
  case: nullable(openCase),
  firsts: list(oneOf(MILESTONES), MILESTONES.length),
  crown: bool,
});

const rumour = shape({
  claim: nullable(shape({ kind: oneOf(["shortage", "glut"]), ...pair })),
  truthful: bool,
  via: oneOf(["ask", "phone"]),
});

const seen = shape({ price: int(1, 1_000_000), day, hour });

const gameState = shape({
  runId: str,
  rng: int(-(2 ** 31), 2 ** 31 - 1),
  phase: oneOf(["day", "night"]),
  day,
  hour,
  nextStart: oneOf([RULES.dayStart, RULES.arrestStart]),
  place: oneOf(PLACES),
  cash: int(0, MAX_CASH),
  held: goods,
  paid: keyed(GOODS, int(0, MAX_CASH)),
  heat: num(0, RULES.heatMax),
  xp: keyed(SKILLS, int(0, 1_000_000)),
  upgrades: all(list(oneOf(UPGRADES), UPGRADES.length), (x, path) =>
    new Set(x as unknown[]).size === (x as unknown[]).length ? null : `${path}: duplicate`,
  ),
  drift: keyed(PLACES, keyed(GOODS, savedDrift)),
  market: keyed(PLACES, keyed(GOODS, cell)),
  events: list(worldEvent, 20),
  jobDone: bool,
  calls: int(0, 1000),
  seenToday: list(oneOf(PLACES), PLACES.length),
  tipsGiven: keyed(PLACES, int(0, RULES.tipsPerPlace), true),
  priceTips: list(
    oneOf(PLACES.flatMap((p) => GOODS.map((g) => `${p}:${g}`))),
    PLACES.length * GOODS.length,
  ),
  rumour: nullable(rumour),
  memory: keyed(PLACES, keyed(GOODS, seen, true)),
  pending: nullable((x, path) =>
    isObject(x) && x.kind === "card"
      ? shape({ kind: oneOf(["card"]), card: oneOf(CARD_IDS), odds: nullable(odds) })(x, path)
      : shape({
          kind: oneOf(["stop"]),
          quote,
          bribe: nullable(int(1, MAX_CASH)),
          bribeOdds: odds,
          bribeRefusal: nullable(oneOf(["pinch", "wanted", "short"])),
        })(x, path),
  ),
  today: dayLog,
  paper: nullable(paper),
  news: list(paper, RULES.newsCap),
  detective: shape({
    seen: keyed(PLACES, keyed(HABITS, num(0, 1_000_000), true)),
    case: nullable(openCase),
    next: day,
    promoted: bool,
  }),
  milestones: shape({
    firsts: keyed(MILESTONES, day, true),
    best: nullable(shape({ day, takings: int(1, MAX_CASH) })),
    cases: list(pastCase, PINCH.casesKept),
    older: shape({ closed: int(0), cold: int(0) }),
  }),
  cards: keyed(CARD_IDS, day, true),
  flags: keyed(FLAGS, day, true),
});

type Pair = { place: PlaceId; good: GoodId };

/**
 * The dealt-pair rule (ADR-014): an undealt pair never has stock, demand, a price seen or a
 * price tip, and no market event, rumour, pending sale or best sale names one. A dealt pair
 * always has demand; it may have no stock (a buyer-only pair).
 */
function dealtPairs(s: GameState): string | null {
  for (const p of PLACES) {
    for (const g of GOODS) {
      const c = s.market[p][g];
      const at = `state.market.${p}.${g}`;
      if (deals(p, g)) {
        if (c.freshDemand < 1) return `${at}.freshDemand: a dealt pair has demand`;
      } else {
        if (c.freshStock !== 0 || c.stock !== 0 || c.freshDemand !== 0 || c.demand !== 0) return `${at}: not dealt here`;
        if (s.memory[p][g] !== undefined) return `state.memory.${p}.${g}: not dealt here`;
        if (s.priceTips.includes(`${p}:${g}`)) return `state.priceTips: ${p}:${g} not dealt here`;
      }
    }
  }
  const undealt = (x: Pair | null | undefined) => !!x && !deals(x.place, x.good);
  const events = [
    ...s.events,
    ...[s.paper, ...s.news].flatMap((paper) => (paper ? [...paper.tomorrow, ...(paper.unseenMidday ? [paper.unseenMidday] : [])] : [])),
  ];
  for (const e of events) {
    if ((e.kind === "shortage" || e.kind === "glut") && undealt(e)) return `state.events: ${e.id} on a pair not dealt`;
  }
  if (undealt(s.rumour?.claim)) return "state.rumour.claim: not dealt there";
  const quote = s.pending?.kind === "stop" ? s.pending.quote : null;
  if (quote?.type === "sell" && !deals(s.place, quote.good)) return "state.pending.quote.good: not dealt here";
  for (const log of [s.today, ...[s.paper, ...s.news].flatMap((paper) => (paper ? [paper.log] : []))]) {
    if (undealt(log.best)) return "state.today.best: not dealt there";
  }
  return null;
}

/** Rules between fields that the sim relies on. */
function consistency(s: GameState): string | null {
  const carried = GOODS.reduce((n, g) => n + s.held[g], 0);
  const pocketSize = s.upgrades.includes("coat") ? RULES.coatPockets : RULES.pockets;
  if (carried > pocketSize) return "state.held: more than pockets";
  if (s.phase === "day" && s.hour >= RULES.dayEnd) return "state.hour: day over";
  if (s.phase === "night" && (s.paper === null || s.pending !== null)) return "state.phase: night without a paper";
  if (s.phase === "day" && s.paper !== null) return "state.paper: paper by day";
  if (new Set(s.events.map((e) => e.id)).size !== s.events.length) return "state.events: duplicate id";
  if (s.pending?.kind === "card") {
    const card = CARDS[s.pending.card];
    if (card.choices.length === 0) return "state.pending: a report never waits";
    if ((s.pending.odds === null) !== !card.choices.some((c) => c.chance)) return "state.pending.odds: frozen odds for its chance";
  }
  return dealtPairs(s);
}

export function validateState(x: unknown): string | null {
  return gameState(x, "state") ?? consistency(x as GameState);
}
