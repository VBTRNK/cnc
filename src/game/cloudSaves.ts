// Which game this device plays, and whether it syncs (docs/design.md, "Cloud saves";
// ADR-009). There are no accounts: a run is kept in the cloud under a random code, and
// entering that code on another device continues it there. The guest game has a local
// slot of its own, and so does each code used on this device; only the open code's slot
// syncs, and only under its own code, so one code's run never lands under another.
//
// Keeping in the cloud moves the guest run under a new code. Using a code resumes its slot
// if this device has one. Otherwise the cloud is read first: no save under the code, or one
// this game can't play, and nothing changes; an untouched guest game, and the cloud run is
// stored in the code's slot with its revision before the slot opens; a guest run in
// progress, and the player chooses, and the other is kept.
//
// Each step stores what it needs in order and stops at the first failed write, so a
// storage failure leaves the previous state in place, and says so. A lookup the player
// walked away from (cancel, closing the sheet, another action) changes nothing when it
// answers, and answers "cancelled". A code's slot that opens without its own save
// waits for the cloud's run before it uploads anything (sync.ts).
//
// Only a build with a cloud opens a code's slot: a guest-only build (no settings, or no
// tab lock to keep one writer) plays the guest game and leaves the device's code and its
// slot untouched for a build that can sync them.

import { RULES, SAVE_VERSION, carried, loadSave, toSave, type GameState } from "../sim/index.ts";
import type { CloudApi, CloudRow } from "./cloud.ts";
import { newCode, normalizeCode } from "./code.ts";
import { GameSession } from "./session.ts";
import { GUEST, codeSlot, keysFor, memoryStorage, webStore, type Opened, type SaveStore, type StorageLike } from "./store.ts";
import { CloudSync, metaKey, syncedStore, writeMeta, type Conflict, type SyncHost, type SyncStatus } from "./sync.ts";

/** The code this device syncs, if any. */
export const CODE_KEY = "cnc.code";

/**
 * badCode: not a code. unknown: no cloud save has it. network: the cloud couldn't be
 * read. future: its save is from a newer game. unreadable: its save can't be loaded.
 * full: this device couldn't store it.
 */
export type UseError = "badCode" | "unknown" | "network" | "future" | "unreadable" | "full";

/** full: this device couldn't record that it stopped. notRemoved: it stopped, but its copy couldn't be deleted. */
export type ForgetError = "full" | "notRemoved";

export type Link =
  | { kind: "none" }
  | { kind: "busy" }
  /** The guest run meets the code's cloud run: the player chooses. */
  | { kind: "choose"; guest: GameState; cloud: GameState; cloudAt: string };

export interface CloudSnapshot {
  session: GameSession;
  /** The key of the slot's save, which a watching tab follows. */
  saveKey: string;
  /** The cloud code whose slot is open; null for the guest game. */
  code: string | null;
  /** This build has a cloud at all. */
  available: boolean;
  /** null for the guest game, and in a tab that only watches. */
  sync: SyncStatus | null;
  conflict: Conflict | null;
  link: Link;
}

export interface CloudSavesOptions {
  storage: () => StorageLike;
  cloud: CloudApi | null;
  writer: boolean;
  makeSeed: () => number;
  makeId: () => string;
  /** A random UUID, for upload ids. */
  makeUuid: () => string;
  /** `count` random bytes, for new codes. */
  random: (count: number) => Uint8Array;
  syncDelay?: number;
  timer?: (fn: () => void, ms: number) => () => void;
}

/** A guest game nobody has played yet: nothing lost by setting it aside. */
export const untouched = (s: GameState): boolean =>
  s.phase === "day" &&
  s.day === 1 &&
  s.hour === RULES.dayStart &&
  s.cash === RULES.startCash &&
  carried(s) === 0 &&
  s.upgrades.length === 0 &&
  s.pending === null;

export class CloudSaves {
  private readonly options: CloudSavesOptions;
  private readonly storage: StorageLike;
  private writer: boolean;
  private code: string | null;
  private store!: SaveStore;
  private session!: GameSession;
  private sync: CloudSync | null = null;
  private unhook: (() => void) | null = null;
  private link: Link = { kind: "none" };
  /** The cloud run the player is choosing against. */
  private choosing: { code: string; row: CloudRow; state: GameState } | null = null;
  /** Bumped by every action, so an older lookup's answer is ignored. */
  private op = 0;
  private listeners = new Set<() => void>();
  private snap!: CloudSnapshot;

  constructor(options: CloudSavesOptions) {
    this.options = options;
    this.writer = options.writer;
    this.storage = resolveStorage(options.storage);
    this.code = this.readCode();
    this.open();
  }

  // ---- React's side --------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CloudSnapshot => this.snap;

  private emit(): void {
    this.snap = {
      session: this.session,
      saveKey: this.store.key,
      code: this.code,
      available: this.options.cloud !== null,
      sync: this.sync?.status() ?? null,
      conflict: this.sync?.conflict() ?? null,
      link: this.link,
    };
    for (const l of this.listeners) l();
  }

  // ---- Lifecycle -----------------------------------------------------------------

  /** Checks the cloud at start; call once the page is up. */
  start(): Promise<void> {
    return this.sync?.check() ?? Promise.resolve();
  }

  /** Whether the open code's cloud save was seen gone, so the run can be put back. */
  missing = (): boolean => this.sync?.missing() ?? false;

  /** Resolves when the sync has nothing in flight. */
  idle = (): Promise<void> => this.sync?.idle() ?? Promise.resolve();

  /** Back in the foreground or online again: catch up both ways. */
  wake = (): void => {
    void this.sync?.check();
  };

  /** The page is being hidden: send what is unsent. */
  flush = (): void => this.sync?.flush();

  /** The writing tab closed: this one takes over its slot and its sync. */
  takeOver = (): void => {
    if (this.writer) return;
    this.op++;
    this.writer = true;
    this.code = this.readCode();
    this.open();
    void this.start();
  };

  // ---- Codes ---------------------------------------------------------------------

  /** Keeps the guest run in the cloud under a new code. */
  keep(): "full" | null {
    const guest = this.session.getSnapshot().state;
    if (!this.options.cloud || !this.writer || this.code || !guest) return null;
    this.op++;
    return this.moveGuestIn(newCode(this.options.random), guest, null);
  }

  /** Plays the run kept under a code the player typed. "cancelled": the player walked away first. */
  async use(typed: string): Promise<UseError | "cancelled" | null> {
    const cloud = this.options.cloud;
    const code = normalizeCode(typed);
    if (!code) return "badCode";
    if (!cloud || !this.writer) return "network";
    if (code === this.code) return null;
    const op = ++this.op;

    // This device has played the code before: resume its slot and let the sync catch up.
    if (this.hasSlot(code)) return this.activate(code) ? null : "full";

    this.setLink({ kind: "busy" });
    const f = await cloud.fetch(code);
    // The player walked away from this lookup; its answer changes nothing.
    if (op !== this.op) return "cancelled";
    this.setLink({ kind: "none" });
    if (!f.ok) return "network";
    const row = f.row;
    if (!row) return "unknown";
    if (row.formatVersion > SAVE_VERSION) return "future";
    const cloudSave = loadSave(row.text);
    if (!cloudSave.ok) return cloudSave.error === "future" ? "future" : "unreadable";

    // Another code's slot is set aside first; it never meets this one.
    if (this.code && !this.setAside()) return "full";
    const guest = this.session.getSnapshot().state;
    if (!guest || untouched(guest)) return this.adoptIn(code, cloudSave.state, row);
    this.choosing = { code, row, state: cloudSave.state };
    this.setLink({ kind: "choose", guest, cloud: cloudSave.state, cloudAt: row.updatedAt });
    return null;
  }

  /** Walks away from a pending lookup. */
  cancel = (): void => {
    this.op++;
    if (this.link.kind === "busy") this.setLink({ kind: "none" });
  };

  /**
   * Settles the guest run against the code's cloud run. Done, the code's slot opens; on
   * "full" nothing moved and the choice stays open.
   */
  choose(keep: "guest" | "cloud"): "full" | null {
    const c = this.choosing;
    const guest = this.session.getSnapshot().state;
    if (!c) return null;
    this.op++;
    // Playing the cloud run leaves the guest run as the guest game on this device.
    if (keep === "cloud" || !guest) return this.adoptIn(c.code, c.state, c.row);
    return this.moveGuestIn(c.code, guest, c.row);
  }

  /** Walks away from the choice between the guest run and a code's run; nothing changes. */
  dismiss = (): void => {
    if (!this.choosing) return;
    this.op++;
    this.choosing = null;
    this.setLink({ kind: "none" });
  };

  /** Returns to the guest game. Stopping makes a final sync attempt; removal only clears the device slot. */
  async forget(remove = false): Promise<ForgetError | null> {
    const code = this.code;
    if (!code) return null;
    const op = ++this.op;
    const sync = this.sync;
    if (sync && !remove) {
      sync.flush();
      const timer = this.options.timer ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
      await Promise.race([sync.idle(), new Promise<void>((r) => void timer(r, 3000))]);
    }
    if (op !== this.op || this.code !== code) return null;
    if (!this.setAside()) return "full";
    if (remove && !this.removeSlot(code)) return "notRemoved";
    return null;
  }

  /** Deletes a closed code's copy on this device (a retry after "notRemoved"). False if some of it stays. */
  remove(code: string): boolean {
    if (code === this.code) return false;
    return this.removeSlot(code);
  }

  /** Settles a conflict between this device's run and the cloud's. False if the choice couldn't be stored. */
  resolve = (keep: "device" | "cloud"): boolean => this.sync?.resolve(keep) ?? false;

  /** Puts this device's run back under its code after the cloud save disappeared. False if it couldn't be stored first. */
  restore = (): boolean => this.sync?.restore() ?? false;

  // ---- Internals -----------------------------------------------------------------

  /** Opens the code's slot and records it as the device's code. False if it can't be recorded. */
  private activate(code: string): boolean {
    if (!this.writeCode(code)) return false;
    this.code = code;
    this.open();
    void this.start();
    return true;
  }

  /** Back to the guest game. False if that can't be recorded. */
  private setAside(): boolean {
    if (!this.writeCode(null)) return false;
    this.code = null;
    this.open();
    return true;
  }

  /** Stores a cloud run in the code's slot, with its revision, then opens the slot. */
  private adoptIn(code: string, state: GameState, row: CloudRow): "full" | null {
    const prefix = codeSlot(code);
    const target = webStore(this.options.storage, { prefix });
    const meta = { base: row.revision, dirty: false, rev: 0, sent: null, synced: row.updatedAt, blank: false, missing: false };
    if (!target.write(state).ok || !writeMeta(this.storage, prefix, meta) || !this.activate(code)) {
      this.removeSlot(code);
      return "full";
    }
    return null;
  }

  /** The guest run moves under the code; with a cloud save, that one is kept aside. */
  private moveGuestIn(code: string, guest: GameState, row: CloudRow | null): "full" | null {
    const prefix = codeSlot(code);
    const target = webStore(this.options.storage, { prefix });
    const meta = { base: row?.revision ?? null, dirty: true, rev: 1, sent: null, synced: null, blank: false, missing: false };
    const guestStore = this.store;
    if (
      !target.write(guest).ok ||
      !writeMeta(this.storage, prefix, meta) ||
      (row !== null && !target.keep(row.text).ok) ||
      !this.activate(code)
    ) {
      this.removeSlot(code);
      return "full";
    }
    // The run moved; the guest slot keeps it only as its recovery copy. If emptying it
    // fails, the guest game simply keeps a copy of the run.
    guestStore.clear();
    return null;
  }

  /** Opens the current code's slot (or the guest's) in a new session. */
  private open(): void {
    this.sync?.stop();
    this.unhook?.();
    this.link = { kind: "none" };
    this.choosing = null;
    const code = this.code;
    const prefix = code ? codeSlot(code) : GUEST;
    const inner = webStore(this.options.storage, { prefix });
    const cloud = this.options.cloud;
    // The sync acts only on the session it was opened with, never on a later one.
    let session: GameSession | null = null;
    const host: SyncHost = {
      text: () => inner.peek(),
      state: () => session?.getSnapshot().state ?? null,
      // Never into a session that doesn't store: the run would only be in memory.
      adopt: (state) => session !== null && session.getSnapshot().save !== "off" && session.replace(state, "fromCloud"),
      keep: (text) => inner.keep(text).ok,
      persist: () => session?.saveNow() ?? false,
      same: (state) => session !== null && session.getSnapshot().save === "saved" && sameRun(inner.peek(), toSave(state)),
    };
    const sync =
      code && cloud && this.writer
        ? new CloudSync(code, cloud, this.storage, prefix, host, {
            makeId: this.options.makeUuid,
            ...(this.options.syncDelay === undefined ? {} : { delay: this.options.syncDelay }),
            ...(this.options.timer ? { timer: this.options.timer } : {}),
          })
        : null;
    this.sync = sync;
    this.store = sync ? blankAware(syncedStore(inner, sync), sync) : inner;
    // Opening a slot may write it (a fresh run, a migrated save); that is not a move.
    if (sync) sync.quiet = true;
    session = new GameSession(this.store, {
      writer: this.writer,
      makeSeed: this.options.makeSeed,
      makeId: this.options.makeId,
    });
    if (sync) sync.quiet = false;
    this.session = session;
    const opened = session;
    const offSync = sync?.subscribe(() => this.emit());
    // The day's end is a good moment to send the day.
    const offSession = opened.subscribe(() => {
      if (opened.getSnapshot().events.some((e) => e.type === "dayEnded")) sync?.flush();
    });
    this.unhook = () => {
      offSync?.();
      offSession();
    };
    this.emit();
  }

  private setLink(link: Link): void {
    this.link = link;
    this.emit();
  }

  private hasSlot(code: string): boolean {
    const prefix = codeSlot(code);
    return this.get(`${prefix}.save`) !== null || this.get(metaKey(prefix)) !== null;
  }

  /** Deletes every key of a code's slot. False unless each is confirmed gone. */
  private removeSlot(code: string): boolean {
    const prefix = codeSlot(code);
    const keys = keysFor(prefix);
    const all = [keys.save, keys.backup, keys.kept, keys.replaced, metaKey(prefix)];
    for (const key of all) {
      try {
        this.storage.removeItem(key);
      } catch {
        // Checked below.
      }
    }
    // A key that can't be read isn't confirmed gone.
    return all.every((key) => {
      try {
        return this.storage.getItem(key) === null;
      } catch {
        return false;
      }
    });
  }

  private get(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  /** The device's code, which only a build with a cloud opens. */
  private readCode(): string | null {
    if (!this.options.cloud) return null;
    return normalizeCode(this.get(CODE_KEY) ?? "");
  }

  private writeCode(code: string | null): boolean {
    try {
      if (code) this.storage.setItem(CODE_KEY, code);
      else this.storage.removeItem(CODE_KEY);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * A code slot's store that tells the sync when the slot opens without its own save
 * (missing, unreadable, or recovered from an older backup copy), so the stand-in never
 * goes up over the cloud's run unasked. If even that can't be recorded, the sync stops and
 * the slot opens as unavailable: the stand-in is played, exportable, and never saved.
 */
/**
 * Whether two save texts hold the same run. Key order doesn't count: the hosted database
 * keeps a save as jsonb, which returns its keys in an order of its own.
 */
export function sameRun(a: string | null, b: string): boolean {
  if (a === null) return false;
  if (a === b) return true;
  try {
    return canonical(JSON.parse(a)) === canonical(JSON.parse(b));
  } catch {
    return false;
  }
}

const canonical = (value: unknown): string => JSON.stringify(sortKeys(value));
const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
        )
      : value;

function blankAware(store: SaveStore, sync: CloudSync): SaveStore {
  return {
    ...store,
    open(): Opened {
      const opened = store.open();
      const standIn = opened.kind === "empty" || opened.kind === "lost" || opened.kind === "recovered";
      if (standIn && !sync.markBlank()) return { kind: "unavailable" };
      return opened;
    },
  };
}

/** The page's storage, or one that keeps nothing when the browser refuses it. */
function resolveStorage(get: () => StorageLike): StorageLike {
  try {
    const s = get();
    s.getItem(CODE_KEY);
    return s;
  } catch {
    return memoryStorage();
  }
}
