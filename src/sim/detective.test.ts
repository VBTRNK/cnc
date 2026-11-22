import { PLACE } from "./content.ts";
import { tally, trailDestinations } from "./detective.ts";
import { operationOn, police } from "./market.ts";
import { loadSave, toSave } from "./save.ts";
import { falseTrailOffer, newGame, step } from "./sim.ts";
import type { GameState, PinchItem } from "./state.ts";
import { atLeast, below, play, rngWhere } from "./testing.ts";

const noStop = rngWhere(atLeast(0.5));

/** A day-time state on `day`, standing at `place`, with no events and the generator set. */
function on(day: number, place: GameState["place"] = "docks", edit?: (s: GameState) => void): GameState {
  const s = newGame(42, "pinch");
  s.day = day;
  s.place = place;
  s.seenToday = [place];
  s.events = [];
  s.rng = noStop;
  edit?.(s);
  return s;
}

const night = (s: GameState) => play(s, { type: "callItADay" }).state;
const items = (s: GameState): PinchItem["kind"][] => (s.paper?.pinch ?? []).map((i) => i.kind);

/** Day 5's night with a case on Uptown's watches, then the morning after: the false trail's day. */
function announcedCase(edit?: (s: GameState) => void): GameState {
  return night(
    on(5, "uptown", (s) => {
      s.detective.seen = { docks: { oddJob: 4 }, oldtown: {}, uptown: { watches: 6, ask: 1 }, strip: { tapes: 2 } };
      edit?.(s);
    }),
  );
}

describe("the tally", () => {
  it("adds every hour of a timed action where it happens, by what was done; travel adds nothing", () => {
    const s = on(2, "strip", (s) => {
      s.held.smokes = 10;
      s.paid.smokes = 60;
    });
    const { state } = play(
      s,
      { type: "sell", good: "smokes", units: 10 },
      { type: "askAround" },
      { type: "lieLow" },
      { type: "travel", to: "docks" },
      { type: "oddJob" },
    );
    expect(state.detective.seen.strip).toEqual({ smokes: 1, ask: 1, lieLow: 2 });
    expect(state.detective.seen.docks).toEqual({ oddJob: 3 });
    expect(tally(state, "strip")).toBe(4);
  });

  it("halves every night, dropping what is left of an old habit", () => {
    const s = night(on(2, "docks", (s) => (s.detective.seen.docks = { oddJob: 6, ask: 0.15 })));
    expect(s.detective.seen.docks).toEqual({ oddJob: 3 });
  });
});

describe("theory and the warned operation", () => {
  it("opens no case before the day-5 night, and none with nothing seen", () => {
    expect(night(on(4, "docks", (s) => (s.detective.seen.docks = { oddJob: 3 }))).detective.case).toBeNull();
    expect(night(on(5)).detective.case).toBeNull();
  });

  it("opens a case on the place with the highest tally, labelled by what he saw most there, in that night's paper", () => {
    const s = announcedCase();
    expect(s.detective.case).toEqual({ n: 1, place: "uptown", habit: "watches", announced: 5, places: ["uptown"], caught: false, observed: true });
    expect(items(s)).toEqual(["announced"]);
    expect(s.paper?.case?.places).toEqual(["uptown"]);
    expect(s.milestones.firsts.case).toBe(5);
  });

  it("runs the operation the day after next, for two days: police doubled there, nowhere else", () => {
    let s = play(announcedCase(), { type: "startDay" }, { type: "resolveCard", choice: "leave" }).state;
    expect(s.day).toBe(6);
    expect(operationOn(s, "uptown")).toBe(false);
    s = play(s, { type: "callItADay" }, { type: "startDay" }).state;
    expect([operationOn(s, "uptown"), operationOn(s, "docks")]).toEqual([true, false]);
    expect(police(s, "uptown")).toBeCloseTo(PLACE.uptown.police * 2);
    s = play(s, { type: "callItADay" }, { type: "startDay" }).state;
    expect(operationOn(s, "uptown")).toBe(true);
  });

  it("a stop inside the operation is Pinch: no bribe, and handing over closes the case", () => {
    let s = play(announcedCase(), { type: "startDay" }, { type: "resolveCard", choice: "leave" }, { type: "callItADay" }, { type: "startDay" }).state;
    s.held.watches = 4;
    s.paid.watches = 200;
    s.rng = rngWhere(below(0.001));
    s = play(s, { type: "sell", good: "watches", units: 4 }).state;
    expect(s.pending).toMatchObject({ kind: "stop", bribe: null, bribeRefusal: "pinch" });
    expect(step(s, { type: "resolveStop", choice: "bribe" })).toEqual({ ok: false, reason: "bribeRefused" });
    s = play(s, { type: "resolveStop", choice: "handOver" }, { type: "callItADay" }).state;
    expect(items(s)).toEqual(["closed"]);
    expect(s.detective.case).toBeNull();
    expect(s.milestones.cases).toEqual([{
      n: 1, place: "uptown", habit: "watches", outcome: "closed", day: 7, observed: true,
      evidence: { handover: { place: "uptown", action: "sell", goods: [["watches", 4]] } },
    }]);
    expect(s.detective.next).toBe(10);
  });

  it("goes cold after its second day without a catch, then he rests three days", () => {
    let s = play(announcedCase(), { type: "startDay" }, { type: "resolveCard", choice: "leave" }).state;
    for (const _ of [6, 7]) s = play(s, { type: "callItADay" }, { type: "startDay" }).state;
    s = night(s);
    expect(items(s)).toEqual(["cold"]);
    expect(s.milestones.cases.map((c) => c.outcome)).toEqual(["cold"]);
    s.detective.seen.docks = { oddJob: 8 };
    for (const _ of [9, 10]) {
      s = play(s, { type: "startDay" }, { type: "callItADay" }).state;
      expect(s.detective.case).toBeNull();
    }
    s = play(s, { type: "startDay" }, { type: "callItADay" }).state;
    expect(s.detective.case).toMatchObject({ n: 2, announced: 11 });
  });

  it("keeps the last 100 cases on the board and the older ones as totals", () => {
    let s = play(announcedCase(), { type: "startDay" }, { type: "resolveCard", choice: "leave" }).state;
    s.milestones.cases = Array.from({ length: 150 }, (_, i) => ({ n: i + 1, place: "docks" as const, habit: "oddJob" as const, outcome: "cold" as const, day: 4 }));
    s.detective.case!.n = 151;
    for (const _ of [6, 7]) s = play(s, { type: "callItADay" }, { type: "startDay" }).state;
    s = night(s);
    expect(s.milestones.cases.map((c) => c.n)).toEqual(Array.from({ length: 100 }, (_, i) => i + 52));
    expect(s.milestones.older).toEqual({ closed: 0, cold: 51 });
    expect(loadSave(toSave(s))).toMatchObject({ ok: true });
    expect(play(s, { type: "startDay" }).state.milestones.cases.length).toBe(100);
  });

  it("an arrest outside an operation earns only his credit in the paper", () => {
    const arrested = play({ ...on(4, "docks"), rng: rngWhere(atLeast(0.5), atLeast(0.95)) }, { type: "pullJob" }).state;
    expect(arrested.paper?.log.arrested).toBe(true);
    expect(items(arrested)).toEqual(["credit"]);
  });

  it("is introduced in day 3's paper", () => {
    expect(items(night(on(3)))).toEqual(["intro"]);
    expect(items(night(on(2)))).toEqual([]);
  });
});

describe("the false trail", () => {
  const trailDay = (edit?: (s: GameState) => void) => {
    const s = announcedCase(edit);
    // No sweep tomorrow, so the move goes by the tallies alone.
    s.events = s.events.filter((e) => e.kind !== "sweep");
    return play(s, { type: "startDay" }).state;
  };

  it("is the first card of the day between the announcement and the operation", () => {
    expect(trailDay().pending).toEqual({ kind: "card", card: "falseTrail", odds: 55 });
  });

  it("can be opened after earning enough on the warning day and is consumed after showing", () => {
    const open = { type: "openFalseTrail" } as const;
    const short = trailDay((s) => (s.cash = 120));
    expect(short.pending).toBeNull();
    expect(falseTrailOffer(short)).toMatchObject({ cost: 150, block: "noCash" });
    expect(step(short, open)).toEqual({ ok: false, reason: "noCash" });
    const earned = play(short, { type: "oddJob" }).state;
    const opened = play(earned, open).state;
    expect(opened).toMatchObject({ cash: 150, hour: earned.hour, rng: earned.rng, pending: { card: "falseTrail", odds: 55 } });
    const load = loadSave(toSave(opened));
    if (!load.ok) throw new Error(load.detail);
    const left = play(load.state, { type: "resolveCard", choice: "leave" }).state;
    expect(step(left, open)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("defers an empty-pocket safe repeat and keeps the opening trigger with cargo or changed stakes", () => {
    const edit = (s: GameState) => {
      s.detective.seen.uptown = { oddJob: 6 };
      s.milestones.cases.push({ n: 1, place: "uptown", habit: "oddJob", outcome: "cold", day: 2 });
    };
    const s = trailDay(edit);
    expect(s.pending).toBeNull();
    const moved = play(s, { type: "travel", to: "docks" }, { type: "buy", good: "smokes", units: 1 }).state;
    expect(falseTrailOffer(moved)).toMatchObject({ block: null });
    const expired = play(s, { type: "callItADay" }, { type: "startDay" }).state;
    expect(falseTrailOffer(expired)).toBeNull();
    expect(operationOn(expired, "uptown")).toBe(true);
    expect(trailDay((x) => { edit(x); x.held.smokes = 1; }).pending).toMatchObject({ card: "falseTrail" });
    expect(trailDay((x) => { edit(x); x.milestones.cases[0]!.outcome = "closed"; }).pending).toMatchObject({ card: "falseTrail" });
  });

  it("includes a due repayment before the prompt and can pay for a first false trail from it", () => {
    const s = announcedCase((x) => { x.cash = 50; x.flags.loan = 2; });
    const { state, events } = play(s, { type: "startDay" });
    expect(state.cash).toBe(200);
    expect(events.map((e) => e.type).slice(-4)).toEqual(["dayStarted", "cardResolved", "tip", "card"]);
    expect(state.pending).toMatchObject({ card: "falseTrail" });
  });

  it("swallowed: $150, and the operation moves to the place with his lowest tally", () => {
    const s = trailDay();
    s.rng = rngWhere(below(0.5));
    const { state, events } = play(s, { type: "resolveCard", choice: "feed" });
    expect(state.cash).toBe(100);
    expect(state.detective.case?.places).toEqual(["oldtown"]);
    expect(events).toContainEqual(expect.objectContaining({ type: "cardResolved", won: true, places: ["oldtown"] }));
  });

  it("not swallowed: the money is gone and nothing changes", () => {
    const s = trailDay();
    s.rng = rngWhere(atLeast(0.6));
    const { state } = play(s, { type: "resolveCard", choice: "feed" });
    expect(state.cash).toBe(100);
    expect(state.detective.case?.places).toEqual(["uptown"]);
  });

  it("keeps a promoted operation's two places, keeping one of its own when a sweep leaves too few", () => {
    const s = trailDay((x) => {
      x.detective.promoted = true;
      x.cash = 1000;
      x.detective.seen = { docks: { oddJob: 6 }, oldtown: {}, uptown: { ask: 1 }, strip: { tapes: 4 } };
    });
    expect([s.pending, s.detective.case?.places]).toEqual([{ kind: "card", card: "falseTrailInspector", odds: 55 }, ["docks", "strip"]]);
    const early = trailDestinations(s, s.detective.case!);
    s.events.push({ id: "d6-midday", slot: "midday", startDay: 6, startHour: 16, endDay: 7, activated: false, kind: "sweep", place: "oldtown" });
    expect(trailDestinations(s, s.detective.case!)).toEqual(early);
    expect(early).toEqual([["oldtown", "uptown"], ["uptown", "strip"], ["oldtown", "strip"]]);
    s.rng = rngWhere(below(0.5));
    expect(play(s, { type: "resolveCard", choice: "feed" }).state.detective.case?.places).toEqual(["uptown", "strip"]);
  });

  it("excludes confirmed sweeps, quotes true ties, and reports an impossible relocation", () => {
    const s = trailDay();
    const c = s.detective.case!;
    expect(trailDestinations(s, c)).toEqual([["oldtown"], ["strip"]]);
    s.events.push({ id: "yesterday", slot: "midday", startDay: 5, startHour: 16, endDay: 6, activated: true, kind: "sweep", place: "oldtown" });
    expect(trailDestinations(s, c)).toEqual([["oldtown"]]);
    s.events.pop();
    s.hour = 16;
    s.pending = null;
    delete s.cards.falseTrail;
    s.detective.seen.oldtown = { ask: 1 };
    expect(trailDestinations(s, c)).toEqual([["oldtown"], ["strip"]]);
    for (const place of ["oldtown", "docks", "strip"] as const) {
      s.events.push({ id: place, slot: "midday", startDay: 6, startHour: 16, endDay: 7, activated: true, kind: "sweep", place });
    }
    expect(trailDestinations(s, c)).toEqual([]);
    expect(step(s, { type: "openFalseTrail" })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never moves the operation onto a sweep", () => {
    const s = trailDay();
    s.events.push({ id: "d6-midday", slot: "midday", startDay: 6, startHour: 16, endDay: 7, activated: false, kind: "sweep", place: "oldtown" });
    s.rng = rngWhere(below(0.5));
    expect(play(s, { type: "resolveCard", choice: "feed" }).state.detective.case?.places).toEqual(["strip"]);
  });
});

describe("the Crown and the promotion", () => {
  it("takes $75 a night and tells Pinch where the player drinks", () => {
    const s = night(on(2, "docks", (s) => s.upgrades.push("crown")));
    expect(s.cash).toBe(325);
    expect(s.paper?.log.pub).toBe(75);
    expect(s.detective.seen.strip).toEqual({ drink: 1 });
  });

  it("promotes him at the third day end after the Crown; then an operation covers his two top places at $300 a story", () => {
    const bought = (s: GameState) => {
      s.upgrades.push("crown");
      s.milestones.firsts.crown = 5;
    };
    expect(night(on(6, "docks", bought)).detective.promoted).toBe(false);
    const s = night(
      on(7, "docks", (s) => {
        bought(s);
        s.cash = 1000;
        s.detective.seen = { docks: { oddJob: 4 }, oldtown: { ask: 1 }, uptown: {}, strip: {} };
      }),
    );
    expect(s.detective.promoted).toBe(true);
    expect(s.milestones.firsts.promotion).toBe(7);
    expect(items(s)).toEqual(["promoted", "announced"]);
    expect(s.detective.case?.places).toEqual(["docks", "strip"]);
    expect(play(s, { type: "startDay" }).state.pending).toMatchObject({ kind: "card", card: "falseTrailInspector" });
  });
});
