// Compare the same action and RNG position against a stock checkout at each step.
// Pass the directory containing the stock checkout's src/sim and src/game.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as current from "../src/sim/index.ts";
import { atLeast, below, rngWhere } from "../src/sim/testing.ts";
import { keysFor, memoryStorage } from "../src/game/store.ts";
import { paperView } from "../src/ui/words.ts";
import { Book, decide, POLICIES } from "./strategy-policy.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Pass the stock checkout or extracted git archive directory");
const stock: typeof current = await import(pathToFileURL(resolve(directory, "src/sim/index.ts")).href);
const oldStore: typeof import("../src/game/store.ts") = await import(pathToFileURL(resolve(directory, "src/game/store.ts")).href);
const oldCloud: typeof import("../src/game/cloudSaves.ts") = await import(pathToFileURL(resolve(directory, "src/game/cloudSaves.ts")).href);
let matched = 0;

function rulesOnly(value: unknown): string {
  return JSON.stringify(value, function (key, item: unknown) {
    if ((["observed", "trail", "evidence"].includes(key) && this.n !== undefined && this.habit !== undefined) ||
        (key === "operation" && this.type === "pattedDown")) return undefined;
    return item;
  });
}

class Replay {
  private previous: current.GameState;
  state: current.GameState;

  constructor(state: current.GameState) {
    this.previous = structuredClone(state);
    this.state = structuredClone(state);
  }

  run(action: current.Action) {
    const old = stock.step(this.previous, action);
    const next = current.step(this.state, action);
    assert.equal(rulesOnly(next), rulesOnly(old), `day ${this.state.day}, ${JSON.stringify(action)}`);
    matched++;
    if (next.ok && old.ok) {
      this.previous = old.state;
      this.state = next.state;
    }
    return next;
  }

  play(...actions: current.Action[]) {
    for (const action of actions) assert(this.run(action).ok, JSON.stringify(action));
    return this;
  }

  edit(change: (s: current.GameState) => void) {
    change(this.previous);
    change(this.state);
    return this;
  }

  reload() {
    const text = stock.toSave(this.previous);
    const before = stock.loadSave(text);
    const migrated = current.loadSave(text);
    const retained = current.loadSave(current.toSave(this.state));
    assert(before.ok && migrated.ok && retained.ok);
    assert.equal(migrated.migratedFrom, 4);
    assert.deepEqual(migrated.state, before.state);
    assert.deepEqual(retained.state, this.state);
    assert.deepEqual(stock.loadSave(current.toSave(this.state)), { ok: false, error: "future", detail: "version 5", version: 5 });

    const storage = memoryStorage();
    const saved = current.toSave(this.state);
    const keys = keysFor("s2");
    storage.setItem(keys.save, saved);
    storage.setItem(keys.backup, text);
    const rollback = oldStore.webStore(() => storage, { prefix: "s2" });
    assert.deepEqual(rollback.open(), { kind: "future", version: 5 });
    assert.deepEqual(rollback.write(before.state), { ok: false, reason: "blocked" });
    assert.equal(storage.getItem(keys.save), saved);
    assert.equal(storage.getItem(keys.backup), text);
    this.previous = before.state;
    this.state = retained.state;
    return this;
  }
}

const close = { type: "callItADay" } as const;
const morning = { type: "startDay" } as const;
const leave = { type: "resolveCard", choice: "leave" } as const;
const pay = { type: "resolveCard", choice: "feed" } as const;
const surrender = { type: "resolveStop", choice: "handOver" } as const;
const run = { type: "resolveStop", choice: "legIt" } as const;
const job = { type: "pullJob" } as const;
const tapes = { type: "sell", good: "tapes", units: 1 } as const;

function docks() {
  return new Replay(stock.newGame(42, "s2-docks")).edit((s) => {
    s.day = 5;
    s.events = [];
    s.milestones.firsts.sale = 1;
    s.held.fireworks = 1;
    s.paid.fireworks = 85;
    s.rng = rngWhere(atLeast(0.5));
  }).play({ type: "sell", good: "fireworks", units: 1 }, close, morning).reload();
}

const cold = docks().play(leave, close, morning, { type: "oddJob" }, close, morning, close);
assert.equal(cold.state.milestones.cases.at(-1)?.outcome, "cold");
docks().edit((s) => { s.cash = 149; }).run(pay);
docks().edit((s) => { s.rng = rngWhere(atLeast(0.9)); }).play(pay, close, morning).reload();
const moved = docks().edit((s) => {
  s.events = [];
  s.rng = rngWhere(below(0.5), below(0.3));
}).play(pay, close, morning).reload();
assert.deepEqual(moved.state.detective.case?.places, ["oldtown"]);

function stopping(...draws: ((x: number) => boolean)[]) {
  return docks().play(leave, close, morning).edit((s) => {
    s.held.tapes = 2;
    s.paid.tapes = 20;
    s.rng = rngWhere(below(0.001), ...draws);
  });
}

stopping().play(tapes).reload().play(surrender).reload().play(close).reload();
stopping(atLeast(0.9)).play(tapes).reload().play(run).reload();
for (const draw of [below(0.15), (x: number) => x >= 0.68 && x < 0.7, (x: number) => x >= 0.84 && x < 0.87, atLeast(0.97)]) {
  stopping(draw).play(job).reload().play(surrender);
}
stopping(atLeast(0.97)).edit((s) => { s.held.tapes = 0; s.paid.tapes = 0; }).play(job);
stopping(below(0.2), atLeast(0.97)).play(job, run);
stopping().play(tapes, surrender).edit((s) => { s.rng = rngWhere(atLeast(0.9), atLeast(0.97)); }).play(job);

// Feed the exact same decisions, including pending cards, to both simulations.
for (const [policy, seed, days] of [["trader", 15838, 23], ["passCards", 7919, 30], ["dailyJob", 15838, 30], ["handOver", 7919, 30]] as const) {
  const p = new Replay(stock.newGame(seed, `${policy}-${seed}`));
  const book = new Book();
  const queue: current.Action[] = [];
  let attempts = 0;
  while (p.state.day < days || p.state.phase !== "night") {
    assert(++attempts < days * 200);
    const before = p.state;
    const selected = policy === "passCards" ? { ...POLICIES.oddJobsOnly!, cards: "pass" as const } : POLICIES[policy]!;
    const result = p.run(decide(before, selected, book, queue));
    if (result.ok) {
      for (const e of result.events) book.record(e, e.type === "bought" || e.type === "sold" ? before.place : p.state.place);
      const paper = p.state.paper;
      if (policy === "trader" && paper?.day === 3) {
        const view = paperView(paper);
        assert.equal(view.head, "A grand in the hand");
        assert(view.required.some((n) => n.title === "New on the beat"));
      }
      if (policy === "trader" && paper?.day === 20) {
        const view = paperView(paper);
        assert.equal(view.head, "Nicked on the Strip");
        assert.match(view.story, /Operation Teapot closed.*3 tapes and fined you \$123/);
        assert(view.required.some((n) => n.title === "Pinch made Inspector"));
        assert(!view.required.some((n) => n.title.includes("Teapot")));
      }
    } else queue.length = 0;
  }
}

const code = "7KQFM2XD9HPAT4WN";
const disk = memoryStorage();
disk.setItem(oldCloud.CODE_KEY, code);
let writes = 0;
const oldOptions: ConstructorParameters<typeof oldCloud.CloudSaves>[0] = {
  storage: () => disk, writer: true,
  makeSeed: () => 42, makeId: () => "v4-rollback", makeUuid: () => "v4-upload", random: (n) => new Uint8Array(n),
  cloud: {
    async fetch() { return { ok: true, row: {
      revision: 2, uploadId: "from-v5", text: current.toSave(moved.state), formatVersion: 5, updatedAt: "2026-11-22T12:00:00Z",
    } }; },
    async put() { writes++; return { ok: true, outcome: "conflict", revision: 2 }; },
  },
};
const oldDevice = new oldCloud.CloudSaves(oldOptions);
await oldDevice.start();
assert.deepEqual(oldDevice.getSnapshot().sync, { kind: "failed", reason: "future", at: null });
const freshOldDevice = new oldCloud.CloudSaves({ ...oldOptions, storage: memoryStorage });
assert.equal(await freshOldDevice.use(code), "future");
assert.equal(writes, 0);

console.log(`${matched} matched actions with identical rules, outcomes, refusals and RNG. Stock v4 and current v5 resume and rollback checks passed for local and cloud saves.`);
