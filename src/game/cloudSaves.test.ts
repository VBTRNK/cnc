// The S6 gates for cloud saves, against a fake backend with the same write contract as
// `cnc.put_save` (tests/saves-sql.test.ts checks the real one): guest-to-cloud
// reconciliation, switching codes, concurrent and uncertain writes, and that a slot
// never reaches another code's save.

import { SAVE_VERSION, newGame, toSave, type Action, type GameState } from "../sim/index.ts";
import { atLeast, below, play, rngWhere } from "../sim/testing.ts";
import type { CloudApi, CloudRow, FetchResult, PutResult } from "./cloud.ts";
import { CODE_KEY, CloudSaves, sameRun } from "./cloudSaves.ts";
import { GUEST, codeSlot, keysFor, memoryStorage, type StorageLike } from "./store.ts";
import { metaKey, readMeta } from "./sync.ts";

// ---- A fake backend --------------------------------------------------------------

/** A save as `jsonb` stores it: keys ordered by length, then bytewise, at every level. */
function asJsonb(text: string): string {
  const order = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(order)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
              .map((k) => [k, order((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(order(JSON.parse(text)));
}

/**
 * The database: one row per code, written as `cnc.put_save` writes. Revisions come from
 * one sequence, so none repeats, not even under a code whose save was deleted.
 */
class Server {
  rows = new Map<string, CloudRow>();
  writes: { code: string; base: number | null; upload: string; text: string }[] = [];
  /** The base each row's latest upload was sent from. */
  private bases = new Map<string, number | null>();
  private clock = 0;
  private seq = 0;

  put(code: string, base: number | null, upload: string, sent: string): PutResult {
    this.writes.push({ code, base, upload, text: sent });
    // The hosted database keeps the save as jsonb and returns it in jsonb's key order.
    const text = asJsonb(sent);
    const cur = this.rows.get(code);
    const at = `2026-11-18T12:${String(Math.floor(++this.clock / 60)).padStart(2, "0")}:${String(this.clock % 60).padStart(2, "0")}Z`;
    const version = (JSON.parse(text) as { version: number }).version;
    if ((base === null && !cur) || (base !== null && cur?.revision === base && cur.uploadId !== upload)) {
      const row = { revision: ++this.seq, uploadId: upload, text, formatVersion: version, updatedAt: at };
      this.rows.set(code, row);
      this.bases.set(code, base);
      return { ok: true, outcome: "saved", revision: row.revision, updatedAt: at };
    }
    if (cur?.uploadId === upload) {
      if (cur.text !== text || this.bases.get(code) !== base) return { ok: false, reason: "refused" };
      return { ok: true, outcome: "saved", revision: cur.revision, updatedAt: cur.updatedAt };
    }
    return { ok: true, outcome: "conflict", revision: cur?.revision ?? null };
  }

  /** Deletes a code's save, as pruning would. */
  drop(code: string): void {
    this.rows.delete(code);
    this.bases.delete(code);
  }

  /** The run under a code, as the cloud has it. */
  state(code: string): GameState | undefined {
    const row = this.rows.get(code);
    return row ? (JSON.parse(row.text) as { state: GameState }).state : undefined;
  }

  day(code: string): number | undefined {
    const row = this.rows.get(code);
    return row ? (JSON.parse(row.text) as { state: GameState }).state.day : undefined;
  }
}

/** One browser's line to the backend. */
class Client implements CloudApi {
  offline = false;
  /** The next upload lands, but its reply is lost. */
  loseReply = false;
  /** The next upload times out, and lands only when `commitLate` runs. */
  lateCommit = false;
  commitLate: (() => void) | null = null;
  /** Runs as the next upload reaches the server, before it is written. */
  onPut: (() => void) | null = null;
  /** Calls for these codes wait until `release`. */
  readonly held = new Set<string>();
  private waiting: (() => void)[] = [];
  private readonly server: Server;

  constructor(server: Server) {
    this.server = server;
  }

  release(): void {
    this.held.clear();
    for (const go of this.waiting.splice(0)) go();
  }

  private async gate(code: string): Promise<void> {
    if (this.held.has(code)) await new Promise<void>((go) => this.waiting.push(go));
  }

  /** After this many more reads, reads fail. */
  readsLeft = Infinity;

  async fetch(code: string): Promise<FetchResult> {
    await this.gate(code);
    if (this.offline || this.readsLeft-- <= 0) return { ok: false, reason: "network" };
    return { ok: true, row: this.server.rows.get(code) ?? null };
  }

  async put(code: string, base: number | null, upload: string, text: string): Promise<PutResult> {
    await this.gate(code);
    if (this.offline) return { ok: false, reason: "unclear" };
    const hook = this.onPut;
    this.onPut = null;
    hook?.();
    if (this.lateCommit) {
      this.lateCommit = false;
      this.commitLate = () => void this.server.put(code, base, upload, text);
      return { ok: false, reason: "unclear" };
    }
    const r = this.server.put(code, base, upload, text);
    if (this.loseReply) {
      this.loseReply = false;
      return { ok: false, reason: "unclear" };
    }
    return r;
  }
}

/** Storage whose writes (or removals) of matching keys fail while `failing` (`unremovable`) matches. */
function flakyStorage(): StorageLike & { failing: RegExp | null; unremovable: RegExp | null; unreadable: RegExp | null } {
  const inner = memoryStorage();
  return {
    failing: null,
    unremovable: null,
    unreadable: null,
    getItem(k) {
      if (this.unreadable?.test(k)) throw new DOMException("denied", "SecurityError");
      return inner.getItem(k);
    },
    removeItem(k) {
      if (this.unremovable?.test(k)) throw new DOMException("denied", "SecurityError");
      inner.removeItem(k);
    },
    setItem(k, v) {
      if (this.failing?.test(k)) throw new DOMException("full", "QuotaExceededError");
      inner.setItem(k, v);
    },
  };
}

// ---- Devices ---------------------------------------------------------------------

let n = 0;
let codes = 0;

/** A browser with its own storage, client and upload timer; `withCloud` false is a guest-only build. */
function device(server: Server, storage: StorageLike = memoryStorage(), writer = true, withCloud = true) {
  const client = new Client(server);
  const timers: (() => void)[] = [];
  const cloud = new CloudSaves({
    storage: () => storage,
    cloud: withCloud ? client : null,
    writer,
    makeSeed: () => 7,
    makeId: () => `run-${++n}`,
    makeUuid: () => `upload-${++n}`,
    // Each new code differs: its bytes start from a counter.
    random: (count) => Uint8Array.from({ length: count }, (_, i) => (i === 0 ? ++codes : 0)),
    timer: (fn) => {
      timers.push(fn);
      return () => timers.splice(timers.indexOf(fn), 1);
    },
  });
  const snap = () => cloud.getSnapshot();
  const state = () => {
    const s = snap().session.getSnapshot().state;
    if (!s) throw new Error("no state");
    return s;
  };
  const act = (...actions: Action[]) => {
    for (const a of actions) if (!snap().session.dispatch(a)) throw new Error(`refused ${a.type}`);
  };
  /** Runs the pending timers (uploads, waits) without waiting for what they start. */
  const fire = () => {
    for (const fn of timers.splice(0)) fn();
  };
  /** Runs the upload timer, then waits for the sync to settle. */
  const settle = async () => {
    fire();
    await cloud.idle();
  };
  const keep = async () => {
    expect(cloud.keep()).toBeNull();
    await cloud.idle();
    return snap().code!;
  };
  const use = async (code: string) => {
    const r = await cloud.use(code);
    await cloud.idle();
    return r;
  };
  return { cloud, client, storage, snap, state, act, fire, settle, keep, use };
}

/** A move that changes the day, so the guest game is no longer untouched. */
const NEXT_DAY: Action[] = [{ type: "callItADay" }, { type: "startDay" }];

/** A run at day `day` kept under `code`, as another device would have uploaded it. */
function seedCloud(server: Server, code: string, day: number, runId = "cloud-run") {
  const s: GameState = { ...device(server).state(), runId, day };
  return server.put(code, server.rows.get(code)?.revision ?? null, `seed-${++n}`, toSave(s));
}
const CODE = "7KQFM2XD9HPAT4WN";

// ---- Gates -----------------------------------------------------------------------

describe("keeping a run in the cloud", () => {
  it("moves the guest run under a new code and uploads it", async () => {
    const server = new Server();
    const d = device(server);
    d.act(...NEXT_DAY);
    const runId = d.state().runId;

    const code = await d.keep();

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(d.state().runId).toBe(runId);
    expect(server.day(code)).toBe(2);
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
    // The guest slot is empty; its run is kept only as the recovery copy.
    expect(d.storage.getItem(keysFor(GUEST).save)).toBeNull();
    expect(d.storage.getItem(keysFor(GUEST).replaced)).not.toBeNull();
  });

  it("keeps the code and sends the run later when the cloud can't be reached", async () => {
    const server = new Server();
    const d = device(server);
    d.client.offline = true;
    const code = await d.keep();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "offline" });

    d.client.offline = false;
    d.cloud.wake();
    await d.cloud.idle();
    expect(server.rows.get(code)?.revision).toBe(1);
  });
});

describe("using a code", () => {
  it("plays the code's run over an untouched guest game, uploading nothing", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    const writes = server.writes.length;
    const d = device(server);

    expect(await d.use("7kqf-m2xd-9hpa-t4wn")).toBeNull();

    expect(d.snap().code).toBe(CODE);
    expect(d.state()).toMatchObject({ runId: "cloud-run", day: 9 });
    expect(server.writes.length).toBe(writes);
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
  });

  it("asks when a guest run meets the code's run, and keeps the guest run when the cloud one is chosen", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    const d = device(server);
    d.act(...NEXT_DAY);
    const guestRun = d.state().runId;

    await d.use(CODE);
    const link = d.snap().link;
    expect(link.kind).toBe("choose");
    if (link.kind !== "choose") return;
    expect(link.guest.day).toBe(2);
    expect(link.cloud?.day).toBe(9);
    // Nothing moved yet: still the guest game.
    expect(d.snap().code).toBeNull();

    d.cloud.choose("cloud");
    await d.cloud.idle();
    expect(d.state()).toMatchObject({ runId: "cloud-run", day: 9 });

    await d.cloud.forget();
    expect(d.state()).toMatchObject({ runId: guestRun, day: 2 });
  });

  it("puts the guest run under the code when the player says so, keeping the cloud one", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    const cloudText = server.rows.get(CODE)!.text;
    const d = device(server);
    d.act(...NEXT_DAY);

    await d.use(CODE);
    d.cloud.choose("guest");
    await d.cloud.idle();

    expect(server.rows.get(CODE)).toMatchObject({ revision: 2 });
    expect(server.day(CODE)).toBe(2);
    expect(d.storage.getItem(keysFor(codeSlot(CODE)).replaced)).toBe(cloudText);
  });

  it("changes nothing for a code without a save, a mistyped code, or no connection", async () => {
    const server = new Server();
    const d = device(server);
    d.act(...NEXT_DAY);

    expect(await d.use(CODE)).toBe("unknown");
    expect(await d.use("7KQF-M2XD")).toBe("badCode");
    d.client.offline = true;
    expect(await d.use(CODE)).toBe("network");

    expect(d.snap().code).toBeNull();
    expect(d.storage.getItem(CODE_KEY)).toBeNull();
    expect(d.state().day).toBe(2);
    expect(server.writes).toHaveLength(0);
  });
});

describe("switching codes", () => {
  it("never puts one code's run under another", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    const d = device(server);
    const mine = await d.keep();
    d.act(...NEXT_DAY, ...NEXT_DAY);
    await d.settle();
    expect(server.day(mine)).toBe(3);
    const mineWrites = server.writes.filter((w) => w.code === mine).length;

    // Using another code sets this one's slot aside; the guest game (empty, so
    // untouched) meets the other code's run.
    await d.use(CODE);
    expect(d.state().day).toBe(9);
    d.act(...NEXT_DAY);
    await d.settle();
    expect(server.day(CODE)).toBe(10);
    expect(server.day(mine)).toBe(3);

    // The first code's slot stayed on the device and resumes where it was.
    await d.use(mine);
    expect(d.state().day).toBe(3);
    expect(server.writes.filter((w) => w.code === mine)).toHaveLength(mineWrites);
  });

  it("keeps the device save and tries syncing the last move before returning to the guest game", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    d.act({ type: "askAround" });
    const savedRun = toSave(d.state());
    await d.cloud.forget();
    expect(d.snap()).toMatchObject({ code: null, sync: null });
    expect(d.storage.getItem(keysFor(codeSlot(code)).save)).toBe(savedRun);
    expect(d.storage.getItem(keysFor(codeSlot(code)).backup)).toBe(savedRun);
    expect(server.rows.get(code)?.text).toBe(asJsonb(savedRun));
    expect(d.state().day).toBe(1);
    d.act(...NEXT_DAY);
    await d.settle();
    expect(server.writes.filter((w) => w.code === code)).toHaveLength(2);
  });
});

describe("writing", () => {
  it("coalesces quick moves into one upload", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    const before = server.writes.length;

    d.act({ type: "askAround" }, { type: "lieLow" });
    expect(d.snap().sync).toMatchObject({ kind: "pending" });
    await d.settle();
    expect(server.writes.length).toBe(before + 1);
    expect(server.rows.get(code)?.revision).toBe(2);
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
  });

  it("recognises an upload that landed although its reply was lost", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    d.client.loseReply = true;
    d.act({ type: "askAround" });
    await d.settle();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "offline" });
    expect(server.rows.get(code)?.revision).toBe(2);

    d.cloud.wake();
    await d.cloud.idle();
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
    expect(d.snap().conflict).toBeNull();
    expect(server.rows.get(code)?.revision).toBe(2);
    expect(readMeta(d.storage, codeSlot(code))).toMatchObject({ base: 2, dirty: false, sent: null });
  });

  it("settles a lost reply on the next move, without a conflict", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    d.client.loseReply = true;
    d.act(...NEXT_DAY);
    await d.settle();
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
    expect(server.day(code)).toBe(2);
  });

  it("sends again after an upload that never landed", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    d.client.offline = true;
    d.act(...NEXT_DAY);
    await d.settle();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "offline" });

    d.client.offline = false;
    d.cloud.wake();
    await d.cloud.idle();
    expect(server.day(code)).toBe(2);
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
  });

  it("keeps the unsent state across a reload and finishes it", async () => {
    const server = new Server();
    const storage = memoryStorage();
    const d = device(server, storage);
    const code = await d.keep();
    d.client.offline = true;
    d.act(...NEXT_DAY);
    await d.settle();

    const again = device(server, storage);
    expect(again.snap().code).toBe(code);
    expect(again.state().day).toBe(2);
    await again.cloud.start();
    expect(server.day(code)).toBe(2);
    expect(again.snap().sync).toMatchObject({ kind: "synced" });
  });

  it("stops at a refused save and says so", async () => {
    const server = new Server();
    const d = device(server);
    await d.keep();
    d.client.put = async () => ({ ok: false, reason: "busy" });
    d.act({ type: "askAround" });
    await d.settle();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "busy" });
  });
});

describe("two devices", () => {
  async function pair() {
    const server = new Server();
    const one = device(server);
    const code = await one.keep();
    const two = device(server);
    await two.use(code);
    return { server, one, two, code };
  }

  it("picks up the other device's progress when this one has nothing unsent", async () => {
    const { server, one, two, code } = await pair();
    one.act(...NEXT_DAY);
    await one.settle();
    const revision = server.rows.get(code)?.revision;

    two.cloud.wake();
    await two.cloud.idle();
    expect(two.state().day).toBe(2);
    expect(two.snap().session.getSnapshot().notice).toBe("fromCloud");
    expect(server.rows.get(code)?.revision).toBe(revision);
  });

  it("turns a concurrent write into a choice, never an overwrite", async () => {
    const { server, one, two, code } = await pair();
    one.act(...NEXT_DAY);
    await one.settle();
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();

    expect(two.snap().sync).toMatchObject({ kind: "conflict" });
    expect(two.snap().conflict).toMatchObject({ device: { day: 3 }, cloud: { day: 2 } });
    expect(server.day(code)).toBe(2);
    // Moves made during a conflict wait for the choice.
    two.act({ type: "askAround" });
    await two.settle();
    expect(server.day(code)).toBe(2);
  });

  it("uploads this device's run over the cloud's only when chosen, keeping the cloud one", async () => {
    const { server, one, two, code } = await pair();
    one.act(...NEXT_DAY);
    await one.settle();
    const { text: cloudText, revision } = server.rows.get(code)!;
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();

    two.cloud.resolve("device");
    await two.cloud.idle();
    expect(server.day(code)).toBe(3);
    expect(server.rows.get(code)?.revision).toBe(revision + 1);
    expect(two.storage.getItem(keysFor(codeSlot(code)).replaced)).toBe(cloudText);
    expect(two.snap().sync).toMatchObject({ kind: "synced" });
  });

  it("drops this device's run for the cloud's when chosen, keeping the device one", async () => {
    const { server, one, two, code } = await pair();
    one.act(...NEXT_DAY);
    await one.settle();
    const revision = server.rows.get(code)!.revision;
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();
    const deviceText = two.storage.getItem(keysFor(codeSlot(code)).save);

    two.cloud.resolve("cloud");
    await two.cloud.idle();
    expect(two.state().day).toBe(2);
    expect(two.storage.getItem(keysFor(codeSlot(code)).replaced)).toBe(deviceText);
    expect(server.rows.get(code)?.revision).toBe(revision);
    expect(two.snap().sync).toMatchObject({ kind: "synced" });
  });

  it("sends nothing over a cloud save from a newer version of the game", async () => {
    const { server, one, code } = await pair();
    const row = server.rows.get(code)!;
    server.rows.set(code, { ...row, revision: row.revision + 1, formatVersion: SAVE_VERSION + 1, uploadId: "newer" });
    one.act(...NEXT_DAY);
    await one.settle();
    expect(one.snap().sync).toMatchObject({ kind: "failed", reason: "future" });
    expect(server.rows.get(code)?.uploadId).toBe("newer");
  });

  it("resumes a v4 pending stop and retains the chosen v5 closure through a cloud conflict", async () => {
    const server = new Server();
    const s = newGame(42, "legacy-pinch");
    s.day = 7;
    s.detective.case = { n: 1, place: "docks", habit: "fireworks", announced: 5, places: ["docks"], caught: false };
    s.held.tapes = 2;
    s.rng = rngWhere(below(0.001), atLeast(0.9));
    const stopped = play(s, { type: "sell", good: "tapes", units: 1 }).state;
    const v4 = JSON.stringify({ ...JSON.parse(toSave(stopped)), version: 4 });
    server.put(CODE, null, "from-v4", v4);

    const one = device(server);
    const two = device(server);
    expect(await one.use(CODE)).toBeNull();
    expect(await two.use(CODE)).toBeNull();
    expect(one.state()).toEqual(stopped);
    expect(two.state()).toEqual(stopped);
    expect(server.writes).toHaveLength(1);

    one.act({ type: "resolveStop", choice: "handOver" }, { type: "callItADay" });
    await one.settle();
    expect(server.rows.get(CODE)?.formatVersion).toBe(SAVE_VERSION);
    two.act({ type: "resolveStop", choice: "legIt" });
    await two.settle();
    expect(two.snap().conflict?.cloud?.milestones.cases.at(-1)?.evidence?.handover?.goods).toEqual([["tapes", 2]]);
    expect(two.state().milestones.cases.at(-1)?.evidence?.arrest?.cause).toBe("escape");
    expect(two.cloud.resolve("cloud")).toBe(true);
    expect(two.state()).toEqual(one.state());
    const displaced = two.storage.getItem(keysFor(codeSlot(CODE)).replaced);
    expect(displaced && JSON.parse(displaced).state.milestones.cases.at(-1).evidence.arrest.cause).toBe("escape");
  });
});

describe("the slot's sync record", () => {
  it("is stored beside the code's slot, and not for the guest game", async () => {
    const d = device(new Server());
    expect(d.snap().sync).toBeNull();
    const code = await d.keep();
    expect(d.storage.getItem(metaKey(codeSlot(code)))).not.toBeNull();
    expect(d.storage.getItem(metaKey(GUEST))).toBeNull();
  });
});

// ---- Review round 1 (cnc-cloud-saves-review-1.md) ----------------------------------

const B_CODE = "0123456789ABCDEF";
const meta = (d: ReturnType<typeof device>, code: string) => readMeta(d.storage, codeSlot(code));

describe("a closed slot's sync changes nothing (F2)", () => {
  /** A device on code A whose cloud run another device has advanced, and a code B with a run. */
  async function setup() {
    const server = new Server();
    const d = device(server);
    const a = await d.keep();
    const other = device(server);
    await other.use(a);
    other.act(...NEXT_DAY);
    await other.settle();
    seedCloud(server, B_CODE, 9, "b-run");
    return { server, d, a, aBase: meta(d, a).base };
  }

  it("a read of A answered after switching to B leaves B and A's slot alone", async () => {
    const { d, a, aBase } = await setup();
    d.client.held.add(a);
    d.cloud.wake();
    expect(await d.cloud.use(B_CODE)).toBeNull();
    d.client.release();
    await d.cloud.idle();
    await Promise.resolve();
    expect(d.snap().code).toBe(B_CODE);
    expect(d.state()).toMatchObject({ runId: "b-run", day: 9 });
    expect(meta(d, a).base).toBe(aBase);
  });

  it("a read of A answered after stopping leaves the guest game alone", async () => {
    const { d, a, aBase } = await setup();
    d.client.held.add(a);
    d.cloud.wake();
    // Stopping waits a while for the sync, then closes the slot; the read answers after.
    const forgetting = d.cloud.forget();
    await Promise.resolve();
    d.fire();
    await forgetting;
    d.client.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(d.snap().code).toBeNull();
    expect(d.state().day).toBe(1);
    expect(meta(d, a).base).toBe(aBase);
  });

  it("an old upload answered after A → B → A leaves the reopened slot to settle it", async () => {
    const server = new Server();
    seedCloud(server, B_CODE, 9, "b-run");
    const d = device(server);
    const a = await d.keep();
    const first = server.rows.get(a)!.revision;
    d.client.held.add(a);
    d.act({ type: "askAround" });
    // The upload goes out and hangs; the player switches away and back.
    d.fire();
    await Promise.resolve();
    expect(await d.cloud.use(B_CODE)).toBeNull();
    expect(await d.cloud.use(a)).toBeNull();
    d.client.release();
    await new Promise((r) => setTimeout(r, 0));
    await d.cloud.idle();
    const row = server.rows.get(a)!;
    expect(row.revision).not.toBe(first);
    expect(server.writes.filter((w) => w.code === a && w.base === first)).toHaveLength(1);
    expect(meta(d, a)).toMatchObject({ base: row.revision, dirty: false, sent: null });
    expect(d.snap().conflict).toBeNull();
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
  });

  it("a tab that takes over finishes the writing tab's pending upload", async () => {
    const server = new Server();
    const storage = memoryStorage();
    const writer = device(server, storage);
    const code = await writer.keep();
    writer.client.offline = true;
    writer.act({ type: "askAround" });
    await writer.settle();
    expect(meta(writer, code).sent).not.toBeNull();

    const watcher = device(server, storage, false);
    expect(watcher.snap().sync).toBeNull();
    watcher.cloud.takeOver();
    await watcher.cloud.idle();
    expect(server.rows.get(code)?.revision).toBe(2);
    expect(watcher.snap().sync).toMatchObject({ kind: "synced" });
  });
});

describe("using a code opens its run, never a placeholder (F3)", () => {
  it("stores the fetched run with its revision before the slot opens", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    const d = device(server);
    // The follow-up check fails; the run is already there.
    d.client.readsLeft = 1;
    expect(await d.use(CODE)).toBeNull();
    expect(d.state()).toMatchObject({ runId: "cloud-run", day: 9 });
    expect(meta(d, CODE)).toMatchObject({ base: 1, dirty: false });
  });

  it("refuses a run from a newer game, or one it can't read, and changes nothing", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    server.rows.set(CODE, { ...server.rows.get(CODE)!, formatVersion: SAVE_VERSION + 1 });
    seedCloud(server, B_CODE, 3);
    server.rows.set(B_CODE, { ...server.rows.get(B_CODE)!, text: '{"format":"crime-and-crown-save","version":2,"state":{}}' });
    const d = device(server);
    expect(await d.use(CODE)).toBe("future");
    expect(await d.use(B_CODE)).toBe("unreadable");
    expect(d.snap().code).toBeNull();
    expect(d.storage.getItem(keysFor(codeSlot(CODE)).save)).toBeNull();
  });

  it("says when a synced code's cloud save is gone, and puts the run back when asked", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    const old = server.rows.get(code)!.revision;
    server.drop(code);
    const writes = server.writes.length;
    d.cloud.wake();
    await d.cloud.idle();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "gone" });
    d.act({ type: "askAround" });
    await d.settle();
    expect(server.writes.length).toBe(writes);

    d.cloud.restore();
    await d.cloud.idle();
    // A new save under the code, whose revision no old base matches.
    expect(server.rows.get(code)?.revision).not.toBe(old);
    expect(server.state(code)).toEqual(d.state());
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
  });
});

describe("storage failures keep the save and its revision together (F4)", () => {
  it("doesn't take the cloud's run unless it is stored, and keeps the old base", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const one = device(server);
    const code = await one.keep();
    const two = device(server, storage);
    await two.use(code);
    one.act(...NEXT_DAY);
    await one.settle();

    storage.failing = /\.save(\.backup)?$/;
    two.cloud.wake();
    await two.cloud.idle();
    expect(two.snap().sync).toMatchObject({ kind: "failed", reason: "storage" });
    expect(meta(two, code)).toMatchObject({ base: 1, dirty: false });
    expect(two.state().day).toBe(1);
  });

  it("doesn't send an upload it couldn't record first", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const d = device(server, storage);
    const code = await d.keep();
    const writes = server.writes.length;
    storage.failing = /\.cloud$/;
    d.act({ type: "askAround" });
    await d.settle();
    expect(server.writes.length).toBe(writes);
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "storage" });
    storage.failing = null;
    d.act({ type: "lieLow" });
    await d.settle();
    expect(server.rows.get(code)?.revision).toBe(2);
  });

  it("keeps the guest run where it was when the new code can't be recorded", async () => {
    const storage = flakyStorage();
    const d = device(new Server(), storage);
    d.act(...NEXT_DAY);
    storage.failing = /^cnc\.code$/;
    expect(d.cloud.keep()).toBe("full");
    expect(d.snap().code).toBeNull();
    expect(d.state().day).toBe(2);
    expect(d.storage.getItem(keysFor(GUEST).save)).not.toBeNull();
  });

  it("keeps a conflict open when the cloud's run can't be kept aside", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const one = device(server);
    const code = await one.keep();
    const two = device(server, storage);
    await two.use(code);
    one.act(...NEXT_DAY);
    await one.settle();
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();
    const revision = server.rows.get(code)!.revision;

    storage.failing = /\.replaced$/;
    two.cloud.resolve("device");
    await two.cloud.idle();
    expect(two.snap().conflict).not.toBeNull();
    expect(server.rows.get(code)?.revision).toBe(revision);
  });
});

describe("a pending upload is sent again exactly (F6)", () => {
  it("settles an upload that lands late without a conflict or a second revision", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    d.client.lateCommit = true;
    d.act({ type: "askAround" });
    await d.settle();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "offline" });
    const pending = meta(d, code).sent!;

    // The device sends it again, then the first attempt lands too.
    d.cloud.wake();
    await d.cloud.idle();
    d.client.commitLate?.();
    expect(server.rows.get(code)).toMatchObject({ revision: 2, uploadId: pending.upload });
    expect(server.writes.filter((w) => w.upload === pending.upload).length).toBe(2);
    d.cloud.wake();
    await d.cloud.idle();
    expect(d.snap().conflict).toBeNull();
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
  });
});

describe("walking away from a lookup (F8)", () => {
  it("ignores the answer to a lookup that was cancelled", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    const d = device(server);
    d.act(...NEXT_DAY);
    d.client.held.add(CODE);
    const pending = d.cloud.use(CODE);
    expect(d.snap().link.kind).toBe("busy");
    d.cloud.cancel();
    expect(d.snap().link.kind).toBe("none");
    d.client.release();
    expect(await pending).toBe("cancelled");
    expect(d.snap()).toMatchObject({ code: null, link: { kind: "none" } });
    expect(d.state().day).toBe(2);
  });
});

describe("exporting a recovery copy (F9)", () => {
  it("offers the displaced cloud run as the recovery copy", async () => {
    const server = new Server();
    const one = device(server);
    const code = await one.keep();
    const two = device(server);
    await two.use(code);
    one.act(...NEXT_DAY);
    await one.settle();
    const cloudText = server.rows.get(code)!.text;
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();
    two.cloud.resolve("device");
    await two.cloud.idle();
    expect(two.snap().session.recoveryText()).toBe(cloudText);
  });
});

// ---- Review round 2 (cnc-cloud-saves-review-2.md) ----------------------------------

const slotKeys = (code: string) => keysFor(codeSlot(code));

describe("a slot without a playable run waits for the cloud's (F3)", () => {
  it("resumes a slot that has only its sync record by taking the cloud's run", async () => {
    const server = new Server();
    const one = device(server);
    const code = await one.keep();
    one.act(...NEXT_DAY);
    await one.settle();
    const two = device(server);
    await two.use(code);
    await two.cloud.forget();
    // Only the sync record is left; the cloud still has the revision it names.
    two.storage.removeItem(slotKeys(code).save);
    two.storage.removeItem(slotKeys(code).backup);
    expect(meta(two, code).base).toBe(server.rows.get(code)!.revision);
    const writes = server.writes.length;

    expect(await two.use(code)).toBeNull();
    await two.cloud.idle();
    expect(two.state()).toEqual(server.state(code));
    expect(server.writes.length).toBe(writes);
    expect(two.snap().sync).toMatchObject({ kind: "synced" });
    // From there on it syncs as usual.
    two.act({ type: "askAround" });
    await two.settle();
    expect(server.state(code)).toEqual(two.state());
  });

  it("after a reload with both copies unreadable, takes the cloud's run when untouched", async () => {
    const server = new Server();
    const storage = memoryStorage();
    const d = device(server, storage);
    const code = await d.keep();
    d.act(...NEXT_DAY);
    await d.settle();
    storage.setItem(slotKeys(code).save, "{broken");
    storage.setItem(slotKeys(code).backup, "{broken");
    const writes = server.writes.length;

    const again = device(server, storage);
    expect(again.snap().sync).toMatchObject({ kind: "pending" });
    await again.cloud.start();
    expect(again.state().day).toBe(2);
    expect(server.writes.length).toBe(writes);
    expect(meta(again, code)).toMatchObject({ blank: false, dirty: false });
  });

  it("asks, rather than uploading, when the stand-in run was played before the cloud answered", async () => {
    const server = new Server();
    const storage = memoryStorage();
    const d = device(server, storage);
    const code = await d.keep();
    d.act(...NEXT_DAY);
    await d.settle();
    const cloudRun = server.state(code);
    storage.setItem(slotKeys(code).save, "{broken");
    storage.setItem(slotKeys(code).backup, "{broken");
    const writes = server.writes.length;

    const again = device(server, storage);
    again.client.offline = true;
    await again.cloud.start();
    again.act({ type: "askAround" });
    await again.settle();
    expect(server.writes.length).toBe(writes);
    again.client.offline = false;
    again.cloud.wake();
    await again.cloud.idle();
    expect(again.snap().sync).toMatchObject({ kind: "conflict" });
    expect(server.state(code)).toEqual(cloudRun);
    expect(server.writes.length).toBe(writes);
  });
});

describe("the save and its sync record never disagree (F4)", () => {
  it("doesn't save a move it can't mark as unsent, so a reload never takes it for synced", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const d = device(server, storage);
    const code = await d.keep();
    d.client.offline = true;
    d.act({ type: "askAround" });
    await d.settle();
    const pending = meta(d, code).sent!;
    expect(pending).not.toBeNull();

    storage.failing = /\.cloud$/;
    d.act({ type: "lieLow" });
    expect(d.snap().session.getSnapshot().save).toBe("full");
    expect(storage.getItem(slotKeys(code).save)).toBe(pending.text);

    storage.failing = null;
    const again = device(server, storage);
    await again.cloud.start();
    expect(again.snap().sync).toMatchObject({ kind: "synced" });
    expect(again.state()).toEqual(server.state(code));
    expect(meta(again, code)).toMatchObject({ dirty: false, sent: null });
  });
});

describe("a late original and its retry, with a move after (F6)", () => {
  it("is one revision for the original, then one for the move", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    const first = server.rows.get(code)!.revision;
    d.client.lateCommit = true;
    d.act({ type: "askAround" });
    await d.settle();
    const pending = meta(d, code).sent!;
    d.act({ type: "lieLow" });

    // The read finds nothing landed; the original lands just before the retry arrives.
    d.client.onPut = () => d.client.commitLate?.();
    d.cloud.wake();
    await d.cloud.idle();
    await d.settle();

    const mine = server.writes.filter((w) => w.upload === pending.upload);
    expect(mine).toHaveLength(2);
    expect(mine.every((w) => w.base === first && w.text === pending.text)).toBe(true);
    const after = server.writes.filter((w) => w.base !== null && w.base !== first);
    expect(after).toHaveLength(1);
    expect(server.state(code)).toEqual(d.state());
    expect(d.snap().conflict).toBeNull();
    expect(d.snap().sync).toMatchObject({ kind: "synced" });
  });
});

describe("a lookup answers only the form that asked (F8)", () => {
  it("answers cancelled to a lookup walked away from, after a second one finished", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    seedCloud(server, B_CODE, 4, "b-run");
    const d = device(server);
    d.client.held.add(CODE);
    const first = d.cloud.use(CODE);
    d.cloud.cancel();
    expect(await d.cloud.use(B_CODE)).toBeNull();
    d.client.release();
    expect(await first).toBe("cancelled");
    expect(d.snap().code).toBe(B_CODE);
    expect(d.state()).toMatchObject({ runId: "b-run", day: 4 });
  });
});

describe("a save put back after it was deleted (G1)", () => {
  it("can't be overwritten from a base the deleted save had, and is taken by a clean device", async () => {
    const server = new Server();
    const one = device(server);
    const code = await one.keep();
    const two = device(server);
    await two.use(code);
    const three = device(server);
    await three.use(code);
    const old = server.rows.get(code)!.revision;
    expect(meta(two, code).base).toBe(old);

    server.drop(code);
    one.act(...NEXT_DAY);
    await one.settle();
    expect(one.snap().sync).toMatchObject({ kind: "failed", reason: "gone" });
    one.cloud.restore();
    await one.cloud.idle();
    const restored = server.state(code);
    expect(restored?.day).toBe(2);

    // A device with moves from the old save is asked; nothing goes up.
    two.act({ type: "askAround" });
    await two.settle();
    expect(two.snap().sync).toMatchObject({ kind: "conflict" });
    expect(server.state(code)).toEqual(restored);
    // A device with nothing unsent picks up the restored run.
    three.cloud.wake();
    await three.cloud.idle();
    expect(three.state()).toEqual(restored);
  });
});

describe("a choice that can't be stored (G2)", () => {
  async function conflicted() {
    const server = new Server();
    const storage = flakyStorage();
    const one = device(server);
    const code = await one.keep();
    const two = device(server, storage);
    await two.use(code);
    one.act(...NEXT_DAY);
    await one.settle();
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();
    expect(two.snap().conflict).not.toBeNull();
    return { server, storage, two, code };
  }

  it("says so for either choice, keeps the conflict open, and works once there is room", async () => {
    const { server, storage, two, code } = await conflicted();
    const revision = server.rows.get(code)!.revision;
    storage.failing = /\.replaced$/;
    expect(two.cloud.resolve("device")).toBe(false);
    expect(two.cloud.resolve("cloud")).toBe(false);
    expect(two.snap().conflict).not.toBeNull();
    expect(two.state().day).toBe(3);
    expect(server.rows.get(code)?.revision).toBe(revision);

    storage.failing = null;
    expect(two.cloud.resolve("device")).toBe(true);
    await two.cloud.idle();
    expect(server.state(code)).toEqual(two.state());
  });

  it("keeps a guest-run choice open when it can't be stored, and leaves it on request", async () => {
    const server = new Server();
    seedCloud(server, CODE, 9);
    const storage = flakyStorage();
    const d = device(server, storage);
    d.act(...NEXT_DAY);
    await d.use(CODE);
    storage.failing = /^cnc\.code$/;
    expect(d.cloud.choose("cloud")).toBe("full");
    expect(d.cloud.choose("guest")).toBe("full");
    expect(d.snap()).toMatchObject({ code: null, link: { kind: "choose" } });
    expect(d.storage.getItem(slotKeys(CODE).save)).toBeNull();

    d.cloud.dismiss();
    expect(d.snap()).toMatchObject({ code: null, link: { kind: "none" } });
    expect(d.state().day).toBe(2);
  });
});

describe("removing a code's copy from the device (Q3)", () => {
  it("removes all device copies and leaves the existing cloud save alone", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    const cloudSave = server.rows.get(code);
    const writes = server.writes.length;
    d.act({ type: "askAround" });
    d.storage.setItem(slotKeys(code).kept, "kept text");
    d.storage.setItem(slotKeys(code).replaced, "recovery text");

    expect(await d.cloud.forget(true)).toBeNull();
    expect(d.snap().code).toBeNull();
    expect(d.storage.getItem(CODE_KEY)).toBeNull();
    for (const key of [...Object.values(slotKeys(code)), metaKey(codeSlot(code))]) expect(d.storage.getItem(key)).toBeNull();
    await d.settle();
    expect(server.writes).toHaveLength(writes);
    expect(server.rows.get(code)).toEqual(cloudSave);
  });

  it("says when the copy here couldn't be deleted, and deletes it on a retry", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const d = device(server, storage);
    const code = await d.keep();
    storage.unremovable = /^cnc\.c\./;
    expect(await d.cloud.forget(true)).toBe("notRemoved");
    expect(d.snap().code).toBeNull();
    expect(storage.getItem(slotKeys(code).save)).not.toBeNull();

    storage.unremovable = null;
    expect(d.cloud.remove(code)).toBe(true);
    expect(storage.getItem(slotKeys(code).save)).toBeNull();
    expect(storage.getItem(metaKey(codeSlot(code)))).toBeNull();
  });

  it("says when stopping couldn't be recorded, and keeps syncing", async () => {
    const storage = flakyStorage();
    const d = device(new Server(), storage);
    const code = await d.keep();
    storage.failing = /^cnc\.code$/;
    storage.unremovable = /^cnc\.code$/;
    expect(await d.cloud.forget()).toBe("full");
    expect(d.snap().code).toBe(code);
  });

  it("removes the device copy while an earlier read is still pending", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    server.drop(code);
    d.client.held.add(code);
    d.cloud.wake();
    const reading = d.cloud.idle();

    const removing = d.cloud.forget(true);
    expect(d.snap().code).toBeNull();
    d.client.release();
    expect(await removing).toBeNull();
    await reading;
    expect(d.storage.getItem(slotKeys(code).save)).toBeNull();
    expect(d.storage.getItem(metaKey(codeSlot(code)))).toBeNull();
  });
});

// ---- Review round 3 (cnc-cloud-saves-review-3.md) ----------------------------------

/** A device whose code's slot has neither save copy readable, as a reload finds it. */
async function brokenSlot(storage: StorageLike) {
  const server = new Server();
  const d = device(server, storage);
  const code = await d.keep();
  d.act(...NEXT_DAY);
  await d.settle();
  storage.setItem(slotKeys(code).save, "{broken");
  storage.setItem(slotKeys(code).backup, "{broken");
  return { server, code, cloudRun: server.state(code), writes: server.writes.length };
}

describe("a stand-in that can't be marked (H1)", () => {
  it("doesn't sync at all, so a played stand-in is never replaced or uploaded", async () => {
    const storage = flakyStorage();
    const { server, code, cloudRun, writes } = await brokenSlot(storage);
    const base = readMeta(storage, codeSlot(code)).base;
    storage.failing = /\.cloud$/;
    const again = device(server, storage);
    expect(again.snap().sync).toMatchObject({ kind: "failed", reason: "storage" });
    expect(again.snap().session.getSnapshot().save).toBe("off");
    again.act({ type: "askAround" });
    const played = again.state();

    // Storage recovers before the cloud answers: still nothing happens.
    storage.failing = null;
    await again.cloud.start();
    again.cloud.wake();
    await again.cloud.idle();
    await again.settle();
    expect(again.state()).toEqual(played);
    expect(server.writes.length).toBe(writes);
    expect(server.state(code)).toEqual(cloudRun);
    // No adoption was recorded either.
    expect(readMeta(storage, codeSlot(code)).base).toBe(base);
    expect(again.snap().session.exportText()).toBe(toSave(played));
  });
});

describe("a code's slot recovered from its backup copy (H2)", () => {
  it("is reconciled with the cloud before anything goes up", async () => {
    const server = new Server();
    const storage = memoryStorage();
    const d = device(server, storage);
    const code = await d.keep();
    const older = storage.getItem(slotKeys(code).save)!;
    d.act(...NEXT_DAY);
    await d.settle();
    // The save is unreadable and the backup copy is an older run (its refresh had failed).
    storage.setItem(slotKeys(code).save, "{broken");
    storage.setItem(slotKeys(code).backup, older);
    const writes = server.writes.length;

    const again = device(server, storage);
    expect(again.state().day).toBe(1);
    await again.cloud.start();
    expect(again.state()).toEqual(server.state(code));
    expect(server.writes.length).toBe(writes);
  });
});

describe("a guest-only build (H3)", () => {
  it("plays the guest game and leaves the code's slot for a build with a cloud", async () => {
    const server = new Server();
    const storage = memoryStorage();
    const d = device(server, storage);
    const code = await d.keep();
    d.act(...NEXT_DAY);
    await d.settle();
    const slotText = storage.getItem(slotKeys(code).save);
    const writes = server.writes.length;

    const guestOnly = device(server, storage, true, false);
    expect(guestOnly.snap()).toMatchObject({ code: null, sync: null, available: false });
    guestOnly.act(...NEXT_DAY);
    expect(storage.getItem(slotKeys(code).save)).toBe(slotText);
    expect(storage.getItem(CODE_KEY)).toBe(code);

    const back = device(server, storage);
    expect(back.snap().code).toBe(code);
    await back.cloud.start();
    expect(back.state()).toEqual(server.state(code));
    expect(back.snap().sync).toMatchObject({ kind: "synced" });
    expect(server.writes.length).toBe(writes);
  });

  it("doesn't make a stand-in under a code whose save is missing", async () => {
    const server = new Server();
    const storage = memoryStorage();
    const d = device(server, storage);
    const code = await d.keep();
    d.act(...NEXT_DAY);
    await d.settle();
    storage.removeItem(slotKeys(code).save);
    storage.removeItem(slotKeys(code).backup);
    const writes = server.writes.length;

    const guestOnly = device(server, storage, true, false);
    guestOnly.act({ type: "askAround" });
    expect(storage.getItem(slotKeys(code).save)).toBeNull();

    const back = device(server, storage);
    await back.cloud.start();
    expect(back.state()).toEqual(server.state(code));
    expect(server.writes.length).toBe(writes);
  });
});

describe("a deferred conflict acts on the run in play (H4)", () => {
  async function conflicted() {
    const server = new Server();
    const storage = flakyStorage();
    const one = device(server);
    const code = await one.keep();
    const two = device(server, storage);
    await two.use(code);
    one.act(...NEXT_DAY);
    await one.settle();
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();
    expect(two.snap().conflict).not.toBeNull();
    return { server, storage, two, code };
  }

  it("uploads the run as it is now when this device's run is kept after more moves", async () => {
    const { server, two, code } = await conflicted();
    two.act({ type: "askAround" }, { type: "lieLow" });
    expect(two.cloud.resolve("device")).toBe(true);
    await two.cloud.idle();
    expect(server.state(code)).toEqual(two.state());
  });

  it("stores a run whose last move failed to save before keeping it, or refuses", async () => {
    const { server, storage, two, code } = await conflicted();
    const revision = server.rows.get(code)!.revision;
    storage.failing = /\.save$/;
    two.act({ type: "askAround" });
    expect(two.snap().session.getSnapshot().save).toBe("full");
    const playing = two.state();
    expect(two.cloud.resolve("device")).toBe(false);
    expect(server.rows.get(code)?.revision).toBe(revision);

    storage.failing = null;
    expect(two.cloud.resolve("device")).toBe(true);
    await two.cloud.idle();
    expect(server.state(code)).toEqual(playing);
  });

  it("keeps the run in play, unsaved move included, when the cloud's run is chosen", async () => {
    const { storage, two } = await conflicted();
    storage.failing = /\.save$/;
    two.act({ type: "askAround" });
    const playing = two.state();
    storage.failing = null;
    expect(two.cloud.resolve("cloud")).toBe(true);
    expect(two.snap().session.recoveryText()).toBe(toSave(playing));
  });
});

describe("removal and missing cloud saves", () => {
  it("doesn't call a removal done when the keys can't be read back", async () => {
    const storage = flakyStorage();
    const d = device(new Server(), storage);
    const code = await d.keep();
    storage.unremovable = /^cnc\.c\./;
    storage.unreadable = /^cnc\.c\./;
    expect(await d.cloud.forget(true)).toBe("notRemoved");
    storage.unreadable = null;
    storage.unremovable = null;
    expect(d.cloud.remove(code)).toBe(true);
  });

  it("remembers a missing cloud save through a failed check and a reload", async () => {
    const server = new Server();
    const storage = memoryStorage();
    const d = device(server, storage);
    const code = await d.keep();
    server.drop(code);
    d.cloud.wake();
    await d.cloud.idle();
    expect(d.cloud.missing()).toBe(true);

    d.client.offline = true;
    d.cloud.wake();
    await d.cloud.idle();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "offline" });
    expect(d.cloud.missing()).toBe(true);

    const again = device(server, storage);
    expect(again.cloud.missing()).toBe(true);
    expect(again.snap().sync).toMatchObject({ kind: "failed", reason: "gone" });
    // Nothing goes up over a missing save until the player puts it back.
    again.act({ type: "askAround" });
    await again.settle();
    expect(server.rows.get(code)).toBeUndefined();
    again.cloud.restore();
    await again.cloud.idle();
    expect(server.state(code)).toEqual(again.state());
    expect(again.cloud.missing()).toBe(false);
  });
});

// ---- Review round 4 (cnc-cloud-saves-review-4.md) ----------------------------------

describe("a missing cloud save whose mark can't be stored (J1)", () => {
  it("shows the storage failure and records the missing mark on the next successful check", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const d = device(server, storage);
    const code = await d.keep();
    server.drop(code);

    storage.failing = /\.cloud$/;
    d.cloud.wake();
    await d.cloud.idle();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "storage" });
    expect(d.cloud.missing()).toBe(true);
    expect(readMeta(storage, codeSlot(code)).missing).toBe(false);

    storage.failing = null;
    const again = device(server, storage);
    again.client.offline = true;
    await again.cloud.start();
    expect(again.snap().sync).toMatchObject({ kind: "failed", reason: "offline" });
    again.client.offline = false;
    again.cloud.wake();
    await again.cloud.idle();
    expect(again.cloud.missing()).toBe(true);
    expect(readMeta(storage, codeSlot(code)).missing).toBe(true);
    expect(again.snap().sync).toMatchObject({ kind: "failed", reason: "gone" });
  });
});

describe("putting a missing save back (J2)", () => {
  it("stores the run in play first, refuses while it can't, and works once it can", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const d = device(server, storage);
    const code = await d.keep();
    server.drop(code);
    d.cloud.wake();
    await d.cloud.idle();

    storage.failing = /\.save$/;
    d.act({ type: "askAround" });
    expect(d.snap().session.getSnapshot().save).toBe("full");
    const playing = d.state();
    expect(d.cloud.restore()).toBe(false);
    expect(d.cloud.missing()).toBe(true);
    expect(server.rows.get(code)).toBeUndefined();

    storage.failing = null;
    expect(d.cloud.restore()).toBe(true);
    await d.cloud.idle();
    expect(server.state(code)).toEqual(playing);
    expect(d.cloud.missing()).toBe(false);
  });
});

describe("a record that missed taking the cloud's run (J3)", () => {
  it("catches up without replacing the run again, so the recovery copy keeps the displaced run", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const one = device(server);
    const code = await one.keep();
    const two = device(server, storage);
    await two.use(code);
    one.act(...NEXT_DAY);
    await one.settle();
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();
    expect(two.snap().conflict).not.toBeNull();
    const displaced = toSave(two.state());

    // The cloud's run is stored, but the record of it isn't.
    storage.failing = /\.cloud$/;
    expect(two.cloud.resolve("cloud")).toBe(true);
    expect(two.snap().session.recoveryText()).toBe(displaced);
    storage.failing = null;
    expect(meta(two, code).dirty).toBe(true);

    const again = device(server, storage);
    await again.cloud.start();
    expect(again.snap().conflict).toBeNull();
    expect(again.snap().sync).toMatchObject({ kind: "synced" });
    expect(again.state()).toEqual(server.state(code));
    expect(again.snap().session.recoveryText()).toBe(displaced);
    expect(meta(again, code)).toMatchObject({ base: server.rows.get(code)!.revision, dirty: false });
  });
});

describe("the hosted key order (jsonb)", () => {
  it("counts a run as the same whatever order its keys come in", () => {
    const text = toSave(device(new Server()).state());
    expect(sameRun(text, asJsonb(text))).toBe(true);
    expect(sameRun(asJsonb(text), text)).toBe(true);
    expect(sameRun(text, text.replace('"day":1', '"day":2'))).toBe(false);
    expect(sameRun(null, text)).toBe(false);
    expect(sameRun("{broken", text)).toBe(false);
  });

  it("catches up on the cloud's run without replacing it when the device's copy has another key order", async () => {
    const server = new Server();
    const storage = flakyStorage();
    const one = device(server);
    const code = await one.keep();
    const two = device(server, storage);
    await two.use(code);
    one.act(...NEXT_DAY);
    await one.settle();
    two.act(...NEXT_DAY, ...NEXT_DAY);
    await two.settle();
    const displaced = toSave(two.state());

    storage.failing = /\.cloud$/;
    expect(two.cloud.resolve("cloud")).toBe(true);
    storage.failing = null;
    // The device's copy is the cloud's run, its keys in another order.
    const keys = keysFor(codeSlot(code));
    const reversed = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reversed)
        : v !== null && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .reverse()
                .map((k) => [k, reversed((v as Record<string, unknown>)[k])]),
            )
          : v;
    const own = toSave(reversed(server.state(code)) as GameState);
    expect(own).not.toBe(storage.getItem(keys.save));
    storage.setItem(keys.save, own);
    storage.setItem(keys.backup, own);

    const again = device(server, storage);
    await again.cloud.start();
    expect(again.snap().conflict).toBeNull();
    expect(again.snap().sync).toMatchObject({ kind: "synced" });
    expect(again.snap().session.recoveryText()).toBe(displaced);
  });
});

// ---- Review round 6 (cnc-cloud-saves-review-6.md) ----------------------------------

describe("an upload's reply that the cloud has no save (L1)", () => {
  it("records the missing save even when the read after it fails", async () => {
    const server = new Server();
    const d = device(server);
    const code = await d.keep();
    server.drop(code);
    d.act({ type: "askAround" });
    d.client.readsLeft = 0;
    const writes = server.writes.length;

    await d.settle();
    expect(server.writes.length).toBe(writes + 1);
    expect(server.rows.get(code)).toBeUndefined();
    expect(d.snap().sync).toMatchObject({ kind: "failed", reason: "offline" });
    expect(d.cloud.missing()).toBe(true);
    expect(readMeta(d.storage, codeSlot(code)).missing).toBe(true);
  });
});
