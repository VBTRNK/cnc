import { SAVE_FORMAT, SAVE_VERSION, loadSave, toSave, type Migration } from "./save.ts";
import { newGame, step } from "./sim.ts";
import type { GameState } from "./state.ts";
import { play } from "./testing.ts";

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
    // 20 smokes at the usual $8.30 (base $8 × the mean place factor).
    expect(loaded.state.paid).toEqual({ smokes: 166, tapes: 0, watches: 0, fireworks: 0 });
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
    expect(loaded.state.pending?.bribeOdds).toBeCloseTo(80 + 5 - 6);
  });
});
