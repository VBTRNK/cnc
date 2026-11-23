// Replays the first chapter and prints every Courier edition it reaches, so a change to
// player-facing copy shows up as a readable diff of tests/fixtures/chapter-replay.txt.
// It covers the authored Docks fireworks case and its branches, then four natural
// 30-day runs, with a save round-trip every night. Update with `npm run replay -- -u`
// and review the transcript diff (it caught mass-noun verbs that assertions missed).
import { loadSave, newGame, step, toSave, type Action, type GameState } from "../src/sim/index.ts";
import { atLeast, below, rngWhere } from "../src/sim/testing.ts";
import { castLines, paperView } from "../src/ui/words.ts";
import { Book, decide, POLICIES } from "../scripts/strategy-policy.ts";

const close = { type: "callItADay" } as const;
const morning = { type: "startDay" } as const;
const leave = { type: "resolveCard", choice: "leave" } as const;
const pay = { type: "resolveCard", choice: "feed" } as const;
const surrender = { type: "resolveStop", choice: "handOver" } as const;
const legIt = { type: "resolveStop", choice: "legIt" } as const;
const job = { type: "pullJob" } as const;
const tapes = { type: "sell", good: "tapes", units: 1 } as const;

const out: string[] = [];
const log = (line: string) => { out.push(line); };
let actions = 0;
let reloads = 0;

class Play {
  state: GameState;
  constructor(state: GameState) { this.state = state; }
  run(a: Action) {
    const r = step(this.state, a);
    actions++;
    if (r.ok) this.state = r.state;
    return r;
  }
  play(...as: Action[]) {
    for (const a of as) {
      const r = this.run(a);
      if (!r.ok) throw new Error(`${JSON.stringify(a)} refused: ${JSON.stringify(r)}`);
    }
    return this;
  }
  edit(f: (s: GameState) => void) {
    this.state = structuredClone(this.state);
    f(this.state);
    return this;
  }
  reload() {
    const r = loadSave(toSave(this.state));
    if (!r.ok) throw new Error(`reload failed: ${JSON.stringify(r)}`);
    expect(r.state).toEqual(this.state);
    reloads++;
    this.state = r.state;
    return this;
  }
  paper(label: string) {
    const p = this.state.paper;
    if (!p) { log(`  [${label}] no paper`); return this; }
    const v = paperView(p, this.state.milestones.cases);
    log(`  [${label}] day ${p.day} · HEAD ${v.head}`);
    log(`      story: ${v.story}`);
    for (const n of v.required) log(`      required: ${JSON.stringify(n)}`);
    for (const b of v.briefs) log(`      brief: ${b}`);
    return this;
  }
}

function docksNight() {
  return new Play(newGame(42, "s7-docks")).edit((s) => {
    s.day = 5; s.events = []; s.milestones.firsts.sale = 1;
    s.held.fireworks = 1; s.paid.fireworks = 85; s.rng = rngWhere(atLeast(0.5));
  }).play({ type: "sell", good: "fireworks", units: 1 }, close).reload();
}
const docks = () => docksNight().play(morning).reload();
const last = (p: Play) => p.state.milestones.cases.at(-1);
const caseLine = (p: Play) => {
  const c = p.state.detective.case;
  return JSON.stringify({ open: c && { n: c.n, habit: c.habit, place: c.place, places: c.places }, last: last(p) ?? null });
};
const night = (p: Play, label: string) => {
  if (p.state.phase === "day") p.play(close);
  return p.reload().paper(label);
};
function stopping(...draws: ((x: number) => boolean)[]) {
  return docks().play(leave, close, morning).edit((s) => {
    s.held.tapes = 2; s.paid.tapes = 20; s.rng = rngWhere(below(0.001), ...draws);
  });
}

function docksFixture() {
  log("## Authored Docks fireworks fixture (seed 42, day-5 fireworks sale)");
  const d = docksNight().paper("announcement night");
  log(`opening case: ${caseLine(d)}`);
  d.play(morning);
  log(`morning pending: ${JSON.stringify(d.state.pending)}`);

  log("\n### Leave Lenny's offer, case goes cold");
  const cold = docks().play(leave);
  night(cold, "warning day");
  cold.play(morning, { type: "oddJob" });
  night(cold, "op day 1");
  cold.play(morning);
  night(cold, "op day 2");
  expect(last(cold)?.outcome).toBe("cold");
  log(`  ${caseLine(cold)}`);

  log("\n### Pay Lenny short of cash (unaffordable)");
  const short = docks().edit((s) => { s.cash = 149; });
  const refused = short.run(pay);
  log(`  ${JSON.stringify(refused)}`);
  expect(refused.ok).toBe(false);

  log("\n### Pay Lenny, Pinch keeps the place");
  const kept = docks().edit((s) => { s.rng = rngWhere(atLeast(0.9)); }).play(pay);
  night(kept, "paid, kept");
  log(`  ${caseLine(kept)}`);

  log("\n### Pay Lenny, case moves");
  const moved = docks().edit((s) => { s.events = []; s.rng = rngWhere(below(0.5), below(0.3)); }).play(pay);
  night(moved, "paid, moved");
  expect(moved.state.detective.case?.places).toEqual(["oldtown"]);
  log(`  ${caseLine(moved)}`);

  log("\n### Stop in the operation, hand over (closed by handover, no arrest)");
  const handed = stopping().play(tapes).reload().play(surrender).reload();
  night(handed, "after handover");
  log(`  ${caseLine(handed)}`);
  expect(last(handed)?.outcome).toBe("closed");
  expect(last(handed)?.evidence?.handover).toBeTruthy();
  expect(last(handed)?.evidence?.arrest).toBeFalsy();

  log("\n### Stop in the operation, leg it (escape draw, then fail draw)");
  for (const draw of [below(0.05), atLeast(0.99)]) {
    const p = stopping(draw).play(tapes).reload().play(legIt).reload();
    if (p.state.pending?.kind === "stop") p.play(surrender);
    night(p, "leg it");
    log(`  ${caseLine(p)} · arrested today ${p.state.news.at(-1)?.log.arrested ?? "?"}`);
  }

  log("\n### Job in the operation, four draws, hand over if stopped");
  for (const draw of [below(0.15), (x: number) => x >= 0.68 && x < 0.7, (x: number) => x >= 0.84 && x < 0.87, atLeast(0.97)]) {
    const p = stopping(draw).play(job).reload();
    if (p.state.pending?.kind === "stop") p.play(surrender);
    night(p, "job");
    log(`  ${caseLine(p)}`);
  }
}

const STORY = /Pinch|Operation|Inspector|Crown|Reg|Lenny|Nicked|Dougie/i;

function naturalRun(name: string, seed: number) {
  log(`\n### ${name} seed ${seed}`);
  const policy = POLICIES[name];
  if (!policy) throw new Error(`no policy ${name}`);
  const p = new Play(newGame(seed, `${name}-${seed}`));
  const book = new Book();
  const queue: Action[] = [];
  let attempts = 0, crownDay = 0, lastPaper = 0;
  while (p.state.day < 30 || p.state.phase !== "night") {
    if (++attempts > 30 * 200) throw new Error(`${name} ${seed} did not finish`);
    const before = p.state;
    const res = p.run(decide(before, policy, book, queue));
    if (!res.ok) { queue.length = 0; continue; }
    for (const e of res.events) book.record(e, e.type === "bought" || e.type === "sold" ? before.place : p.state.place);
    if (!crownDay && p.state.upgrades.includes("crown")) crownDay = p.state.day;
    if (p.state.phase === "night") p.reload();
    const paper = p.state.paper;
    if (paper && paper.day !== lastPaper) {
      lastPaper = paper.day;
      const v = paperView(paper, p.state.milestones.cases);
      if (STORY.test(v.head + v.story + JSON.stringify(v.required) + v.briefs.join(" "))) p.paper(name);
    }
  }
  log(`  end: day ${p.state.day} cash $${p.state.cash} crown ${crownDay || "no"} promoted ${p.state.detective.promoted}`);
  log(`  cases: ${JSON.stringify(p.state.milestones.cases.map((c) => [c.n, c.habit, c.place, c.outcome, c.day, Object.keys(c.evidence ?? {})]))}`);
  log(`  cast: ${JSON.stringify(castLines(p.state))}`);
}

test("the first chapter replays to the committed Courier transcript", async () => {
  docksFixture();
  log("\n## Natural seeds, 30 days, reload every night");
  for (const [name, seed] of [["trader", 15838], ["dailyJob", 15838], ["oddJobsOnly", 7919], ["handOver", 7919]] as const) {
    naturalRun(name, seed);
  }
  log(`\n${actions} actions, ${reloads} save round-trips.`);
  await expect(out.join("\n") + "\n").toMatchFileSnapshot("./fixtures/chapter-replay.txt");
}, 120_000);
