import { readFileSync } from "node:fs";
import { GOODS, PLACES, RULES, deals, type GoodId } from "./content.ts";
import { price, usualPrice } from "./market.ts";
import { SAVE_FORMAT, SAVE_VERSION, loadSave, toSave, type Migration, type SaveDocument } from "./save.ts";
import { newGame, quoteSale, step } from "./sim.ts";
import type { GameState } from "./state.ts";
import { below, noGoods, play, rngWhere } from "./testing.ts";

/** The goods of save formats 1-3. */
const FIRST: readonly GoodId[] = ["smokes", "tapes", "watches", "fireworks"];
const ADDED = GOODS.filter((g) => !FIRST.includes(g));

/**
 * A state as formats 1-3 held it: only the first four goods. Everything that names another
 * good goes (its keys, prices seen, tips, events, the rumour), as those saves could not hold it.
 */
function fourGoods(s: GameState | Record<string, any>): Record<string, any> {
  const state = structuredClone(s) as Record<string, any>;
  const drop = (rec: Record<string, unknown>) => ADDED.forEach((g) => delete rec[g]);
  drop(state.held);
  if (state.paid) drop(state.paid);
  for (const p of PLACES) [state.drift[p], state.market[p], state.memory[p]].forEach(drop);
  state.priceTips = state.priceTips.filter((k: string) => FIRST.includes(k.split(":")[1] as GoodId));
  const firstOnly = (e: { good?: string }) => e.good === undefined || FIRST.includes(e.good as GoodId);
  state.events = state.events.filter(firstOnly);
  if (state.rumour?.claim && !firstOnly(state.rumour.claim)) state.rumour.claim = null;
  for (const paper of [state.paper, ...state.news].filter(Boolean)) {
    paper.tomorrow = paper.tomorrow.filter(firstOnly);
    if (paper.unseenMidday && !firstOnly(paper.unseenMidday)) paper.unseenMidday = null;
  }
  return state;
}

/** Real version 3 saves, written by main's simulation (see each file's "about"). */
const legacy = JSON.parse(readFileSync("src/sim/fixtures/before-adr-012.json", "utf8")) as Record<
  "high" | "low" | "stopped",
  SaveDocument
>;
const v3night = (JSON.parse(readFileSync("src/sim/fixtures/version-3-night.json", "utf8")) as { night: SaveDocument }).night;

const midRun = (): GameState =>
  play(
    newGame(9, "save-run"),
    { type: "buy", good: "smokes", units: 20 },
    { type: "travel", to: "strip" },
    { type: "askAround" },
    { type: "callItADay" },
    { type: "startDay" },
  ).state;

const docWith = (edit: (state: Record<string, unknown>) => void, version = SAVE_VERSION): string => {
  const doc = JSON.parse(toSave(midRun())) as { state: Record<string, unknown>; version: number };
  edit(doc.state);
  doc.version = version;
  return JSON.stringify(doc);
};

describe("save round trip", () => {
  it("restores the exact state, generator position included", () => {
    const s = midRun();
    const loaded = loadSave(toSave(s));
    expect(loaded).toEqual({ ok: true, state: s, migratedFrom: null });
  });

  it("continues without rerolls: the next day after a reload is the same day", () => {
    const s = play(midRun(), { type: "callItADay" }).state;
    const loaded = loadSave(toSave(s));
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(step(loaded.state, { type: "startDay" })).toEqual(step(s, { type: "startDay" }));
  });

  it("is one versioned document", () => {
    const doc = JSON.parse(toSave(midRun()));
    expect(Object.keys(doc)).toEqual(["format", "version", "state"]);
    expect([doc.format, doc.version]).toEqual([SAVE_FORMAT, SAVE_VERSION]);
  });
});

describe("loading refuses", () => {
  it("text that isn't JSON, or isn't a save", () => {
    expect(loadSave("{not json")).toMatchObject({ ok: false, error: "corrupt" });
    expect(loadSave(JSON.stringify({ format: "other", version: 1 }))).toMatchObject({ ok: false, error: "corrupt" });
    expect(loadSave(JSON.stringify({ format: SAVE_FORMAT }))).toMatchObject({ ok: false, error: "corrupt" });
  });

  it("a newer format, reporting its version so the caller keeps it", () => {
    const text = docWith(() => {}, SAVE_VERSION + 1);
    expect(loadSave(text)).toMatchObject({ ok: false, error: "future", version: SAVE_VERSION + 1 });
  });

  it.each([
    ["an unknown good", (s: Record<string, unknown>) => ((s.held as Record<string, number>).gold = 1)],
    ["an unknown place", (s: Record<string, unknown>) => (s.place = "moon")],
    ["negative cash", (s: Record<string, unknown>) => (s.cash = -5)],
    ["fractional cash", (s: Record<string, unknown>) => (s.cash = 10.5)],
    ["heat out of range", (s: Record<string, unknown>) => (s.heat = 101)],
    ["a missing field", (s: Record<string, unknown>) => delete s.market],
    ["an unknown upgrade", (s: Record<string, unknown>) => (s.upgrades = ["jetpack"])],
    ["more goods than pockets", (s: Record<string, unknown>) => ((s.held as Record<string, number>).smokes = 99)],
    ["an unknown event kind", (s: Record<string, unknown>) => ((s.events as Record<string, unknown>[])[0]!.kind = "meteor")],
    ["a day phase at 22:00", (s: Record<string, unknown>) => (s.hour = 22)],
    ["drift beyond any saved range", (s: Record<string, unknown>) => ((s.drift as Record<string, Record<string, number>>).docks!.smokes = 1.9)],
  ])("invalid data: %s", (_, edit) => {
    expect(loadSave(docWith(edit))).toMatchObject({ ok: false, error: "invalid" });
  });

  // midRun stands on the Strip, which doesn't deal in Eau d'Alibi or the bingo balls.
  type S = Record<string, any>;
  const marketEvent = { id: "d9-morning", slot: "morning", startDay: 3, startHour: 10, endDay: 4, activated: false, kind: "glut", place: "strip", good: "alibi" };
  it.each([
    ["stock on an undealt pair", (s: S) => (s.market.strip.alibi.stock = 3)],
    ["fresh stock on an undealt pair", (s: S) => (s.market.strip.alibi.freshStock = 3)],
    ["demand on an undealt pair", (s: S) => (s.market.strip.bingo.demand = 2)],
    ["a price seen on an undealt pair", (s: S) => (s.memory.strip.alibi = { price: 40, day: 2, hour: 10 })],
    ["a price tip on an undealt pair", (s: S) => s.priceTips.push("strip:alibi")],
    ["a market event on an undealt pair", (s: S) => s.events.push(marketEvent)],
    ["a rumour about an undealt pair", (s: S) => (s.rumour = { claim: { kind: "shortage", place: "strip", good: "bingo" }, truthful: false, via: "ask" })],
    [
      "a pending sale where the good isn't dealt",
      (s: S) => {
        s.held.alibi = 2;
        s.pending = {
          kind: "stop",
          quote: { type: "sell", good: "alibi", units: 2, proceeds: 80, hours: 1, heat: 0.4, stopChance: 0.01, legIt: 50 },
          bribe: 60,
          bribeOdds: 80,
          bribeRefusal: null,
        };
      },
    ],
    ["a dealt pair without demand", (s: S) => (s.market.strip.smokes.freshDemand = 0)],
  ])("the dealt-pair rule: %s", (_, edit) => {
    expect(loadSave(docWith(edit))).toMatchObject({ ok: false, error: "invalid" });
  });

  it("but accepts a buyer-only pair and demand used up for the day", () => {
    const text = docWith((s: S) => {
      Object.assign(s.market.strip.ebikes, { freshStock: 0, stock: 0, demand: 2 });
      s.market.strip.smokes.demand = 0;
    });
    expect(loadSave(text)).toMatchObject({ ok: true });
  });
});

describe("migrations", () => {
  // A pretend history: version 1 called cash "money"; version 2 is the current shape.
  const renameMoney: Migration = (doc) => {
    const state = { ...(doc.state as Record<string, unknown>) };
    state.cash = state.money;
    delete state.money;
    return { ...doc, state };
  };
  const oldText = docWith((s) => {
    s.money = s.cash;
    delete s.cash;
  }, 1);

  it("upgrade an older format in order, without touching the input", () => {
    const parsedBefore = JSON.parse(oldText);
    const loaded = loadSave(oldText, { migrations: { 1: renameMoney }, current: 2 });
    expect(loaded).toMatchObject({ ok: true, migratedFrom: 1 });
    if (loaded.ok) expect(loaded.state.cash).toBe(midRun().cash);
    expect(JSON.parse(oldText)).toEqual(parsedBefore);
  });

  it("refuse a format with no migration path", () => {
    expect(loadSave(oldText, { migrations: {}, current: 2 })).toMatchObject({ ok: false, error: "unsupported", version: 1 });
  });

  it("report a migration whose result is invalid", () => {
    const broken: Migration = (doc) => doc;
    expect(loadSave(oldText, { migrations: { 1: broken }, current: 2 })).toMatchObject({ ok: false, error: "invalid" });
  });
});

describe("version 1 saves", () => {
  /** A state written back as version 1: four goods, without the fields versions 2-4 added. */
  const asVersion1 = (s: GameState | Record<string, any>): string => {
    const state = fourGoods(s);
    delete state.paid;
    delete state.calls;
    if (state.pending) delete state.pending.bribeOdds;
    const strip = (log: Record<string, unknown>) => {
      delete log.fine;
      delete log.seized;
    };
    strip(state.today);
    if (state.paper) strip(state.paper.log);
    for (const p of state.news) strip(p.log);
    return JSON.stringify({ format: SAVE_FORMAT, version: 1, state });
  };

  it("load with costs at the usual price, no calls, empty logs and the stop's frozen odds", () => {
    const loaded = loadSave(asVersion1(v3night.state));
    expect(loaded).toMatchObject({ ok: true, migratedFrom: 1 });
    if (!loaded.ok) return;
    // 20 smokes at the usual $8.20 (base $8 × the mean place factor); the added goods none.
    expect(loaded.state.paid).toEqual({ ...noGoods(), smokes: 164 });
    expect(loaded.state.calls).toBe(0);
    expect(loaded.state.paper?.log).toMatchObject({ fine: 0, seized: 0 });
    expect(loaded.state.news.every((p) => p.log.fine === 0 && p.log.seized === 0)).toBe(true);
  });

  it("keep a pending stop playable", () => {
    const s = structuredClone(legacy.high.state);
    s.heat = 20;
    s.xp.nerve = 10;
    s.pending = {
      kind: "stop",
      quote: { type: "job", hours: 4, stopChance: 0.1, success: 60, pay: [175, 325], legIt: 50 },
      bribe: 60,
      bribeOdds: 0,
      bribeRefusal: null,
    };
    const loaded = loadSave(asVersion1(s));
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(loaded.state.pending?.kind === "stop" && loaded.state.pending.bribeOdds).toBeCloseTo(80 + 5 - 6);
  });
});

describe("version 2 saves", () => {
  /** A state written back as version 2: four goods, without the fields versions 3-4 added. */
  const asVersion2 = (s: GameState | Record<string, any>): string => {
    const state = fourGoods(s);
    for (const key of ["detective", "milestones", "cards", "flags"]) delete state[key];
    const strip = (log: Record<string, unknown>) => {
      delete log.pub;
      delete log.best;
    };
    const paper = (p: Record<string, unknown>) => {
      strip(p.log as Record<string, unknown>);
      for (const key of ["pinch", "case", "firsts", "crown"]) delete p[key];
    };
    strip(state.today);
    if (state.paper) paper(state.paper);
    for (const p of state.news) paper(p);
    return JSON.stringify({ format: SAVE_FORMAT, version: 2, state });
  };

  it("load with a fresh detective and firsts recovered from the papers still kept", () => {
    let s = play(newGame(9, "v2"), { type: "buy", good: "smokes", units: 20 }, { type: "travel", to: "strip" }).state;
    s = play(s, { type: "sell", good: "smokes", units: 20 }, { type: "callItADay" }, { type: "startDay" }).state;
    s.upgrades = ["coat"];
    s.day = 4;
    const loaded = loadSave(asVersion2(s));
    expect(loaded).toMatchObject({ ok: true, migratedFrom: 2 });
    if (!loaded.ok) return;
    expect(loaded.state.detective).toEqual({ seen: { docks: {}, oldtown: {}, uptown: {}, strip: {} }, case: null, next: 5, promoted: false });
    expect(loaded.state.milestones.firsts).toEqual({ sale: 1, coat: 4 });
    expect(loaded.state.milestones.best).toEqual({ day: 1, takings: s.news[0]!.log.proceeds });
    expect(loaded.state.news[0]).toMatchObject({ pinch: [], case: null, firsts: [], crown: false, log: { pub: 0, best: null } });
    expect([loaded.state.cards, loaded.state.flags]).toEqual([{}, {}]);
  });

  it("recover the firsts of a day in progress from its log", () => {
    const s = play(newGame(9, "v2"), { type: "buy", good: "smokes", units: 20 }, { type: "travel", to: "strip" }, { type: "sell", good: "smokes", units: 10 }).state;
    s.today.jobPaid = 200;
    const loaded = loadSave(asVersion2(s));
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(loaded.state.milestones.firsts).toEqual({ sale: 1, job: 1 });
  });

  it("load from version 1 through every migration", () => {
    const doc = JSON.parse(asVersion2(v3night.state));
    doc.version = 1;
    delete doc.state.paid;
    delete doc.state.calls;
    const loaded = loadSave(JSON.stringify(doc));
    expect(loaded).toMatchObject({ ok: true, migratedFrom: 1 });
    if (loaded.ok) expect(Object.keys(loaded.state.held).sort()).toEqual([...GOODS].sort());
  });
});

describe("saves from before ADR-012", () => {
  // Written by the simulation before the drift clamp tightened from 0.6-1.8 to 0.7-1.5.
  const load = (key: keyof typeof legacy): GameState => {
    const loaded = loadSave(JSON.stringify(legacy[key]));
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(loaded.migratedFrom).toBe(3);
    return loaded.state;
  };

  // Baselines rolled then: $100 × the old place factor (Old Town 1.2, Uptown 1.0) × drift.
  it.each([
    ["high", "oldtown", 1.8, 216],
    ["low", "uptown", 0.6, 60],
  ] as const)("load at the old range's %s end with the run and today's market as saved", (key, place, drift, baseline) => {
    const s = load(key);
    expect(fourGoods(s)).toEqual(legacy[key].state);
    expect(s.drift[place].fireworks).toBe(drift);
    expect(s.market[place].fireworks.baseline).toBe(baseline);
  });

  it.each(["high", "low"] as const)("roll the next day inside the new clamp (%s)", (key) => {
    const next = play(load(key), { type: "callItADay" }, { type: "startDay" }).state;
    const drifts = Object.values(next.drift).flatMap((d) => Object.values(d));
    expect(Math.min(...drifts)).toBeGreaterThanOrEqual(RULES.driftMin);
    expect(Math.max(...drifts)).toBeLessThanOrEqual(RULES.driftMax);
  });

  it("reprice a running shortage at the new multiplier, keeping the price seen and the frozen quote", () => {
    const s = load("stopped");
    const cell = s.market.oldtown.fireworks;
    expect(s.memory.oldtown.fireworks).toEqual({ price: 213, day: 2, hour: 12 });
    expect(price(s, "oldtown", "fireworks")).toBe(Math.round(cell.baseline * RULES.shortage.price));
    expect(price(s, "oldtown", "fireworks")).toBe(175);
    expect(s.pending).toMatchObject({ kind: "stop", quote: { type: "sell", units: 3, proceeds: 639 } });
    const { state, events } = play({ ...s, rng: rngWhere(below(0.01)) }, { type: "resolveStop", choice: "legIt" });
    expect(events.find((e) => e.type === "sold")).toMatchObject({ units: 3, proceeds: 639 });
    expect(state.cash).toBe(s.cash + 639);
  });
});

describe("version 3 saves (ADR-014)", () => {
  const migrate = (doc: SaveDocument): GameState => {
    const loaded = loadSave(JSON.stringify(doc));
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(loaded.migratedFrom).toBe(3);
    return loaded.state;
  };

  it.each([
    ["by day", legacy.high],
    ["at night", v3night],
  ] as const)("%s: keep the first four goods and the run as saved, and add the others without a draw", (_, doc) => {
    const s = migrate(doc);
    expect(fourGoods(s)).toEqual(doc.state);
    for (const g of ADDED) {
      expect([s.held[g], s.paid[g]]).toEqual([0, 0]);
      for (const p of PLACES) {
        expect(s.drift[p][g]).toBe(1);
        expect(s.memory[p][g]).toBeUndefined();
        const cell = s.market[p][g];
        if (deals(p, g)) {
          expect(cell.baseline).toBe(price(s, p, g));
          expect(cell.stock).toBe(cell.freshStock);
          expect(cell.demand).toBeGreaterThanOrEqual(1);
        } else expect(cell).toMatchObject({ freshStock: 0, stock: 0, freshDemand: 0, demand: 0 });
      }
    }
    expect(loadSave(toSave(s))).toEqual({ ok: true, state: s, migratedFrom: null });
  });

  it("at night, Start day opens on the market saved for tomorrow", () => {
    const s = migrate(v3night);
    const { state } = play(s, { type: "startDay" });
    // The rolled values as saved (a morning event starting now may still change what is left).
    const rolled = ({ baseline, freshStock, freshDemand }: GameState["market"]["docks"]["smokes"]) => ({ baseline, freshStock, freshDemand });
    for (const p of PLACES) for (const g of FIRST) expect(rolled(state.market[p][g])).toEqual(rolled(v3night.state.market[p][g]));
    // The next roll uses the new catalogue and keeps the dealt-pair rule.
    const next = play(state, { type: "callItADay" }, { type: "startDay" }).state;
    expect(loadSave(toSave(next))).toMatchObject({ ok: true });
  });

  it("by day, play on through the next roll", () => {
    const s = migrate(legacy.high);
    const next = play(s, { type: "travel", to: "strip" }, { type: "callItADay" }, { type: "startDay" }).state;
    expect(loadSave(toSave(next))).toMatchObject({ ok: true, migratedFrom: null });
  });
});

describe("goods carried where nobody deals in them", () => {
  // Bubblegum isn't dealt at the Docks.
  const carrying = (rng: number) => {
    // Smokes at the Docks, gum in Old Town, then back to the Docks with both.
    const { state } = play(
      newGame(5, "undealt"),
      { type: "buy", good: "smokes", units: 5 },
      { type: "travel", to: "oldtown" },
      { type: "buy", good: "gum", units: 5 },
      { type: "travel", to: "docks" },
    );
    return { ...state, rng };
  };

  it("can't be sold or seen there, and keep their cost", () => {
    const s = carrying(1);
    expect([s.place, s.held.gum, s.paid.gum]).toEqual(["docks", 5, 50]);
    expect(quoteSale(s, "gum", 1)).toBe("noBuyers");
    expect(s.memory.docks.gum).toBeUndefined();
    expect(s.memory.oldtown.gum?.price).toBe(10);
    const back = loadSave(toSave(s));
    expect(back).toMatchObject({ ok: true });
  });

  it("count at the usual price in a stop's bribe, and the pending stop survives a save", () => {
    const quote = quoteSale(carrying(1), "smokes", 5);
    if (typeof quote === "string") throw new Error(quote);
    const stopped = play(carrying(rngWhere(below(quote.stopChance))), { type: "sell", good: "smokes", units: 5 }).state;
    expect(stopped.pending?.kind).toBe("stop");
    const value = 5 * price(stopped, "docks", "smokes") + 5 * usualPrice("gum");
    expect(stopped.pending?.kind === "stop" && stopped.pending.bribe).toBe(Math.ceil(RULES.bribeBase + RULES.bribeShare * value));
    const loaded = loadSave(toSave(stopped));
    expect(loaded).toEqual({ ok: true, state: stopped, migratedFrom: null });
    if (!loaded.ok) return;
    const after = play({ ...loaded.state, rng: rngWhere(below(0.01)) }, { type: "resolveStop", choice: "legIt" });
    expect(after.events.find((e) => e.type === "sold")).toMatchObject({ good: "smokes", units: 5 });
    expect(after.state.held.gum).toBe(5);
  });
});
