import { newGame, type DomainEvent, type GameState } from "../sim/index.ts";
import { play } from "../sim/testing.ts";
import { t } from "./text.ts";
import { briefs, oddsWord, paperView, resultLines } from "./words.ts";

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
    ({ state: s } = play(s, { type: "buy", good: "tapes", units: 8 }, { type: "travel", to: "strip" }));
    const demand = s.market.strip.tapes.demand;
    ({ state: s, events } = play(s, { type: "sell", good: "tapes", units: Math.min(8, demand) }));
    const lines = resultLines(events, s);
    expect(lines[0]).toMatch(/^Sold \d+ tapes? for \$\d+\.$/);
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
    expect(view.briefs).toContain("Tomorrow: fireworks short in Old Town.");
    noPlaceholders([view.head, view.story, ...view.briefs, ...view.chips]);
  });

  it("puts odds into words", () => {
    expect([90, 65, 50, 30, 10].map(oddsWord)).toEqual(["likely", "good", "even", "poor", "long"]);
  });
});
