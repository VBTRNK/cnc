import { readFileSync } from "node:fs";
import { RULES } from "./content.ts";
import { price } from "./market.ts";
import { SAVE_FORMAT, SAVE_VERSION, loadSave, toSave, type Migration, type SaveDocument } from "./save.ts";
import { newGame, step } from "./sim.ts";
import type { GameState } from "./state.ts";
import { below, play, rngWhere } from "./testing.ts";

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
  /** A current state written back as version 1: without the fields version 2 added. */
  const asVersion1 = (s: GameState): string => {
    const state = structuredClone(s) as unknown as Record<string, any>;
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
    const night = play(midRun(), { type: "callItADay" }).state;
    const loaded = loadSave(asVersion1(night));
    expect(loaded).toMatchObject({ ok: true, migratedFrom: 1 });
    if (!loaded.ok) return;
    // 20 smokes at the usual $8.20 (base $8 × the mean place factor).
    expect(loaded.state.paid).toEqual({ smokes: 164, tapes: 0, watches: 0, fireworks: 0 });
    expect(loaded.state.calls).toBe(0);
    expect(loaded.state.paper?.log).toMatchObject({ fine: 0, seized: 0 });
    expect(loaded.state.news.every((p) => p.log.fine === 0 && p.log.seized === 0)).toBe(true);
  });

  it("keep a pending stop playable", () => {
    const s = midRun();
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
  /** A current state written back as version 2: without the fields version 3 added. */
  const asVersion2 = (s: GameState): string => {
    const state = structuredClone(s) as unknown as Record<string, any>;
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

  it("load from version 1 through both migrations", () => {
    const doc = JSON.parse(asVersion2(midRun()));
    doc.version = 1;
    delete doc.state.paid;
    delete doc.state.calls;
    expect(loadSave(JSON.stringify(doc))).toMatchObject({ ok: true, migratedFrom: 1 });
  });
});

describe("saves from before ADR-012", () => {
  // Written by the simulation before the drift clamp tightened from 0.6-1.8 to 0.7-1.5.
  const legacy = JSON.parse(readFileSync("src/sim/fixtures/before-adr-012.json", "utf8")) as Record<
    "high" | "low" | "stopped",
    SaveDocument
  >;
  const load = (key: keyof typeof legacy): GameState => {
    const loaded = loadSave(JSON.stringify(legacy[key]));
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(loaded.migratedFrom).toBeNull();
    return loaded.state;
  };

  // Baselines rolled then: $100 × the old place factor (Old Town 1.2, Uptown 1.0) × drift.
  it.each([
    ["high", "oldtown", 1.8, 216],
    ["low", "uptown", 0.6, 60],
  ] as const)("load at the old range's %s end with the run and today's market as saved", (key, place, drift, baseline) => {
    const s = load(key);
    expect(s).toEqual(legacy[key].state);
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
