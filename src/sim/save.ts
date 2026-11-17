// The save snapshot and its loading contract (docs/design.md, "Saves"). A save is one
// versioned JSON document. Loading validates it at runtime, migrates older formats on a
// copy, and refuses newer ones so the caller never overwrites them. Keeping the original
// and falling back to the last valid snapshot belong to the store that calls this.

import { GOODS, HARMLESS, PLACES, RULES, SKILLS, UPGRADES } from "./content.ts";
import type { GameState } from "./state.ts";

export const SAVE_FORMAT = "crime-and-crown-save";
export const SAVE_VERSION = 1;

export interface SaveDocument {
  format: typeof SAVE_FORMAT;
  version: number;
  state: GameState;
}

/** Upgrades a document of version `n` to `n + 1`. Each works on its own copy. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Migrations by the version they upgrade from. Version 1 is the first format. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

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
const day = int(1, 1_000_000);
const hour = int(RULES.dayStart, RULES.dayEnd);
const goods = keyed(GOODS, int(0, 10_000));
const cell = shape({
  baseline: int(1, 1_000_000),
  freshStock: int(0, 10_000),
  freshDemand: int(1, 10_000),
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
});

const paper = shape({
  day,
  unseenMidday: nullable(worldEvent),
  tomorrow: list(worldEvent, 10),
  log: dayLog,
  cash: int(0, MAX_CASH),
  heat: num(0, RULES.heatMax),
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
  heat: num(0, RULES.heatMax),
  xp: keyed(SKILLS, int(0, 1_000_000)),
  upgrades: all(list(oneOf(UPGRADES), UPGRADES.length), (x, path) =>
    new Set(x as unknown[]).size === (x as unknown[]).length ? null : `${path}: duplicate`,
  ),
  drift: keyed(PLACES, keyed(GOODS, num(RULES.driftMin, RULES.driftMax))),
  market: keyed(PLACES, keyed(GOODS, cell)),
  events: list(worldEvent, 20),
  jobDone: bool,
  seenToday: list(oneOf(PLACES), PLACES.length),
  tipsGiven: keyed(PLACES, int(0, RULES.tipsPerPlace), true),
  priceTips: list(
    oneOf(PLACES.flatMap((p) => GOODS.map((g) => `${p}:${g}`))),
    PLACES.length * GOODS.length,
  ),
  rumour: nullable(rumour),
  memory: keyed(PLACES, keyed(GOODS, seen, true)),
  pending: nullable(
    shape({
      kind: oneOf(["stop"]),
      quote,
      bribe: nullable(int(1, MAX_CASH)),
      bribeRefusal: nullable(oneOf(["wanted", "short"])),
    }),
  ),
  today: dayLog,
  paper: nullable(paper),
  news: list(paper, RULES.newsCap),
});

/** Rules between fields that the sim relies on. */
function consistency(s: GameState): string | null {
  const carried = GOODS.reduce((n, g) => n + s.held[g], 0);
  const pocketSize = s.upgrades.includes("coat") ? RULES.coatPockets : RULES.pockets;
  if (carried > pocketSize) return "state.held: more than pockets";
  if (s.phase === "day" && s.hour >= RULES.dayEnd) return "state.hour: day over";
  if (s.phase === "night" && (s.paper === null || s.pending !== null)) return "state.phase: night without a paper";
  if (s.phase === "day" && s.paper !== null) return "state.paper: paper by day";
  if (new Set(s.events.map((e) => e.id)).size !== s.events.length) return "state.events: duplicate id";
  return null;
}

export function validateState(x: unknown): string | null {
  return gameState(x, "state") ?? consistency(x as GameState);
}
