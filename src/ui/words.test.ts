import { CARD_IDS, CARDS, newGame, type DomainEvent, type GameState, type Paper } from "../sim/index.ts";
import { atLeast, below, noGoods, play, rngWhere } from "../sim/testing.ts";
import { hasText, t } from "./text.ts";
import { currentCaseNotice } from "./caseWords.ts";
import { briefs, cardKeys, choiceChips, exhibits, oddsWord, paperView, resultLines } from "./words.ts";

const noPlaceholders = (lines: string[]) => {
  for (const line of lines) expect(line).not.toMatch(/[{}]/);
};

describe("what the player reads", () => {
  it("fills every named value and shows a missing one", () => {
    expect(t("trade.commitSell", { n: 6, total: "$288", hours: 2 })).toBe("Sell 6 for $288 · 2 h");
    expect(t("status.day")).toBe("Day {day}");
  });

  it("names a sale and its cause when the buyers are used up", () => {
    let s: GameState = newGame(1, "words");
    let events: DomainEvent[];
    ({ state: s } = play(s, { type: "buy", good: "tapes", units: 3 }, { type: "travel", to: "strip" }));
    const demand = s.market.strip.tapes.demand;
    ({ state: s, events } = play(s, { type: "sell", good: "tapes", units: Math.min(3, demand) }));
    const lines = resultLines(events, s);
    expect(lines[0]).toMatch(/^Sold \d+ tapes? for \$\d+: \$\d+ profit\.$/);
    if (s.market.strip.tapes.demand === 0) expect(lines[1]).toBe("Nobody here wants more tapes today.");
    noPlaceholders(lines);
  });

  it("opens day 1 with its morning line", () => {
    const b = briefs(newGame(1, "words"));
    expect(b.map((x) => x.line)).toEqual(["Smokes going cheap at the Docks. The Strip's gasping."]);
  });

  it("leads day 1's paper with the unseen sweep and announces tomorrow's shortage", () => {
    const { state } = play(newGame(1, "words"), { type: "callItADay" });
    if (!state.paper) throw new Error("no paper");
    const view = paperView(state.paper);
    expect(view.head).toBe("Police sweep on the Strip");
    expect(view.required).toContainEqual(expect.objectContaining({
      title: "Fireworks shortage in Old Town",
      meta: "Confirmed · From 10:00 on day 2 through day 3",
    }));
    noPlaceholders([view.head, view.story, ...view.briefs, ...view.chips]);
  });

  it("says what an arrest cost, on the night and in the paper", () => {
    const s = newGame(1, "words");
    s.place = "strip";
    s.held.smokes = 12;
    s.held.watches = 3;
    s.rng = rngWhere(below(0.005), atLeast(0.5));
    const { state, events } = play(s, { type: "sell", good: "smokes", units: 12 }, { type: "resolveStop", choice: "legIt" });
    if (!state.paper) throw new Error("no paper");
    const lines = resultLines(events, state);
    expect(lines).toEqual([
      "You legged it. Not fast enough.",
      "They took 12 cartons of smokes, 3 watches and fined you $50.",
    ]);
    const view = paperView(state.paper);
    expect(view.story).toBe("Fined $50 and a cold night in the cells. Out at 14:00 tomorrow.");
    expect(view.chips).toEqual(expect.arrayContaining(["Seized 15", "Fine $50"]));
  });

  it("names a loss, and a refused bribe", () => {
    const sold: DomainEvent = { type: "sold", good: "tapes", units: 2, proceeds: 20, cost: 30, hours: 1 };
    expect(resultLines([sold], newGame(1, "words"))[0]).toBe("Sold 2 tapes for $20: a $10 loss.");
    const refused: DomainEvent = { type: "bribeRefused", seized: { ...noGoods(), smokes: 1 }, saleOff: true };
    expect(resultLines([refused], newGame(1, "words"))).toEqual(["“I'm an honest copper.” He took the lot. The sale's off."]);
  });

  it("puts odds into words", () => {
    expect([90, 65, 50, 30, 10].map(oddsWord)).toEqual(["likely", "good", "even", "poor", "long"]);
  });
});

describe("cards", () => {
  it("have every line they need", () => {
    for (const id of CARD_IDS) for (const key of cardKeys(id)) expect(hasText(key), key).toBe(true);
  });

  it("show their effects as chips: solid when certain, dashed with odds when a chance", () => {
    const s = newGame(1, "words");
    s.cash = 400;
    const [hand, stand, run] = CARDS.mugger.choices;
    expect(choiceChips(s, hand!, null).map((c) => [c.text, c.kind])).toEqual([["−$50", "certain"]]);
    expect(choiceChips(s, stand!, 50).map((c) => [c.text, c.kind])).toEqual([
      ["even odds", "chance"],
      ["Nerve +2", "chance"],
      ["−$120", "chance"],
    ]);
    expect(choiceChips(s, run!, null).map((c) => c.text)).toEqual(["1 h"]);
    expect(choiceChips(s, CARDS.terry.choices[0]!, null).map((c) => c.text)).toEqual(["−$90", "+20 cartons of smokes"]);
  });

  it("leave a line naming what changed", () => {
    const e: DomainEvent = {
      type: "cardResolved",
      card: "terry",
      choice: "buy",
      won: null,
      cash: -45,
      goods: { ...noGoods(), smokes: 10 },
      places: null,
    };
    expect(resultLines([e], newGame(1, "words"))).toEqual(["10 cartons of smokes for $45. Terry's gone before you can count them."]);
  });
});

describe("the paper", () => {
  const paper = (edit: (p: Paper) => void): Paper => {
    const { state } = play(newGame(1, "words"), { type: "callItADay" });
    const p = structuredClone(state.paper!);
    edit(p);
    return p;
  };
  const kase = { n: 1, place: "uptown" as const, habit: "watches" as const, announced: 5, places: ["uptown" as const], caught: false };

  it("leads with a milestone, then Pinch, then an arrest", () => {
    const pinch = (p: Paper) => {
      p.day = 5;
      p.pinch = [{ kind: "announced", case: kase }];
      p.case = kase;
    };
    expect(paperView(paper((p) => {
      pinch(p);
      p.firsts = ["coat"];
    })).head).toBe("Big coat, bigger plans");
    const view = paperView(paper(pinch));
    expect(view.head).toBe("Pinch opens a case in Uptown");
    expect(view.story).toContain("Pinch’s theory concerned watches in Uptown. Operation Kipper runs in Uptown on days 7–8.");
    expect(paperView(paper((p) => {
      p.log.arrested = true;
      p.log.fine = 50;
    })).head).toBe("Nicked!");
  });

  it("keeps an unseen midday item when a bigger story leads", () => {
    const view = paperView(paper((p) => {
      p.day = 3;
      p.pinch = [{ kind: "intro" }];
      p.unseenMidday = { id: "d3-midday", slot: "midday", startDay: 3, startHour: 16, endDay: 4, activated: true, kind: "harmless", line: "parade" };
    }));
    expect(view.head).toBe("New on the beat");
    expect(view.briefs).toContain("A brass band parade. Everyone's watching the tuba.");
  });

  it("keeps distinct required updates in a crowded edition without the optional cap", () => {
    const past = { n: 2, place: "uptown" as const, habit: "watches" as const, outcome: "cold" as const, day: 26 };
    const view = paperView(paper((p) => {
      p.day = 26;
      p.firsts = ["arrest"];
      p.log.arrested = true;
      p.log.fine = 50;
      p.case = { ...kase, announced: 26 };
      p.pinch = [{ kind: "cold", case: past }, { kind: "promoted" }, { kind: "announced", case: p.case }, { kind: "credit" }];
      p.unseenMidday = { id: "d26-midday", slot: "midday", startDay: 26, startHour: 16, endDay: 27, activated: true, kind: "sweep", place: "uptown" };
      p.tomorrow = [p.unseenMidday, { id: "morning", kind: "glut", good: "tapes", place: "docks", slot: "morning", startDay: 27, endDay: 28, startHour: 10, activated: false }];
    }));
    expect(view.head).toBe("Nicked!");
    expect(view.required.map((n) => n.title)).toEqual(["Operation Winkle went cold", "Pinch made Inspector", "Operation Kipper", "Police sweep", "Tapes glut at the Docks"]);
  });

  it("warns of an operation the night before, and leads a quiet day with its best sale", () => {
    const view = paperView(paper((p) => {
      p.day = 6;
      p.case = kase;
      p.unseenMidday = null;
      p.tomorrow = [];
      p.log.best = { good: "tapes", units: 12, proceeds: 240, place: "strip" };
    }));
    expect(view.head).toBe("Tapes fly on the Strip");
    expect(view.story).toBe("12 tapes gone for $240, and nobody the wiser.");
    expect(view.required).toEqual([{ title: "Operation Kipper", meta: "Scheduled in Uptown · days 7–8", body: "Sales and risky jobs face higher stop risk. Pinch refuses bribes." }]);
  });

  it("is bylined by Lenny and carries Old Reg's worries until the pub is sold", () => {
    expect(paperView(paper((p) => (p.day = 4))).briefs).toContain("Old Reg of the Crown & Anchor: “$2,500 and she's yours. Please.”");
    expect(paperView(paper((p) => {
      p.day = 4;
      p.crown = true;
    })).briefs.some((b) => b.includes("Reg"))).toBe(false);
  });
});

describe("the People tab", () => {
  it("pins each milestone as an exhibit, in order, with Pinch's reading", () => {
    const s = newGame(1, "words");
    s.milestones.firsts = { coat: 4, sale: 1 };
    s.milestones.best = { day: 3, takings: 640 };
    expect(exhibits(s)).toEqual([
      { letter: "A", what: "A first sale, day 1.", reading: "The Opening Move of a Vast Criminal Enterprise." },
      { letter: "B", what: "A $640 day, day 3.", reading: "Laundering on an Industrial Scale." },
      { letter: "C", what: "A larger coat, day 4.", reading: "Significant Expansion of Distribution Capacity." },
    ]);
  });

  it("describes the supported legacy theory without claiming the player did it", () => {
    const s = newGame(1, "words");
    s.day = 6;
    s.detective.case = { n: 2, place: "docks", habit: "oddJob", announced: 5, places: ["docks"], caught: false };
    expect(currentCaseNotice(s, s.detective.case)).toEqual({
      title: "Operation Winkle",
      meta: "Scheduled at the Docks · days 7–8",
      body: "Pinch’s theory concerned odd jobs at the Docks. Sales and risky jobs face higher stop risk. Pinch refuses bribes.",
    });
  });

  it("dates Mags's forecast and stamps the next price quote before its hour is spent", () => {
    const s = newGame(1, "words");
    s.rng = rngWhere(below(0.7));
    const ask = { type: "askAround" } as const;
    const first = play(s, ask);
    expect(resultLines(first.events, first.state)[0]).toBe("Mags: Rumour for day 2. Fireworks may run short in Old Town.");
    expect(briefs(first.state).at(-1)).toMatchObject({ from: "mags", line: "Rumour for day 2. Fireworks may run short in Old Town." });
    const second = play(first.state, ask);
    expect(second.state.hour).toBe(12);
    expect(resultLines(second.events, second.state)[0]).toMatch(/^Mags: Quote from .+ per unit for .+\. Day 1 at 11:00\. Prices can change\.$/);
  });
});
