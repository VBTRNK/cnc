// The S5 gates for the local save: resume without rerolls, resume of a pending choice,
// old, future and corrupt saves, local write failure, and the read-only second tab.

import { SAVE_FORMAT, SAVE_VERSION, newGame, step, toSave, type GameState } from "../sim/index.ts";
import { below, play, rngWhere } from "../sim/testing.ts";
import { GameSession } from "./session.ts";
import { KEYS, memoryStorage, webStore, type StorageLike, type StoreOptions } from "./store.ts";

let ids = 0;
const options = (writer = true) => ({ writer, makeSeed: () => 7, makeId: () => `run-${++ids}` });
const open = (storage: StorageLike, writer = true, storeOptions: StoreOptions = {}) =>
  new GameSession(webStore(() => storage, storeOptions), options(writer));
const stateOf = (session: GameSession): GameState => {
  const s = session.getSnapshot().state;
  if (!s) throw new Error("no state");
  return s;
};

/** Storage whose writes fail while `full` is set. */
function flakyStorage(): StorageLike & { full: boolean } {
  const inner = memoryStorage();
  return {
    full: false,
    getItem: (k) => inner.getItem(k),
    removeItem: (k) => inner.removeItem(k),
    setItem(k, v) {
      if (this.full) throw new DOMException("full", "QuotaExceededError");
      inner.setItem(k, v);
    },
  };
}

describe("the local save", () => {
  it("starts a fresh run and saves it at once", () => {
    const storage = memoryStorage();
    const session = open(storage);
    const s = stateOf(session);
    expect(s.day).toBe(1);
    expect(storage.getItem(KEYS.save)).toBe(toSave(s));
    expect(storage.getItem(KEYS.backup)).toBe(toSave(s));
    expect(session.getSnapshot().save).toBe("saved");
  });

  it("saves after every action and resumes without rerolls", () => {
    const storage = memoryStorage();
    const a = open(storage);
    a.dispatch({ type: "buy", good: "smokes", units: 10 });
    a.dispatch({ type: "travel", to: "strip" });
    a.dispatch({ type: "sell", good: "smokes", units: 10 });
    expect(storage.getItem(KEYS.save)).toBe(toSave(stateOf(a)));

    const b = open(storage);
    expect(stateOf(b)).toEqual(stateOf(a));
    // The same next action draws the same numbers in both: nothing was rerolled.
    a.dispatch({ type: "pullJob" });
    b.dispatch({ type: "pullJob" });
    expect(stateOf(b)).toEqual(stateOf(a));
    expect(b.getSnapshot().events).toEqual(a.getSnapshot().events);
  });

  it("resumes a pending stop, which still blocks and still resolves", () => {
    const start = play(newGame(1, "stopped"), { type: "buy", good: "smokes", units: 5 }).state;
    const r = step({ ...start, rng: rngWhere(below(0.01)) }, { type: "pullJob" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.pending).not.toBeNull();
    const storage = memoryStorage();
    webStore(() => storage).write(r.state);

    const session = open(storage);
    expect(stateOf(session).pending).toEqual(r.state.pending);
    expect(session.dispatch({ type: "travel", to: "strip" })).toBe(false);
    expect(session.getSnapshot().refusal).toBe("pending");
    expect(session.dispatch({ type: "resolveStop", choice: "handOver" })).toBe(true);
    expect(stateOf(session).pending).toBeNull();
    expect(stateOf(session).held.smokes).toBe(0);
  });

  it("migrates an old save and keeps the original", () => {
    const storage = memoryStorage();
    const original = toSave(newGame(3, "old"));
    storage.setItem(KEYS.save, original);
    const migrations = { [SAVE_VERSION]: (doc: Record<string, unknown>) => ({ ...doc }) };
    const session = open(storage, true, { migrations, current: SAVE_VERSION + 1 });
    expect(stateOf(session).runId).toBe("old");
    expect(storage.getItem(KEYS.kept)).toBe(original);
  });

  it("refuses a save from a newer version and never overwrites it", () => {
    const storage = memoryStorage();
    const future = JSON.stringify({ format: SAVE_FORMAT, version: 99, state: { whatever: true } });
    storage.setItem(KEYS.save, future);
    const session = open(storage);
    expect(session.getSnapshot().mode).toBe("future");
    expect(session.dispatch({ type: "callItADay" })).toBe(false);
    session.newRun();
    expect(storage.getItem(KEYS.save)).toBe(future);
    expect(session.exportText()).toBe(future);
  });

  it("falls back to the backup copy when the save is corrupt, and shows it", () => {
    const storage = memoryStorage();
    const a = open(storage);
    a.dispatch({ type: "buy", good: "tapes", units: 3 });
    storage.setItem(KEYS.save, "{not json");

    const b = open(storage);
    expect(stateOf(b)).toEqual(stateOf(a));
    expect(b.getSnapshot().notice).toBe("recovered");
    expect(storage.getItem(KEYS.kept)).toBe("{not json");
    expect(storage.getItem(KEYS.save)).toBe(toSave(stateOf(a)));
  });

  it("starts over when nothing can be read, keeping the damaged save", () => {
    const storage = memoryStorage();
    storage.setItem(KEYS.save, "{not json");
    storage.setItem(KEYS.backup, JSON.stringify({ format: SAVE_FORMAT, version: 1, state: { day: -1 } }));
    const session = open(storage);
    expect(session.getSnapshot().notice).toBe("lost");
    expect(stateOf(session).day).toBe(1);
    expect(session.keptText()).toBe("{not json");
  });

  it("reports a failed write, keeps playing, and recovers when writing works again", () => {
    const storage = flakyStorage();
    const session = open(storage);
    storage.full = true;
    expect(session.dispatch({ type: "buy", good: "smokes", units: 2 })).toBe(true);
    expect(session.getSnapshot().save).toBe("full");
    expect(stateOf(session).held.smokes).toBe(2);
    storage.full = false;
    session.dispatch({ type: "buy", good: "smokes", units: 1 });
    expect(session.getSnapshot().save).toBe("saved");
    expect(storage.getItem(KEYS.save)).toBe(toSave(stateOf(session)));
  });

  it("plays without storage when the browser refuses it, and can still export", () => {
    const session = new GameSession(
      webStore(() => {
        throw new DOMException("denied", "SecurityError");
      }),
      options(),
    );
    expect(session.getSnapshot().save).toBe("off");
    expect(session.dispatch({ type: "lieLow" })).toBe(true);
    expect(session.exportText()).toBe(toSave(stateOf(session)));
  });
});

describe("a second tab", () => {
  it("only watches, follows the writing tab, and takes over when it closes", () => {
    const storage = memoryStorage();
    const writer = open(storage);
    const watcher = open(storage, false);
    expect(watcher.getSnapshot().mode).toBe("watch");
    const before = storage.getItem(KEYS.save);
    expect(watcher.dispatch({ type: "lieLow" })).toBe(false);
    expect(storage.getItem(KEYS.save)).toBe(before);

    writer.dispatch({ type: "oddJob" });
    watcher.follow();
    expect(stateOf(watcher)).toEqual(stateOf(writer));

    watcher.takeOver();
    expect(watcher.getSnapshot().mode).toBe("play");
    expect(watcher.dispatch({ type: "lieLow" })).toBe(true);
  });
});

describe("export and import", () => {
  it("imports a save after checking it, keeping the replaced run", () => {
    const storage = memoryStorage();
    const session = open(storage);
    session.dispatch({ type: "buy", good: "watches", units: 1 });
    const mine = storage.getItem(KEYS.save);
    const other = play(newGame(9, "other"), { type: "callItADay" }, { type: "startDay" }).state;

    const read = session.readImport(toSave(other));
    if (!read.ok) throw new Error(read.error);
    session.replace(read.state, "imported");
    expect(stateOf(session).runId).toBe("other");
    expect(storage.getItem(KEYS.replaced)).toBe(mine);
    expect(storage.getItem(KEYS.save)).toBe(toSave(other));
  });

  it("refuses files that aren't saves, newer saves and damaged saves", () => {
    const session = open(memoryStorage());
    expect(session.readImport("hello")).toEqual({ ok: false, error: "notSave" });
    expect(session.readImport(JSON.stringify({ format: SAVE_FORMAT, version: 99, state: {} }))).toEqual({
      ok: false,
      error: "future",
    });
    expect(session.readImport(JSON.stringify({ format: SAVE_FORMAT, version: 1, state: {} }))).toEqual({
      ok: false,
      error: "damaged",
    });
    expect(session.readImport("x".repeat(1_000_001))).toEqual({ ok: false, error: "tooBig" });
  });

  it("starts a new run with a new identity, keeping the old one", () => {
    const storage = memoryStorage();
    const session = open(storage);
    const first = stateOf(session).runId;
    session.dispatch({ type: "oddJob" });
    const old = storage.getItem(KEYS.save);
    session.newRun();
    expect(stateOf(session).runId).not.toBe(first);
    expect(stateOf(session).day).toBe(1);
    expect(storage.getItem(KEYS.replaced)).toBe(old);
  });
});

describe("a write only half done (reviews 2 and 3: F4, H2)", () => {
  /** Storage whose writes to keys matching `failing` fail. */
  function keyed(): StorageLike & { failing: RegExp | null } {
    const inner = memoryStorage();
    return {
      failing: null,
      getItem: (k) => inner.getItem(k),
      removeItem: (k) => inner.removeItem(k),
      setItem(k, v) {
        if (this.failing?.test(k)) throw new DOMException("full", "QuotaExceededError");
        inner.setItem(k, v);
      },
    };
  }

  it("reports failure and keeps the old run, also after a reload, when the save itself can't be written", () => {
    const storage = keyed();
    const session = open(storage);
    session.dispatch({ type: "askAround" });
    const old = stateOf(session);

    storage.failing = /\.save$/;
    expect(session.replace(newGame(9, "other-run"), "imported")).toBe(false);
    expect(stateOf(session)).toEqual(old);
    storage.failing = null;
    expect(stateOf(open(storage))).toEqual(old);
    expect(storage.getItem(KEYS.backup)).toBe(toSave(old));
  });

  it("counts a replacement as done once the save is written, though the backup copy failed", () => {
    const storage = keyed();
    const session = open(storage);
    const other = newGame(9, "other-run");

    storage.failing = /\.save\.backup$/;
    expect(session.replace(other, "imported")).toBe(true);
    storage.failing = null;
    expect(stateOf(open(storage))).toEqual(other);
  });

  for (const [what, primary] of [
    ["unreadable", "{broken"],
    ["missing", null],
  ] as const) {
    it(`never loses the only readable copy when the save is ${what} and can't be repaired`, () => {
      const storage = keyed();
      const good = stateOf(open(storage));
      if (primary === null) storage.removeItem(KEYS.save);
      else storage.setItem(KEYS.save, primary);

      storage.failing = /\.save$/;
      const repairing = open(storage);
      expect(stateOf(repairing)).toEqual(good);
      expect(repairing.getSnapshot().save).toBe("full");
      expect(storage.getItem(KEYS.backup)).toBe(toSave(good));

      storage.failing = null;
      const again = open(storage);
      expect(stateOf(again)).toEqual(good);
      expect(again.getSnapshot().notice).toBe("recovered");
    });
  }
});
