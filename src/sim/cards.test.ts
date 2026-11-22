import { CARDS, CARD_IDS, POOL } from "./cards.ts";
import { loadSave, toSave } from "./save.ts";
import { newGame, step, terryOffer } from "./sim.ts";
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

function reload(s: GameState, version?: number): GameState {
  const doc = JSON.parse(toSave(s));
  if (version !== undefined) doc.version = version;
  const loaded = loadSave(JSON.stringify(doc));
  if (!loaded.ok) throw new Error(loaded.detail);
  return loaded.state;
}

function legacyCard(place: GameState["place"], card: (typeof CARD_IDS)[number], odds: number | null = null): GameState {
  const s = beforeMidday(place);
  s.cash = 600;
  s.hour = 16;
  s.events = [];
  s.cards[card] = s.day;
  s.pending = { kind: "card", card, odds };
  return reload(s, 5);
}

describe("encounters", () => {
  it("take the harmless line's place at 16:00: the first card that fits, blocking", () => {
    // Both fit, and the collector is earlier in the pool.
    const both = (s: GameState) => {
      wake(s, "genuineWatch", "tradingStandards");
      s.cash = 400;
      s.held.watches = 1;
      s.heat = 45;
    };
    expect(meet(beforeMidday("docks", both)).state.pending).toMatchObject({ card: "tradingStandards" });
    const { state, events } = meet(beforeMidday("uptown", both));
    expect(state.pending).toEqual({ kind: "card", card: "genuineWatch", odds: null });
    expect(events.at(-1)).toMatchObject({ type: "card" });
    expect(state.events.some((e) => e.kind === "harmless")).toBe(false);
    expect(state.cards.genuineWatch).toBe(6);
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
      meet(beforeMidday("uptown", (s) => {
        s.day = day;
        s.events[0]!.startDay = day;
        s.held.watches = 1;
        s.cards.genuineWatch = shown;
      })).state.pending;
    expect(rested(1, 10)).toBeNull();
    expect(rested(1, 11)).toMatchObject({ card: "genuineWatch" });
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
    const s = legacyCard("docks", "terry");
    expect(step({ ...s, cash: 89 }, { type: "resolveCard", choice: "buy" })).toEqual({ ok: false, reason: "unavailable" });
    expect(step({ ...s, held: { ...s.held, smokes: 20 } }, { type: "resolveCard", choice: "buy" })).toEqual({ ok: false, reason: "unavailable" });
    expect(step(s, { type: "resolveCard", choice: "steal" })).toEqual({ ok: false, reason: "unknown" });
    expect(step(s, { type: "resolveStop", choice: "legIt" })).toEqual({ ok: false, reason: "noPending" });
  });

  it("keep retired cards out of the active pool", () => {
    expect(POOL).toEqual(["genuineWatch", "tradingStandards", "oldMate"]);
    for (const place of ["docks", "oldtown", "strip"] as const) {
      const s = meet(beforeMidday(place, (x) => { x.cash = 600; })).state;
      expect(s.pending).toBeNull();
      expect(s.events.some((e) => e.kind === "harmless")).toBe(true);
    }
  });
});

describe("card outcomes", () => {
  const resolve = (s: GameState, choice: string, rng?: number) =>
    play(rng === undefined ? s : { ...s, rng }, { type: "resolveCard", choice });

  it("a saved Terry card keeps the original buy and pass choices", () => {
    const s = legacyCard("docks", "terry");
    const full = resolve(s, "buy").state;
    expect([full.held.smokes, full.paid.smokes, full.cash]).toEqual([20, 90, s.cash - 90]);
    const half = resolve({ ...s, held: { ...s.held, tapes: 10 } }, "buy").state;
    expect([half.held.smokes, half.paid.smokes]).toEqual([10, 45]);
    expect(resolve(s, "pass").state.held.smokes).toBe(0);
  });

  it("saved Customs and church cards keep their buy, gift and pass effects", () => {
    const customs = legacyCard("docks", "customs");
    const bought = resolve(customs, "buy").state;
    expect([bought.held.tapes, bought.cash, bought.heat]).toEqual([10, 510, 5]);
    expect(resolve(customs, "pass").state.held.tapes).toBe(0);
    const church = { ...legacyCard("oldtown", "churchRoof"), heat: 20 };
    const gave = resolve(church, "give").state;
    expect([gave.cash, gave.heat]).toEqual([550, 12]);
    const walked = resolve(church, "walkOn").state;
    expect([walked.cash, walked.heat]).toEqual([600, 20]);
  });

  it("a saved bet keeps its even odds, either $100 outcome, and the option to pass", () => {
    const s = legacyCard("strip", "doubleOrNothing", 50);
    expect(s.pending).toMatchObject({ odds: 50 });
    expect(resolve(s, "bet", rngWhere(below(0.5))).state.cash).toBe(700);
    expect(resolve(s, "bet", rngWhere(atLeast(0.5))).state.cash).toBe(500);
    expect(resolve(s, "pass").state.cash).toBe(600);
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
    const s = legacyCard("strip", "mugger", 60);
    expect(s.pending).toEqual({ kind: "card", card: "mugger", odds: 60 });
    const won = resolve(s, "stand", rngWhere((n) => n >= 0.55 && n < 0.6)).state;
    expect([won.cash, won.xp.nerve]).toEqual([s.cash, 2]);
    const lost = resolve(s, "stand", rngWhere(atLeast(0.6))).state;
    expect(lost.cash).toBe(s.cash - 120);
    expect(resolve(s, "handOver").state.cash).toBe(s.cash - 50);
  });

  it("running costs an hour, and an hour that reaches 22:00 ends the day", () => {
    const s = legacyCard("strip", "mugger", 50);
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

  it("pays a loan once at the opening of day D+4 after early ends, an arrest and reload", () => {
    let s = meet(beforeMidday("oldtown", (s) => {
      wake(s, "oldMate");
      s.cash = 400;
      s.detective.next = 30;
    })).state;
    s = resolve(s, "lend").state;
    expect([s.cash, s.flags.loan]).toEqual([400 + 30 - 100, 6]);
    for (const day of [7, 8, 9]) {
      s = play(reload(play(s, { type: "callItADay" }).state), { type: "startDay" }).state;
      expect([s.day, s.flags.loan, s.cards.oldMatePays]).toEqual([day, 6, undefined]);
    }
    s.rng = rngWhere(atLeast(0.5), atLeast(0.95));
    const jailed = play(s, { type: "pullJob" }).state;
    expect(jailed.paper?.log.arrested).toBe(true);
    const back = play(reload(jailed), { type: "startDay" });
    expect([back.state.day, back.state.hour]).toEqual([10, 14]);
    expect(back.state.pending).toBeNull();
    expect(back.state.flags.loan).toBeUndefined();
    expect(back.events.map((e) => e.type).slice(-3)).toEqual(["dayStarted", "cardResolved", "tip"]);
    expect(back.state.cash).toBe(jailed.cash + 150);
    expect(back.state.dougieTip).toMatchObject({ day: 10, hour: 14 });
    const next = play(reload(play(back.state, { type: "callItADay" }).state), { type: "startDay" });
    expect(next.state.cash).toBe(back.state.cash);
    expect(next.events.some((e) => e.type === "cardResolved" || e.type === "tip")).toBe(false);
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

describe("compatibility", () => {
  it("pays an overdue legacy loan at the next opening and keeps the dated tip", () => {
    const s = beforeMidday("oldtown", (x) => { x.flags.loan = 1; });
    const closed = reload(play(s, { type: "callItADay" }).state, 5);
    const { state, events } = play(closed, { type: "startDay" });
    expect(state.cash).toBe(closed.cash + 150);
    expect(state.cards.oldMatePays).toBe(7);
    expect(state.flags.loan).toBeUndefined();
    const tip = events.find((e) => e.type === "tip");
    expect(tip).toMatchObject({ tip: { kind: "price" } });
    if (tip?.type === "tip" && tip.tip.kind === "price") {
      expect(tip.tip.place).not.toBe("oldtown");
      expect(state.memory[tip.tip.place][tip.tip.good]).toMatchObject({ day: state.day, hour: state.hour });
      expect(reload(state).dougieTip).toEqual({ place: tip.tip.place, good: tip.tip.good, price: tip.tip.price, day: 7, hour: 10 });
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

describe("Terry's optional quote", () => {
  const buy = { type: "buyTerry" } as const;

  it("can be taken once from 16:00 without taking time, then rests ten days", () => {
    const before = beforeMidday("docks");
    expect(terryOffer(before)).toBeNull();
    const s = meet(before).state;
    expect([s.pending, s.cards.terry]).toEqual([null, undefined]);
    expect(terryOffer(s)).toEqual({ units: 20, cost: 90, block: null });
    const take = play(reload(s), buy);
    expect([take.state.hour, take.state.cash, take.state.held.smokes, take.state.paid.smokes]).toEqual([s.hour, s.cash - 90, 20, 90]);
    expect(take.state.today).toMatchObject({ bought: 20, spent: 90 });
    expect(take.state.rng).toBe(s.rng);
    expect(step(reload(take.state), buy)).toEqual({ ok: false, reason: "unavailable" });
    for (const day of [15, 16]) {
      const later = beforeMidday("docks", (x) => {
        x.day = day;
        x.events[0]!.startDay = day;
        x.cards.terry = 6;
      });
      expect(!!terryOffer(meet(later).state)).toBe(day === 16);
    }
  });

  it("quotes proportional price and reports cash and pocket blocks separately", () => {
    const s = meet(beforeMidday("docks")).state;
    s.held.tapes = 10;
    s.cash = 44;
    expect(terryOffer(s)).toEqual({ units: 10, cost: 45, block: "noCash" });
    expect(step(s, buy)).toEqual({ ok: false, reason: "noCash" });
    expect(play({ ...s, cash: 45 }, buy).state.paid.smokes).toBe(45);
    s.held.tapes = 20;
    expect(terryOffer(s)).toEqual({ units: 0, cost: 0, block: "noPockets" });
    expect(step(s, buy)).toEqual({ ok: false, reason: "noPockets" });
  });

  it("can be revisited today or found on arriving late, unless a card took its slot", () => {
    const s = meet(beforeMidday("oldtown")).state;
    const docks = play(s, { type: "travel", to: "docks" }).state;
    expect(terryOffer(docks)).toMatchObject({ block: null });
    expect(terryOffer({ ...docks, hour: 21 })).toMatchObject({ block: null });
    expect(terryOffer(play(docks, { type: "callItADay" }).state)).toBeNull();
    const blocked = meet(beforeMidday("docks", (x) => {
      wake(x, "oldMate");
      x.cash = 400;
    })).state;
    const passed = play(blocked, { type: "resolveCard", choice: "notNow" }).state;
    expect(terryOffer(passed)).toBeNull();
  });
});
