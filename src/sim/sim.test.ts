import { GOODS, PLACES, RULES } from "./content.ts";
import { price, police } from "./market.ts";
import { Rng } from "./rng.ts";
import { loadSave, toSave } from "./save.ts";
import { maxSale, newGame, quoteJob, quoteSale, step, type Action, type DomainEvent } from "./sim.ts";
import type { GameState, WorldEvent } from "./state.ts";
import { any, atLeast, below, play, rngWhere } from "./testing.ts";

const fresh = (): GameState => newGame(42, "test-run");
const noStop = rngWhere(atLeast(0.5));
const types = (events: DomainEvent[]) => events.map((e) => e.type);
const find = <T extends DomainEvent["type"]>(events: DomainEvent[], type: T) =>
  events.find((e): e is Extract<DomainEvent, { type: T }> => e.type === type);

/** A state standing somewhere at a given hour, with the generator set by the caller. */
function at(place: GameState["place"], hour: number, rng = noStop, edit?: (s: GameState) => void): GameState {
  const s = fresh();
  s.place = place;
  s.hour = hour;
  s.seenToday = [place];
  s.rng = rng;
  edit?.(s);
  return s;
}

const middayShortage = (place: GameState["place"], good: (typeof GOODS)[number]): WorldEvent => ({
  id: "d1-midday",
  slot: "midday",
  startDay: 1,
  startHour: 16,
  endDay: 2,
  activated: false,
  kind: "shortage",
  place,
  good,
});

describe("day 1 fixture", () => {
  it("matches the design's market", () => {
    const s = fresh();
    const prices = Object.fromEntries(PLACES.map((p) => [p, GOODS.map((g) => price(s, p, g))]));
    expect(prices).toEqual({
      docks: [6, 15, 38, 75],
      oldtown: [8, 11, 50, 120],
      uptown: [10, 16, 65, 100],
      strip: [10, 20, 53, 130],
    });
    expect(GOODS.map((g) => s.market.docks[g].stock)).toEqual([40, 8, 6, 0]);
    expect(GOODS.map((g) => s.market.oldtown[g].stock)).toEqual([12, 30, 4, 1]);
    expect(GOODS.map((g) => s.market.strip[g].demand)).toEqual([46, 42, 17, 10]);
  });

  it("starts at the Docks at 10:00 with $250, a midday sweep and a day-2 shortage scheduled", () => {
    const s = fresh();
    expect([s.place, s.hour, s.cash, s.heat]).toEqual(["docks", 10, 250, 0]);
    expect(s.events.map((e) => [e.id, e.kind, e.activated])).toEqual([
      ["d1-midday", "sweep", false],
      ["d2-morning", "shortage", false],
    ]);
  });

  it("supports the design's first choice: 20 smokes, or 17 smokes and 3 watches", () => {
    expect(play(fresh(), { type: "buy", good: "smokes", units: 20 }).state.cash).toBe(130);
    const mixed = play(fresh(), { type: "buy", good: "smokes", units: 17 }, { type: "buy", good: "watches", units: 3 });
    expect(mixed.state.cash).toBe(34);
  });
});

describe("refusals", () => {
  const cases: [string, GameState, Action][] = [
    ["more than the stock", fresh(), { type: "buy", good: "fireworks", units: 1 }],
    ["more than the cash", fresh(), { type: "buy", good: "watches", units: 7 }],
    ["more than the pockets", fresh(), { type: "buy", good: "smokes", units: 21 }],
    ["zero units", fresh(), { type: "buy", good: "smokes", units: 0 }],
    ["fractional units", fresh(), { type: "sell", good: "smokes", units: 1.5 }],
    ["selling what isn't held", fresh(), { type: "sell", good: "smokes", units: 1 }],
    ["an unknown good", fresh(), { type: "buy", good: "gold" as "smokes", units: 1 }],
    ["travelling nowhere", fresh(), { type: "travel", to: "docks" }],
    ["a job without the hours", at("docks", 19), { type: "pullJob" }],
    ["lying low at 21:00", at("docks", 21), { type: "lieLow" }],
    ["an upgrade without the cash", fresh(), { type: "buyUpgrade", upgrade: "coat" }],
    ["resolving with no stop", fresh(), { type: "resolveStop", choice: "legIt" }],
    ["starting a day by day", fresh(), { type: "startDay" }],
  ];

  it.each(cases)("refuses %s, drawing nothing and changing nothing", (_, state, action) => {
    const before = structuredClone(state);
    const r = step(state, action);
    expect(r.ok).toBe(false);
    expect(state).toEqual(before);
  });

  it("refuses a sale whose units need more hours than are left", () => {
    const s = at("strip", 21, noStop, (s) => (s.held.tapes = 9));
    expect(maxSale(s, "tapes")).toBe(8);
    expect(quoteSale(s, "tapes", 9)).toBe("noTime");
  });
});

describe("trading", () => {
  it("buys in no time and sells in hours rounded up", () => {
    const { state, events } = play(
      fresh(),
      { type: "buy", good: "smokes", units: 17 },
      { type: "buy", good: "watches", units: 3 },
    );
    expect(state.hour).toBe(10);
    const s = { ...state, place: "strip" as const, rng: noStop };
    expect(types(events)).toEqual(["bought", "bought"]);
    const sold = play(s, { type: "sell", good: "smokes", units: 17 });
    expect(find(sold.events, "sold")).toMatchObject({ units: 17, proceeds: 170, hours: 2 });
    expect(sold.state.hour).toBe(12);
    expect(sold.state.market.strip.smokes.demand).toBe(46 - 17);
    expect(sold.state.xp.patter).toBe(2);
    expect(sold.state.heat).toBeCloseTo(17 * 0.3);
  });

  it("uses Patter's exact rate: 26 tapes fit in 3 h at level 1", () => {
    const s = at("strip", 19, noStop, (s) => {
      s.xp.patter = 11;
      s.upgrades = ["coat"];
      s.held.tapes = 30;
    });
    expect(maxSale(s, "tapes")).toBe(26);
    expect((quoteSale(s, "tapes", 26) as { hours: number }).hours).toBe(3);
  });

  it("never rerolls: a revisit sees the stock already bought", () => {
    const s = play(
      fresh(),
      { type: "buy", good: "smokes", units: 10 },
      { type: "travel", to: "oldtown" },
      { type: "travel", to: "docks" },
    ).state;
    expect(s.market.docks.smokes.stock).toBe(30);
    expect(price(s, "docks", "smokes")).toBe(6);
  });
});

describe("timing", () => {
  it("a sale across 16:00 pays as quoted and the next quote sees the midday change", () => {
    const s = at("strip", 15, noStop, (s) => {
      s.held.tapes = 16;
      s.events[0] = middayShortage("strip", "tapes");
    });
    const { state, events } = play(s, { type: "sell", good: "tapes", units: 16 });
    expect(find(events, "sold")?.proceeds).toBe(16 * 20);
    expect(state.hour).toBe(17);
    expect(types(events)).toContain("eventStarted");
    expect(price(state, "strip", "tapes")).toBe(34);
    expect(state.market.strip.tapes.demand).toBe(Math.round(1.5 * (42 - 16)));
    expect(state.market.strip.tapes.stock).toBe(Math.floor(0.3 * 8));
  });

  it("an action ending exactly at 16:00 already shows the midday item", () => {
    const s = at("strip", 15, noStop, (s) => {
      s.held.tapes = 16;
      s.events[0] = middayShortage("strip", "tapes");
    });
    const { state, events } = play(s, { type: "sell", good: "tapes", units: 8 });
    expect(state.hour).toBe(16);
    expect(find(events, "eventStarted")?.event.id).toBe("d1-midday");
    expect((quoteSale(state, "tapes", 1) as { proceeds: number }).proceeds).toBe(34);
  });

  it("a sale ending at 22:00 that crossed 16:00 leads the paper with the midday item", () => {
    const s = at("strip", 15, noStop, (s) => {
      s.upgrades = ["coat"];
      s.held.watches = 28;
      s.market.strip.watches.demand = 40;
    });
    const { state, events } = play(s, { type: "sell", good: "watches", units: 28 });
    expect(find(events, "sold")?.proceeds).toBe(28 * 53);
    expect(find(events, "dayEnded")?.cause).toBe("clock");
    expect(state.paper?.unseenMidday?.id).toBe("d1-midday");
    expect(state.phase).toBe("night");
  });

  it("calling it a day at 14:00 still activates the 16:00 sweep and cools the unused hours", () => {
    const s = at("docks", 14, noStop, (s) => (s.heat = 30));
    const { state } = play(s, { type: "callItADay" });
    expect(state.paper?.unseenMidday?.kind).toBe("sweep");
    expect(state.heat).toBeCloseTo(30 - 1.5 * 8 - 8);
    expect(state.events.find((e) => e.id === "d1-midday")?.activated).toBe(true);
    const next = play(state, { type: "startDay" }).state;
    expect([next.day, next.hour]).toEqual([2, 10]);
    expect(police(next, "strip")).toBe(2);
  });

  it("an arrest before 16:00 ends the day, skips no event and makes the next day start at 14:00", () => {
    const s = at("docks", 11, rngWhere(atLeast(0.5), atLeast(0.95)));
    const { state, events } = play(s, { type: "pullJob" });
    expect(find(events, "job")?.outcome).toBe("arrested");
    expect(find(events, "arrested")?.fine).toBe(50);
    expect(state.cash).toBe(200);
    expect(state.heat).toBe(17);
    expect(state.paper?.unseenMidday?.kind).toBe("sweep");
    const next = play(state, { type: "startDay" }).state;
    expect([next.day, next.hour]).toEqual([2, 14]);
    expect(price(next, "oldtown", "fireworks")).toBe(Math.round(next.market.oldtown.fireworks.baseline * 1.7));
    expect(police(next, "strip")).toBe(2);
  });

  it("effects end only at 22:00: the day-1 sweep lasts through day 2 and is gone on day 3", () => {
    let s = play(fresh(), { type: "callItADay" }, { type: "startDay" }).state;
    expect(police(s, "strip")).toBe(2);
    s = play(s, { type: "callItADay" }, { type: "startDay" }).state;
    expect(police(s, "strip")).toBe(1);
    expect(s.events.some((e) => e.id === "d1-midday")).toBe(false);
  });
});

describe("police stops", () => {
  const stopped = rngWhere(below(0.005));
  const carrying = (rng: number, edit?: (s: GameState) => void) =>
    at("strip", 11, rng, (s) => {
      s.held.smokes = 17;
      edit?.(s);
    });

  it("a stop blocks every action, zero-hour ones included, and the clock stands still", () => {
    const { state, events } = play(carrying(stopped), { type: "sell", good: "smokes", units: 17 });
    expect(find(events, "stopped")?.stop.bribe).toBe(Math.ceil(40 + 0.25 * 170));
    expect(state.hour).toBe(11);
    for (const a of [{ type: "buy", good: "smokes", units: 1 }, { type: "callItADay" }, { type: "lieLow" }] as Action[]) {
      expect(step(state, a)).toEqual({ ok: false, reason: "pending" });
    }
  });

  it("slipping him something pays, adds heat and runs the sale as quoted, unchecked", () => {
    const s = play(carrying(rngWhere(below(0.005), below(0.8))), { type: "sell", good: "smokes", units: 17 }).state;
    expect(s.pending?.bribeOdds).toBe(80);
    const { state, events } = play(s, { type: "resolveStop", choice: "bribe" });
    expect(types(events)).toEqual(["bribed", "sold"]);
    expect(state.cash).toBe(250 - 83 + 170);
    expect(state.heat).toBeCloseTo(10 + 17 * 0.3);
    expect(state.xp.nerve).toBe(2);
    expect(state.hour).toBe(13);
  });

  it("an honest copper refuses the bribe: no money changes hands, he takes the goods, heat +10", () => {
    const s = carrying(rngWhere(below(0.005), atLeast(0.8)), (s) => (s.paid.smokes = 102));
    const { state, events } = play(s, { type: "sell", good: "smokes", units: 17 }, { type: "resolveStop", choice: "bribe" });
    expect(types(events)).toEqual(["stopped", "bribeRefused"]);
    expect(find(events, "bribeRefused")).toMatchObject({ saleOff: true, seized: { smokes: 17 } });
    expect([state.cash, state.held.smokes, state.paid.smokes, state.hour, state.today.seized]).toEqual([250, 0, 0, 11, 17]);
    expect(state.heat).toBeCloseTo(10);
  });

  it("bribe odds follow the usual formula: Nerve helps, heat hurts", () => {
    const s = play(carrying(stopped, (s) => {
      s.heat = 40;
      s.xp.nerve = 25;
    }), { type: "sell", good: "smokes", units: 17 }).state;
    expect(s.pending?.bribeOdds).toBeCloseTo(80 + 10 - 12);
  });

  it("legging it: success runs the sale; failure is an arrest and no sale", () => {
    const ok = play(carrying(rngWhere(below(0.005), below(0.5))), { type: "sell", good: "smokes", units: 17 }, { type: "resolveStop", choice: "legIt" });
    expect(types(ok.events)).toEqual(["stopped", "leggedIt", "sold"]);
    expect(ok.state.heat).toBeCloseTo(10 + 17 * 0.3);

    const caught = play(carrying(rngWhere(below(0.005), atLeast(0.5))), { type: "sell", good: "smokes", units: 17 }, { type: "resolveStop", choice: "legIt" });
    // The day end also activates the 16:00 sweep nobody saw.
    expect(types(caught.events)).toEqual(["stopped", "leggedIt", "arrested", "eventStarted", "dayEnded"]);
    expect(caught.state.held.smokes).toBe(0);
    expect(caught.state.cash).toBe(200);
    expect(caught.state.nextStart).toBe(14);
    expect(caught.state.paper?.log).toMatchObject({ arrested: true, fine: 50, seized: 17 });
  });

  it("handing it over before a sale seizes the goods, calls the sale off and spends no time", () => {
    const { state, events } = play(carrying(stopped), { type: "sell", good: "smokes", units: 17 }, { type: "resolveStop", choice: "handOver" });
    expect(find(events, "handedOver")).toMatchObject({ saleOff: true, seized: { smokes: 17 } });
    expect(types(events)).not.toContain("sold");
    expect([state.hour, state.cash, state.heat, state.market.strip.smokes.demand]).toEqual([11, 250, 0, 46]);
  });

  it("handing it over before a job still runs the job", () => {
    const s = carrying(rngWhere(below(0.01), below(0.5), any));
    const { events } = play(s, { type: "pullJob" }, { type: "resolveStop", choice: "handOver" });
    expect(types(events)).toEqual(["stopped", "handedOver", "job"]);
    expect(find(events, "job")?.outcome).toBe("success");
  });

  it("with empty pockets there is no card, just a pat-down", () => {
    const { events } = play(at("strip", 11, rngWhere(below(0.01), below(0.5), any)), { type: "pullJob" });
    expect(types(events)).toEqual(["pattedDown", "job"]);
  });

  it("no bribe at wanted or when it can't be paid", () => {
    const wanted = play(carrying(rngWhere(below(0.5)), (s) => (s.heat = 70)), { type: "sell", good: "smokes", units: 17 }).state;
    expect(wanted.pending).toMatchObject({ bribe: null, bribeRefusal: "wanted" });
    expect(step(wanted, { type: "resolveStop", choice: "bribe" })).toEqual({ ok: false, reason: "bribeRefused" });
    const broke = play(carrying(stopped, (s) => (s.cash = 10)), { type: "sell", good: "smokes", units: 17 }).state;
    expect(broke.pending).toMatchObject({ bribe: null, bribeRefusal: "short" });
  });

  it("a reload while a card is pending resolves exactly as without it", () => {
    const s = play(carrying(rngWhere(below(0.005), any)), { type: "sell", good: "smokes", units: 17 }).state;
    const loaded = loadSave(toSave(s));
    if (!loaded.ok) throw new Error(loaded.detail);
    const a = step(s, { type: "resolveStop", choice: "legIt" });
    const b = step(loaded.state, { type: "resolveStop", choice: "legIt" });
    expect(b).toEqual(a);
  });

  it("a stop's heat and new level never change the job's frozen odds", () => {
    // Frozen at 60%; after the bribe and Nerve level 1 the live odds would be 62%.
    const s = at("docks", 10, rngWhere(below(0.01), (x) => x >= 0.605 && x < 0.615, any), (s) => {
      s.xp.nerve = 8;
      s.held.smokes = 1;
    });
    const { events } = play(s, { type: "pullJob" }, { type: "resolveStop", choice: "bribe" });
    expect(find(events, "levelUp")).toMatchObject({ skill: "nerve", level: 1 });
    expect(find(events, "job")?.outcome).toBe("nothing");
  });
});

describe("jobs", () => {
  const job = (...draws: ((x: number) => boolean)[]) =>
    play(at("docks", 10, rngWhere(atLeast(0.5), ...draws)), { type: "pullJob" });

  it("success pays $175-$325 and +8 heat, once a day", () => {
    const { state, events } = job(below(0.6), any);
    const pay = find(events, "job")?.pay ?? 0;
    expect(pay).toBeGreaterThanOrEqual(175);
    expect(pay).toBeLessThanOrEqual(325);
    expect([state.cash, state.heat, state.hour, state.xp.nerve]).toEqual([250 + pay, 8, 14, 2]);
    expect(step(state, { type: "pullJob" })).toEqual({ ok: false, reason: "jobDone" });
  });

  it("nothing doing costs 4 h and +15 heat", () => {
    const { state, events } = job((x) => x >= 0.6 && x < 0.8);
    expect(find(events, "job")?.outcome).toBe("nothing");
    expect([state.cash, state.heat, state.hour]).toEqual([250, 15, 14]);
  });

  it("hurt ends the day with nothing lost and no cooling for the lost hours", () => {
    const s = at("docks", 10, rngWhere(atLeast(0.5), (x) => x >= 0.8 && x < 0.9), (s) => (s.held.smokes = 5));
    const { state, events } = play(s, { type: "pullJob" });
    expect(find(events, "dayEnded")?.cause).toBe("hurt");
    expect([state.cash, state.held.smokes, state.heat, state.nextStart]).toEqual([250, 5, 7, 10]);
  });

  it("odds are 60% + 5 per Nerve level − 0.3 per heat, clamped 10-90%", () => {
    expect((quoteJob(at("docks", 10)) as { success: number }).success).toBe(60);
    expect((quoteJob(at("docks", 10, noStop, (s) => (s.heat = 100))) as { success: number }).success).toBe(30);
    expect((quoteJob(at("docks", 10, noStop, (s) => (s.xp.nerve = 100))) as { success: number }).success).toBe(85);
  });

  it("an arrest fines 15% of cash rounded up, at least $50, never more than the player has", () => {
    const arrestedWith = (cash: number) =>
      play(at("docks", 10, rngWhere(atLeast(0.5), atLeast(0.95)), (s) => (s.cash = cash)), { type: "pullJob" }).state.cash;
    expect(arrestedWith(1000)).toBe(850);
    expect(arrestedWith(301)).toBe(301 - 50);
    expect(arrestedWith(30)).toBe(0);
    expect(arrestedWith(0)).toBe(0);
  });
});

describe("tips", () => {
  it("gives the rumour first, then a price tip, at most two per place", () => {
    const s = at("docks", 10, rngWhere(below(0.7)));
    const { state, events } = play(s, { type: "askAround" }, { type: "askAround" });
    const tips = events.filter((e) => e.type === "tip").map((e) => (e as { tip: unknown }).tip);
    expect(tips[0]).toMatchObject({ kind: "rumour", truthful: true, claim: { kind: "shortage", place: "oldtown", good: "fireworks" } });
    expect(tips[1]).toEqual({ kind: "price", place: "oldtown", good: "fireworks", price: 120 });
    expect(state.memory.oldtown.fireworks?.price).toBe(120);
    expect(state.xp.savvy).toBe(2);
    expect(step(state, { type: "askAround" })).toEqual({ ok: false, reason: "noTips" });
  });

  it("a price tip names the good held most", () => {
    const s = at("docks", 10, noStop, (s) => {
      s.held.tapes = 3;
      s.rumour = { claim: null, truthful: true, via: "ask" };
    });
    const tip = find(play(s, { type: "askAround" }).events, "tip")?.tip;
    expect(tip).toMatchObject({ kind: "price", good: "tapes", place: "oldtown" });
  });

  it("the phone gives no midday rumour of its own: it stays with asking around", () => {
    const owner = at("docks", 15, noStop, (s) => (s.upgrades = ["phone"]));
    const { state, events } = play(owner, { type: "lieLow" });
    expect(find(events, "tip")).toBeUndefined();
    expect(state.rumour).toBeNull();
    expect(find(play(state, { type: "askAround" }).events, "tip")?.tip).toMatchObject({ kind: "rumour", via: "ask" });
  });

  it("a false rumour names a pair with no event tomorrow", () => {
    const { events } = play(at("docks", 10, rngWhere(atLeast(0.99), any, any)), { type: "askAround" });
    const tip = find(events, "tip")?.tip as { truthful: boolean; claim: { place: string; good: string } };
    expect(tip.truthful).toBe(false);
    expect(`${tip.claim.place}:${tip.claim.good}`).not.toBe("oldtown:fireworks");
  });
});

describe("the burner phone", () => {
  const owner = () => at("docks", 12, noStop, (s) => (s.upgrades = ["phone"]));

  it("ringing round needs the phone", () => {
    expect(step(at("docks", 12), { type: "ringRound" })).toEqual({ ok: false, reason: "noPhone" });
  });

  it("takes no time, notes every place's price now, and each call today costs more heat", () => {
    const one = play(owner(), { type: "ringRound" });
    expect(find(one.events, "rangRound")).toEqual({ type: "rangRound", heat: 5 });
    expect([one.state.hour, one.state.heat, one.state.calls]).toEqual([12, 5, 1]);
    for (const p of PLACES) {
      for (const g of GOODS) expect(one.state.memory[p][g]).toEqual({ price: price(one.state, p, g), day: 1, hour: 12 });
    }
    const two = play(one.state, { type: "ringRound" }, { type: "ringRound" });
    expect([two.state.heat, two.state.calls]).toEqual([30, 3]);
  });

  it("the count starts again each day", () => {
    const s = play(owner(), { type: "ringRound" }, { type: "callItADay" }, { type: "startDay" }).state;
    expect(s.calls).toBe(0);
    expect(find(play(s, { type: "ringRound" }).events, "rangRound")?.heat).toBe(5);
  });
});

describe("cost and profit", () => {
  it("a sale's cost is its share of what the held units cost", () => {
    const bought = play(at("docks", 10), { type: "buy", good: "smokes", units: 10 }).state;
    expect(bought.paid.smokes).toBe(60);
    const s = at("strip", 11, noStop, (s) => {
      s.held = bought.held;
      s.paid = bought.paid;
    });
    const half = play(s, { type: "sell", good: "smokes", units: 4 });
    expect(find(half.events, "sold")).toMatchObject({ proceeds: 40, cost: 24 });
    expect(half.state.paid.smokes).toBe(36);
    const rest = play({ ...half.state, rng: noStop }, { type: "sell", good: "smokes", units: 6 });
    expect(find(rest.events, "sold")).toMatchObject({ proceeds: 60, cost: 36 });
    expect(rest.state.paid.smokes).toBe(0);
  });
});

describe("upgrades", () => {
  const rich = (edit?: (s: GameState) => void) =>
    at("docks", 10, noStop, (s) => {
      s.cash = 10_000;
      edit?.(s);
    });

  it("the coat gives 35 pockets", () => {
    const s = play(rich(), { type: "buyUpgrade", upgrade: "coat" }, { type: "buy", good: "smokes", units: 35 }).state;
    expect(s.held.smokes).toBe(35);
    expect(s.cash).toBe(10_000 - 800 - 35 * 6);
  });

  it("an upgrade is bought once", () => {
    const s = play(rich(), { type: "buyUpgrade", upgrade: "phone" }).state;
    expect(step(s, { type: "buyUpgrade", upgrade: "phone" })).toEqual({ ok: false, reason: "owned" });
    expect(step(s, { type: "buyUpgrade", upgrade: "lockup" as "coat" })).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("the generator", () => {
  it("lives in the state: the same state and action give the same result", () => {
    const s = play(fresh(), { type: "buy", good: "smokes", units: 20 }, { type: "callItADay" }).state;
    expect(step(s, { type: "startDay" })).toEqual(step(structuredClone(s), { type: "startDay" }));
  });

  it("is a 32-bit position that advances on every draw", () => {
    const rng = new Rng(7);
    const first = rng.next();
    expect(Number.isInteger(rng.state)).toBe(true);
    expect(new Rng(7).next()).toBe(first);
    expect(rng.next()).not.toBe(first);
  });
});

describe("day end", () => {
  it("cools 1.5 per unused hour, then 8 overnight; an arrest goes 25 to 17", () => {
    expect(play(at("docks", 22 - 4, noStop, (s) => (s.heat = 20)), { type: "callItADay" }).state.heat).toBe(6);
    expect(play(at("docks", 12, noStop, (s) => (s.heat = 3)), { type: "callItADay" }).state.heat).toBe(0);
  });

  it("rolls tomorrow's market and keeps a capped news log", () => {
    let s = fresh();
    for (let d = 0; d < RULES.newsCap + 5; d++) s = play(s, { type: "callItADay" }, { type: "startDay" }).state;
    expect(s.news).toHaveLength(RULES.newsCap);
    expect(s.news.at(-1)?.day).toBe(s.day - 1);
    expect(s.day).toBe(RULES.newsCap + 6);
  });
});
