import { CARDS, CARD_IDS, POOL } from "./cards.ts";
import { loadSave, toSave } from "./save.ts";
import { newGame, step } from "./sim.ts";
import type { GameState } from "./state.ts";
import { atLeast, below, play, rngWhere } from "./testing.ts";

const noStop = rngWhere(atLeast(0.5));

/**
 * A day-time state at `place` and 14:00 whose midday item is a harmless line, so the next
 * action across 16:00 (an odd job) meets whichever card fits.
 */
function beforeMidday(place: GameState["place"], edit?: (s: GameState) => void): GameState {
  const s = newGame(42, "cards");
  s.day = 6;
  s.place = place;
  s.hour = 14;
  s.seenToday = [place];
  s.rng = noStop;
  s.events = [{ id: "d6-midday", slot: "midday", startDay: 6, startHour: 16, endDay: 7, activated: false, kind: "harmless", line: "pigeons" }];
  // Every card rests unless the test wakes it, so exactly one candidate fits.
  s.cards = Object.fromEntries(POOL.map((id) => [id, 6]));
  edit?.(s);
  return s;
}
const wake = (s: GameState, ...ids: (typeof CARD_IDS)[number][]) => {
  for (const id of ids) delete s.cards[id];
};
const meet = (s: GameState) => play(s, { type: "oddJob" });

describe("encounters", () => {
  it("take the harmless line's place at 16:00: the first card that fits, blocking", () => {
    // Both fit (cash $300+ for the mugger); Terry is earlier in the pool.
    const both = (s: GameState) => {
      wake(s, "terry", "mugger");
      s.cash = 400;
    };
    expect(meet(beforeMidday("strip", both)).state.pending).toMatchObject({ card: "mugger" });
    const { state, events } = meet(beforeMidday("docks", both));
    expect(state.pending).toEqual({ kind: "card", card: "terry", odds: null });
    expect(events.at(-1)).toMatchObject({ type: "card" });
    expect(state.events.some((e) => e.kind === "harmless")).toBe(false);
    expect(state.cards.terry).toBe(6);
    expect(step(state, { type: "lieLow" })).toEqual({ ok: false, reason: "pending" });
  });

  it("leave the harmless line when no card fits", () => {
    const { state } = meet(beforeMidday("docks"));
    expect(state.pending).toBeNull();
    expect(state.events.map((e) => e.kind)).toEqual(["harmless"]);
  });

  it("never show at the day end: an unseen midday item stays a line in the paper", () => {
    const { state } = play(beforeMidday("docks", (s) => wake(s, "terry")), { type: "callItADay" });
    expect(state.pending).toBeNull();
    expect(state.paper?.unseenMidday?.kind).toBe("harmless");
  });

  it("rest ten days after showing; a once-only card never comes back", () => {
    const rested = (shown: number, day: number) =>
      meet(beforeMidday("docks", (s) => {
        s.day = day;
        s.events[0]!.startDay = day;
        s.cards.terry = shown;
      })).state.pending;
    expect(rested(1, 10)).toBeNull();
    expect(rested(1, 11)).toMatchObject({ card: "terry" });
    const once = beforeMidday("docks", (s) => {
      s.cash = 500;
      s.cards = Object.fromEntries(POOL.map((id) => [id, 30]));
      s.cards.oldMate = 1;
      s.day = 30;
      s.events[0]!.startDay = 30;
    });
    expect(meet(once).state.pending).toBeNull();
  });

  it("are refused a choice that can't be afforded or carried, and that changes nothing", () => {
    const s = meet(beforeMidday("docks", (s) => wake(s, "terry"))).state;
    expect(step({ ...s, cash: 89 }, { type: "resolveCard", choice: "buy" })).toEqual({ ok: false, reason: "unavailable" });
    expect(step({ ...s, held: { ...s.held, smokes: 20 } }, { type: "resolveCard", choice: "buy" })).toEqual({ ok: false, reason: "unavailable" });
    expect(step(s, { type: "resolveCard", choice: "steal" })).toEqual({ ok: false, reason: "unknown" });
    expect(step(s, { type: "resolveStop", choice: "legIt" })).toEqual({ ok: false, reason: "noPending" });
  });

  it("survive a reload while pending", () => {
    const s = meet(beforeMidday("docks", (s) => wake(s, "terry"))).state;
    const loaded = loadSave(toSave(s));
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(step(loaded.state, { type: "resolveCard", choice: "buy" })).toEqual(step(s, { type: "resolveCard", choice: "buy" }));
  });
});

describe("the first pool", () => {
  const resolve = (s: GameState, choice: string, rng?: number) =>
    play(rng === undefined ? s : { ...s, rng }, { type: "resolveCard", choice });

  it("Terry's van: 20 smokes for $90, scaled down to the free pockets, at that cost", () => {
    const s = meet(beforeMidday("docks", (s) => wake(s, "terry"))).state;
    const full = resolve(s, "buy").state;
    expect([full.held.smokes, full.paid.smokes, full.cash]).toEqual([20, 90, s.cash - 90]);
    const half = resolve({ ...s, held: { ...s.held, tapes: 10 } }, "buy").state;
    expect([half.held.smokes, half.paid.smokes]).toEqual([10, 45]);
    expect(resolve(s, "pass").state.held.smokes).toBe(0);
  });

  it("a genuine watch sells one at half as much again as the price there, against its cost", () => {
    const s = meet(beforeMidday("uptown", (s) => {
      wake(s, "genuineWatch");
      s.held.watches = 2;
      s.paid.watches = 100;
    })).state;
    const price = Math.round(1.5 * s.market.uptown.watches.baseline);
    const { state, events } = resolve(s, "sell");
    expect([state.held.watches, state.paid.watches, state.cash]).toEqual([1, 50, s.cash + price]);
    expect(events[0]).toMatchObject({ type: "cardResolved", cash: price, goods: { watches: -1 } });
    expect(state.today.best).toMatchObject({ good: "watches", units: 1, proceeds: price });
    expect(state.milestones.firsts.sale).toBe(6);
  });

  it("standing up to a mugger is a Nerve chance frozen at the card: win Nerve, or lose $120", () => {
    const s = meet(beforeMidday("strip", (s) => {
      wake(s, "mugger");
      s.cash = 400;
      s.xp.nerve = 25;
    })).state;
    expect(s.pending).toEqual({ kind: "card", card: "mugger", odds: 60 });
    const won = resolve({ ...s, xp: { ...s.xp, nerve: 0 } }, "stand", rngWhere(below(0.59))).state;
    expect([won.cash, won.xp.nerve]).toEqual([s.cash, 2]);
    const lost = resolve(s, "stand", rngWhere(atLeast(0.6))).state;
    expect(lost.cash).toBe(s.cash - 120);
  });

  it("running costs an hour, and an hour that reaches 22:00 ends the day", () => {
    const s = meet(beforeMidday("strip", (s) => {
      wake(s, "mugger");
      s.cash = 400;
    })).state;
    const ran = resolve(s, "run").state;
    expect(ran.hour).toBe(s.hour + 1);
    expect(ran.detective.seen.strip.lieLow).toBe((s.detective.seen.strip.lieLow ?? 0) + 1);
    const late = resolve({ ...s, hour: 21 }, "run");
    expect(late.state.phase).toBe("night");
    expect(late.events.map((e) => e.type).slice(0, 2)).toEqual(["cardResolved", "dayEnded"]);
  });

  it("brazening out Trading Standards can cost half the good held most", () => {
    const s = meet(beforeMidday("oldtown", (s) => {
      wake(s, "tradingStandards");
      s.heat = 30;
      s.held.tapes = 7;
      s.paid.tapes = 70;
      s.held.smokes = 2;
      s.paid.smokes = 12;
    })).state;
    const lost = resolve(s, "brazen", rngWhere(atLeast(0.9))).state;
    expect([lost.held.tapes, lost.paid.tapes, lost.held.smokes, lost.today.seized]).toEqual([4, 40, 2, 3]);
    expect(resolve(s, "brazen", rngWhere(below(0.1))).state.held).toEqual(s.held);
  });

  it("an old mate's loan comes back four days later as a report: $150 and a tip", () => {
    let s = meet(beforeMidday("oldtown", (s) => {
      wake(s, "oldMate");
      s.cash = 400;
    })).state;
    s = resolve(s, "lend").state;
    expect([s.cash, s.flags.loan]).toEqual([400 + 30 - 100, 6]);
    const back = meet(beforeMidday("oldtown", (x) => {
      wake(x, "oldMatePays");
      x.flags.loan = 6;
      x.day = 10;
      x.events[0]!.startDay = 10;
    }));
    expect(back.state.pending).toBeNull();
    expect(back.state.flags.loan).toBeUndefined();
    expect(back.events.map((e) => e.type)).toEqual(expect.arrayContaining(["cardResolved", "tip"]));
    expect(back.state.cash).toBe(250 + 30 + 150);
  });

  it("every card has two or three choices or is a report, and at most one chance", () => {
    for (const [id, card] of Object.entries(CARDS)) {
      if (card.choices.length === 0) expect(card.report, id).toBeDefined();
      else expect(card.choices.length, id).toBeGreaterThanOrEqual(2);
      expect(card.choices.length, id).toBeLessThanOrEqual(3);
      expect(card.choices.filter((c) => c.chance).length, id).toBeLessThanOrEqual(1);
    }
  });
});

describe("review fixes", () => {
  it("a card's tip lands even when every place was seen today", () => {
    const { state, events } = meet(beforeMidday("oldtown", (x) => {
      wake(x, "oldMatePays");
      x.flags.loan = 1;
      x.seenToday = ["docks", "oldtown", "uptown", "strip"];
    }));
    const tip = events.find((e) => e.type === "tip");
    expect(tip).toMatchObject({ tip: { kind: "price" } });
    if (tip?.type === "tip" && tip.tip.kind === "price") {
      expect(tip.tip.place).not.toBe("oldtown");
      expect(state.memory[tip.tip.place][tip.tip.good]).toMatchObject({ day: state.day, hour: state.hour });
    }
  });

  it("a loaded card's odds must be frozen when it has a chance, so the sheet and the draw agree", () => {
    const s = newGame(1, "odds");
    s.cash = 400;
    const doc = (pending: GameState["pending"]) => toSave({ ...s, pending });
    expect(loadSave(doc({ kind: "card", card: "mugger", odds: null }))).toMatchObject({ ok: false, error: "invalid" });
    expect(loadSave(doc({ kind: "card", card: "terry", odds: 50 }))).toMatchObject({ ok: false, error: "invalid" });
    expect(loadSave(doc({ kind: "card", card: "terry", odds: null }))).toMatchObject({ ok: true });
  });

  it("a midday item that the action ending the day crossed is unseen: it makes the paper, and no card shows", () => {
    const s = beforeMidday("docks", (x) => {
      wake(x, "terry");
      x.hour = 12;
      x.rng = rngWhere(atLeast(0.5), atLeast(0.95));
    });
    const { state } = play(s, { type: "pullJob" });
    expect(state.paper?.log.arrested).toBe(true);
    expect(state.paper?.unseenMidday).toMatchObject({ kind: "harmless", line: "pigeons" });
    expect([state.pending, state.cards.terry]).toEqual([null, undefined]);
  });
});
