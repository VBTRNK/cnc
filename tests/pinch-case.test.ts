import { loadSave, newGame, quoteJob, toSave, type GameState } from "../src/sim/index.ts";
import { atLeast, below, play, rngWhere } from "../src/sim/testing.ts";
import { archivedCase, caseResult, currentCaseNotice, observation, resolvedCaseNotice } from "../src/ui/caseWords.ts";
import { paperView, resultLines } from "../src/ui/words.ts";

const night = { type: "callItADay" } as const;
const morning = { type: "startDay" } as const;
const leave = { type: "resolveCard", choice: "leave" } as const;
const pay = { type: "resolveCard", choice: "feed" } as const;
const surrender = { type: "resolveStop", choice: "handOver" } as const;
const legIt = { type: "resolveStop", choice: "legIt" } as const;
const sell = { type: "sell", good: "tapes", units: 1 } as const;
const job = { type: "pullJob" } as const;

function start() {
  const s = newGame(42, "s2");
  s.day = 5;
  s.events = [];
  s.milestones.firsts.sale = 1;
  return s;
}

function fireworks() {
  const s = start();
  s.held.fireworks = 1;
  s.paid.fireworks = 85;
  s.rng = rngWhere(atLeast(0.5));
  return play(s, { type: "sell", good: "fireworks", units: 1 }, night).state;
}

function reload(s: GameState, version?: number) {
  const text = toSave(s);
  const parsed = loadSave(version ? JSON.stringify({ ...JSON.parse(text), version }) : text);
  if (!parsed.ok) throw new Error(parsed.detail);
  expect(parsed.state).toEqual(s);
  return parsed.state;
}

function active() {
  const s = play(fireworks(), morning, leave, night, morning).state;
  s.events = [];
  s.held.tapes = 2;
  s.paid.tapes = 20;
  s.cash = 340;
  return s;
}

const file = (s: GameState) => caseResult(s.milestones.cases.at(-1)!);

describe("Operation Kipper through the current rules", () => {
  it("trusts completed action tallies and gives a displaced announcement its whole warning", () => {
    const s = fireworks();
    expect(paperView(s.paper!).story).toContain("You sold fireworks at the Docks. Pinch calls it organised crime.");
    s.paper!.firsts = ["grand"];
    const view = paperView(s.paper!);
    expect(view.required.filter((n) => n.title === "Operation Kipper")).toEqual([{
      title: "Operation Kipper", meta: "Scheduled at the Docks · days 7–8",
      body: "You sold fireworks at the Docks. Pinch calls it organised crime. Sales and risky jobs face higher stop risk. Pinch refuses bribes.",
    }]);
    const worker = play(start(), { type: "oddJob" }, night).state;
    expect(paperView(worker.paper!).story).toContain("You worked odd jobs at the Docks.");
    expect(paperView(worker.paper!).story).toContain("Odd jobs still pay as usual.");
    const cold = play(worker, morning, leave, night, morning, { type: "oddJob" }, night, morning, night).state;
    expect(file(reload(cold))).toBe("Operation Kipper went cold on day 8. It ended without an arrest or seizure in the operation.");
  });

  it("reports skipped, declined, paid-rejected and moved warnings without rewriting an edition", () => {
    const announce = fireworks();
    const short = play({ ...announce, cash: 149 }, morning).state;
    expect(short.pending).toBeNull();
    expect(currentCaseNotice(short, short.detective.case!).meta).toContain("Scheduled at the Docks");
    const warning = play(announce, morning).state;
    const decline = play(warning, leave);
    expect(resultLines(decline.events, decline.state)[0]).toContain("You kept your cash.");
    const reject = play({ ...warning, rng: rngWhere(atLeast(0.9)) }, pay);
    expect(reject.state.cash).toBe(warning.cash - 150);
    expect(resultLines(reject.events, reject.state)[0]).toBe("You paid Lenny $150. Pinch kept Operation Kipper at the Docks on days 7–8.");
    const move = play({ ...warning, events: [], rng: rngWhere(below(0.5), below(0.3)) }, pay);
    const resumed = reload(play(move.state, night, morning).state);
    expect(currentCaseNotice(resumed, resumed.detective.case!)).toMatchObject({
      title: "Operation Kipper", meta: "Underway in Old Town · days 7–8",
      body: expect.stringContaining("Lenny’s story moved the operation from the Docks to Old Town."),
    });
    expect(paperView(resumed.news.find((p) => p.day === 5)!).story).toContain("runs at the Docks");
  });

  it("distinguishes one retained site and an accepted story with no free site", () => {
    const s = active();
    const c = s.detective.case!;
    s.day = 6;
    s.detective.promoted = true;
    c.place = "strip";
    c.places = ["strip", "docks"];
    s.pending = { kind: "card", card: "falseTrailInspector", odds: 55 };
    s.rng = rngWhere(below(0.5));
    const sweep = (place: "oldtown" | "uptown") => ({ id: place, kind: "sweep" as const, place,
      activated: false, startDay: 7, startHour: 16, endDay: 8, slot: "midday" as const });
    s.events = [sweep("oldtown")];
    s.detective.seen.strip = { tapes: 9 };
    const moved = play(s, pay);
    expect(resultLines(moved.events, moved.state)[0]).toContain("moved from the Strip to Uptown. The Docks stays on the list.");
    s.events.push(sweep("uptown"));
    const stayed = play(s, pay);
    expect(stayed.state.detective.case?.trail).toBeUndefined();
    expect(resultLines(stayed.events, stayed.state)[0]).toBe("You paid Lenny $300. Operation Kipper stayed on the Strip and at the Docks on days 7–8.");
  });

  it("keeps the move and the actual handover in the latest resolution after its edition is gone", () => {
    const offer = play(fireworks(), morning).state;
    offer.events = [];
    offer.rng = rngWhere(below(0.5), below(0.3));
    const s = play(offer, pay, night, morning, { type: "travel", to: "oldtown" }).state;
    s.held.tapes = 2;
    s.rng = rngWhere(below(0.001));
    const closed = play(s, sell, surrender, night).state;
    const result = "Lenny’s story moved the operation from the Docks to Old Town. You handed over 2 tapes in Old Town. The sale was cancelled.";
    expect(paperView(closed.paper!).story).toBe(`Operation Kipper closed on day 7. ${result}`);
    const resumed = reload({ ...play(closed, morning).state, news: [] });
    expect(resolvedCaseNotice(resumed.milestones.cases.at(-1)!)).toMatchObject({
      title: "Operation Kipper",
      meta: "Closed · day 7",
      body: expect.stringContaining(result),
    });
  });

  it("saves the full handover, sale cancellation and in-operation failed escape separately", () => {
    const s = active();
    s.rng = rngWhere(below(0.001), atLeast(0.9));
    const stop = reload(play(s, sell).state);
    const handed = reload(play(stop, surrender).state);
    const closed = reload(play(handed, night).state);
    expect(file(closed)).toBe("Operation Kipper closed on day 7. You handed over 2 tapes at the Docks. The sale was cancelled.");
    expect(paperView(closed.paper!).story).toBe(file(closed));
    const arrest = reload(play(stop, legIt).state);
    expect(file(arrest)).toContain("Pinch stopped you at the Docks. You tried to run and were arrested. The police took 2 tapes and fined you $51.");
    expect(paperView(arrest.paper!).story).toBe(file(arrest));
    expect(paperView(arrest.paper!).required.some((n) => n.title.includes("Kipper"))).toBe(false);
    expect(play(arrest, morning).state.hour).toBe(14);
  });

  it("records all four results on a job that continued after handover", () => {
    const phrases = [
      "The job went ahead and paid $",
      "The job went ahead and came to nothing.",
      "You were hurt on the job.",
      "The job went ahead and ended in arrest.",
    ];
    const s = active();
    const q = quoteJob(s);
    if (typeof q === "string") throw new Error(q);
    const chance = q.success / 100;
    const boundaries = [0, chance, chance + (1 - chance) / 2, chance + 0.75 * (1 - chance), 1];
    for (const [i, phrase] of phrases.entries()) {
      s.rng = rngWhere(below(0.001), (x) => x >= boundaries[i]! && x < boundaries[i + 1]!);
      const stop = reload(play(s, job).state);
      const done = play(stop, surrender).state;
      const closed = done.phase === "day" ? play(done, night).state : done;
      expect(file(reload(closed))).toContain(phrase);
      expect(file(closed)).toContain("You handed over 2 tapes");
      if (i === 3) expect(file(closed)).toContain("The police fined you $51.");
    }
  });

  it("assigns an empty-pocket or escaped stop's job arrest to the job, and tracks later arrests only at live sites", () => {
    const s = active();
    const empty = { ...s, held: { ...s.held, tapes: 0 }, paid: { ...s.paid, tapes: 0 }, rng: rngWhere(below(0.001), atLeast(0.97)) };
    const patted = play(empty, job);
    expect(resultLines(patted.events, patted.state)[0]).toContain("Your pockets were empty");
    expect(file(reload(patted.state))).toContain("The risky job at the Docks ended in arrest.");
    const escaped = play({ ...s, rng: rngWhere(below(0.001), below(0.1), atLeast(0.97)) }, job, legIt).state;
    expect(file(escaped)).toContain("The risky job at the Docks ended in arrest.");
    expect(file(escaped)).not.toContain("tried to run");

    const afterSale = play({ ...s, rng: rngWhere(below(0.001)) }, sell, surrender).state;
    const arrestee = { ...afterSale, rng: rngWhere(atLeast(0.9), atLeast(0.97)) };
    expect(file(play(arrestee, job).state)).toContain("A later risky job at the Docks ended in arrest.");
    const elsewhere = play({ ...arrestee, place: "oldtown" }, job).state;
    expect(file(elsewhere)).not.toContain("arrest");
    expect(paperView(elsewhere.paper!).head).toBe("Nicked!");
    expect(paperView(elsewhere.paper!).required.some((n) => n.body === file(elsewhere))).toBe(true);
  });

  it("reports a later failed escape at the same operation using each incident's goods", () => {
    const s = { ...active(), rng: rngWhere(below(0.001)) };
    const handed = play(s, sell, surrender, { type: "buy", good: "smokes", units: 1 }).state;
    const arrested = play({ ...handed, rng: rngWhere(below(0.001), atLeast(0.9)) },
      { type: "sell", good: "smokes", units: 1 }, legIt).state;
    expect(file(reload(arrested))).toContain("You handed over 2 tapes at the Docks. The sale was cancelled. Pinch stopped you again at the Docks.");
    expect(file(arrested)).toContain("The police took 1 carton of smokes and fined you");
    expect(arrested.paper!.log.seized).toBe(3);
  });

  it("uses a matching edition for earlier archive evidence after a later case supersedes it", () => {
    const s = active();
    s.rng = rngWhere(below(0.001));
    const latest = play(s, sell, surrender, night).state;
    const own = latest.milestones.cases.at(-1)!;
    const summary = { ...own };
    delete summary.evidence;
    expect(caseResult(archivedCase(latest, summary))).toBe(caseResult(own));
    expect(archivedCase(latest, { ...summary, n: 999 }).evidence).toBeUndefined();
    expect(caseResult(archivedCase({ ...latest, news: [] }, summary))).toBe("Operation Kipper closed on day 7.");
    expect(caseResult(archivedCase({ ...latest, news: [] }, own))).toContain("2 tapes");
  });

  it("keeps a v4 warning, printed sites and stamp without inventing the move or handover", () => {
    const s = active();
    for (const p of s.news) {
      if (p.case) delete p.case.observed;
      for (const i of p.pinch) if ("case" in i) delete i.case.observed;
    }
    delete s.detective.case!.observed;
    expect(observation(s.detective.case!).head).toBe("Pinch opens a case at the Docks");
    expect(observation({ ...s.detective.case!, place: "strip" }).head).toBe("Pinch opens a case on the Strip");
    s.detective.case!.places = ["oldtown"];
    const recap = currentCaseNotice(reload(s, 4), s.detective.case!);
    expect(recap.body).toContain("Pinch’s theory concerned fireworks at the Docks. Earlier warning covered the Docks.");
    expect(recap.body).not.toContain("Lenny");
    s.detective.case!.caught = true;
    expect(file(play(reload(s, 4), night).state)).toBe("Operation Kipper closed on day 7.");
  });
});
