// Cloud sync for the slot of one cloud code (docs/design.md, "Cloud saves"; ADR-009).
// The device save comes first; this follows it.
//
// - The slot remembers the cloud revision its save descends from (`base`). Fetching a
//   newer cloud save never moves it; only adopting that save or an acknowledged upload do.
// - Uploads follow local writes, coalesced and one at a time, and present `base`. The
//   database accepts only while `base` is current (cnc.put_save).
// - An upload is stored (id, base and text) before it is sent, and stays pending until
//   its outcome is known. A pending upload is sent again exactly as it was, which the
//   database answers as saved if it already landed; later moves go up after it.
// - A cloud save newer than `base` is adopted when this device has nothing unsent, and is
//   a conflict for the player to settle when it has. Nothing is merged; the displaced
//   save is kept as the recovery copy.
// - The record never understates the save: a move is recorded as unsent before it is
//   saved (and isn't saved if that can't be recorded), and the base moves only once the
//   run it belongs to is stored. When a write fails, the sync stops and says so.
// - A slot that opened without its own save (missing, unreadable, or recovered from its
//   backup copy) plays a stand-in that may not be the cloud's run: nothing goes up until
//   the cloud has been read. Its run is then taken if the stand-in is untouched, and the
//   player chooses if not. If even that can't be recorded, the slot doesn't sync at all.
// - The cloud's run is taken only into a session that stores it, and this device's run is
//   kept in a conflict (or put back after its cloud save disappeared) only once the run in
//   play is stored. When the stored run already is the cloud's, only the record catches up:
//   its recovery copy stays as it was.
// - Once stopped (its slot closed), a sync changes nothing more, even when a call it made
//   earlier answers later; the next sync of that slot picks up its pending upload.

import { SAVE_VERSION, loadSave, type GameState } from "../sim/index.ts";
import type { CloudApi, CloudRow } from "./cloud.ts";
import type { SaveStore, StorageLike, WriteResult } from "./store.ts";

/**
 * offline: the cloud can't be reached (or answered unclearly). busy: no room for a new
 * code just now. refused: the cloud won't take this save. future: the cloud save is from
 * a newer game. gone: the code's cloud save has disappeared. storage: this device
 * couldn't store what the sync needs.
 */
export type SyncFailure = "offline" | "busy" | "refused" | "future" | "gone" | "storage";

export type SyncStatus =
  | { kind: "synced"; at: string }
  | { kind: "pending"; at: string | null }
  | { kind: "failed"; reason: SyncFailure; at: string | null }
  | { kind: "conflict"; at: string | null };

export interface Conflict {
  device: GameState | null;
  /** null when the cloud save can't be read by this version of the game. */
  cloud: GameState | null;
  cloudAt: string;
}

/** The slot's game, as the sync sees it. */
export interface SyncHost {
  /** The slot's current save text. */
  text(): string | null;
  state(): GameState | null;
  /**
   * Replaces the device's run with the cloud's, keeping the run in play as the recovery
   * copy. False if either couldn't be stored; nothing changes then.
   */
  adopt(state: GameState): boolean;
  /** Keeps a text as the slot's recovery copy. False if it couldn't be stored. */
  keep(text: string): boolean;
  /** Stores the run in play if its last write failed. False if it still isn't stored. */
  persist(): boolean;
  /** Whether the run in play is this state and is stored as it is. */
  same(state: GameState): boolean;
}

/** An upload, stored before it is sent, so it can be sent again exactly as it was. */
export interface Sent {
  upload: string;
  base: number | null;
  /** The local write count it covers. */
  rev: number;
  text: string;
}

/** What the slot knows of the cloud, stored beside its save. */
export interface Meta {
  base: number | null;
  /** The save has changes the cloud hasn't acknowledged. */
  dirty: boolean;
  /** Counts local writes, so an acknowledgement covers only what was sent. */
  rev: number;
  /** The upload in flight or of unknown outcome. */
  sent: Sent | null;
  /** The server time of the last acknowledged sync. */
  synced: string | null;
  /** The slot's run stands in for a save that was missing, unreadable or recovered. */
  blank: boolean;
  /** The cloud was seen without a save under the code after it had acknowledged one. */
  missing: boolean;
}

export const metaKey = (prefix: string): string => `${prefix}.cloud`;
const EMPTY: Meta = { base: null, dirty: false, rev: 0, sent: null, synced: null, blank: false, missing: false };

export function readMeta(storage: StorageLike, prefix: string): Meta {
  try {
    const raw = storage.getItem(metaKey(prefix));
    if (raw === null) return { ...EMPTY };
    const m = JSON.parse(raw) as Partial<Meta>;
    const s = m.sent;
    const sent =
      s && typeof s.upload === "string" && typeof s.text === "string" && typeof s.rev === "number"
        ? { upload: s.upload, base: typeof s.base === "number" ? s.base : null, rev: s.rev, text: s.text }
        : null;
    return {
      base: typeof m.base === "number" ? m.base : null,
      dirty: m.dirty === true || (s !== undefined && s !== null && sent === null),
      rev: typeof m.rev === "number" ? m.rev : 0,
      sent,
      synced: typeof m.synced === "string" ? m.synced : null,
      blank: m.blank === true,
      missing: m.missing === true,
    };
  } catch {
    // Unreadable: assume unsent changes, so nothing is lost and a conflict asks first.
    return { ...EMPTY, dirty: true };
  }
}

export function writeMeta(storage: StorageLike, prefix: string, meta: Meta): boolean {
  try {
    storage.setItem(metaKey(prefix), JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

export interface SyncOptions {
  makeId: () => string;
  /** Waits this long after a write before uploading, so quick moves go up together. */
  delay?: number;
  timer?: (fn: () => void, ms: number) => () => void;
}

const defaultTimer = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/** Upload and fetch rounds one kick may take before it gives up until the next. */
const MAX_ROUNDS = 4;

export class CloudSync {
  private readonly code: string;
  private readonly cloud: CloudApi;
  private readonly storage: StorageLike;
  private readonly prefix: string;
  private readonly host: SyncHost;
  private readonly makeId: () => string;
  private readonly delay: number;
  private readonly timer: (fn: () => void, ms: number) => () => void;

  private meta: Meta;
  private error: SyncFailure | null = null;
  private row: CloudRow | null = null;
  private conflictView: Conflict | null = null;
  private queued: "upload" | "check" | null = null;
  private running: Promise<void> | null = null;
  private cancel: (() => void) | null = null;
  private stopped = false;
  /** Local writes while set are the sync's own (adopting the cloud, opening the slot). */
  quiet = false;
  private listeners = new Set<() => void>();
  private snap: SyncStatus;

  constructor(code: string, cloud: CloudApi, storage: StorageLike, prefix: string, host: SyncHost, options: SyncOptions) {
    this.code = code;
    this.cloud = cloud;
    this.storage = storage;
    this.prefix = prefix;
    this.host = host;
    this.makeId = options.makeId;
    this.delay = options.delay ?? 2000;
    this.timer = options.timer ?? defaultTimer;
    this.meta = readMeta(storage, prefix);
    // A cloud save last seen missing stays missing until the cloud shows one again.
    if (this.meta.missing) this.error = "gone";
    this.snap = this.compute();
  }

  // ---- Observing -----------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  status = (): SyncStatus => this.snap;

  /** The two runs to choose between, while there is a conflict. */
  conflict = (): Conflict | null => this.conflictView;

  private emit(): void {
    if (this.stopped) return;
    this.snap = this.compute();
    for (const l of this.listeners) l();
  }

  /** Whether the cloud was seen without the code's save, so the run can be put back. */
  missing = (): boolean => this.meta.missing;

  private compute(): SyncStatus {
    const at = this.meta.synced;
    if (this.row) return { kind: "conflict", at };
    if (this.error) return { kind: "failed", reason: this.error, at };
    if (this.meta.dirty || this.meta.sent || this.meta.blank || this.running) return { kind: "pending", at };
    return at ? { kind: "synced", at } : { kind: "pending", at };
  }

  // ---- Driving -------------------------------------------------------------------

  /**
   * Before a local write: the save is about to differ from the cloud. False if that
   * couldn't be recorded, and then the write must not happen.
   */
  touch(): boolean {
    if (this.quiet || this.stopped) return true;
    this.meta.rev += 1;
    this.meta.dirty = true;
    if (this.save()) return true;
    this.fail("storage");
    return false;
  }

  /**
   * The slot opened without a playable run and plays a fresh one: the cloud's run comes
   * first. False if that couldn't be recorded.
   */
  markBlank(): boolean {
    this.meta.blank = true;
    if (this.save()) {
      this.emit();
      return true;
    }
    // Unmarked, the stand-in could later pass for the cloud's run: this slot doesn't
    // sync at all this time, and says why.
    this.fail("storage");
    this.stop();
    return false;
  }

  /** After a local write: upload soon. */
  schedule(): void {
    if (this.stopped || this.quiet) return;
    this.emit();
    if (this.cancel) return;
    this.cancel = this.timer(() => {
      this.cancel = null;
      this.kick("upload");
    }, this.delay);
  }

  /** Uploads now if anything is unsent (day end, page hide). */
  flush(): void {
    this.cancel?.();
    this.cancel = null;
    if (this.meta.dirty || this.meta.sent !== null) this.kick("upload");
  }

  /** Fetches the cloud save and compares (start, return to the foreground, reconnect). */
  check(): Promise<void> {
    this.kick("check");
    return this.idle();
  }

  /** Resolves when nothing is in flight. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** The slot closed: nothing this sync does from now on changes anything. */
  stop(): void {
    this.stopped = true;
    this.cancel?.();
    this.cancel = null;
  }

  /**
   * Settles a conflict: keep this device's run or the cloud's. False if this device
   * couldn't store the choice; the conflict then stays open.
   */
  resolve(keep: "device" | "cloud"): boolean {
    const row = this.row;
    if (!row || this.stopped) return false;
    if (keep === "cloud") {
      const r = loadSave(row.text);
      if (!r.ok || !this.adopt(row, r.state)) return false;
      this.row = this.conflictView = null;
      this.emit();
      return true;
    }
    // The run in play is what goes up, so it must be stored; the cloud's run is kept on
    // this device before this one replaces it.
    if (
      !this.host.persist() ||
      !this.host.keep(row.text) ||
      !this.commit({ ...this.meta, base: row.revision, dirty: true, sent: null, blank: false, missing: false })
    ) {
      this.fail("storage");
      return false;
    }
    this.row = this.conflictView = null;
    this.kick("upload");
    return true;
  }

  /**
   * The code's cloud save disappeared: put this device's run back under the code. It is
   * a new save there, whose revisions no device's old base can match (cnc.put_save). The
   * run in play goes up, so it is stored first. False if it couldn't be: the save stays
   * missing, and putting it back can be tried again.
   */
  restore(): boolean {
    if (!this.meta.missing || this.stopped) return false;
    if (!this.host.persist() || !this.commit({ ...this.meta, base: null, dirty: true, sent: null, blank: false, missing: false })) {
      this.fail("storage");
      return false;
    }
    this.error = null;
    this.kick("upload");
    return true;
  }

  // ---- Internals -----------------------------------------------------------------

  private kick(kind: "upload" | "check"): void {
    if (this.stopped) return;
    this.queued = kind === "check" || this.queued === "check" ? "check" : "upload";
    if (!this.running) this.running = this.loop();
    this.emit();
  }

  private async loop(): Promise<void> {
    try {
      while (this.queued && !this.stopped) {
        const kind = this.queued;
        this.queued = null;
        if (kind === "check") await this.fetchAndCompare(0);
        else await this.upload(0);
      }
    } finally {
      this.running = null;
      this.emit();
    }
  }

  private async fetchAndCompare(round: number): Promise<void> {
    if (round >= MAX_ROUNDS) return this.fail("offline");
    const f = await this.cloud.fetch(this.code);
    if (this.stopped) return;
    if (!f.ok) return this.fail("offline");
    const row = f.row;
    const m = this.meta;
    if (row && m.missing) {
      m.missing = false;
      this.save();
    }
    if (row && row.formatVersion > SAVE_VERSION) return this.fail("future");
    this.error = null;
    this.row = this.conflictView = null;

    if (m.sent) {
      const sent = m.sent;
      if (row && row.uploadId === sent.upload) {
        this.ack(row.revision, row.updatedAt, sent.rev);
      } else if ((row?.revision ?? null) === sent.base) {
        // It hasn't landed, and still can: send it again exactly as it was.
        return this.send(sent, round + 1);
      } else {
        // Its base has moved on, so it can never land.
        m.sent = null;
        this.save();
      }
    }

    if (!row) {
      // A code whose save was never acknowledged is new: its first save goes up (there is
      // no cloud run to wait for). One that was acknowledged has lost its cloud save: the
      // player decides (restore).
      if (m.base !== null) return this.fail(this.noSave() ? "gone" : "storage");
      m.dirty = true;
      m.blank = false;
      this.save();
      return this.upload(round + 1);
    }
    // A fresh run standing in for a missing save is never the cloud's run, whatever the base.
    if (row.revision === m.base && !m.blank) return m.dirty ? this.upload(round + 1) : this.emit();
    // Nothing unsent, or the stored run already is the cloud's (a record that missed an
    // earlier adoption): take it, which for the same run only updates the record.
    const cloud = loadSave(row.text);
    if (cloud.ok && (!m.dirty || this.host.same(cloud.state))) {
      this.adopt(row, cloud.state);
      return this.emit();
    }
    // The cloud moved on while this device has unsent moves, or it can't be read.
    this.row = row;
    this.conflictView = { device: this.host.state(), cloud: cloud.ok ? cloud.state : null, cloudAt: row.updatedAt };
    this.emit();
  }

  private async upload(round: number): Promise<void> {
    if (round >= MAX_ROUNDS) return this.fail("offline");
    const m = this.meta;
    // A pending upload goes first, exactly as it was.
    if (m.sent) return this.send(m.sent, round);
    if (!m.dirty || this.row || m.missing || this.error === "future" || this.error === "gone") return this.emit();
    // A fresh run standing in for a missing save waits for the cloud's run.
    if (m.blank) return this.fetchAndCompare(round + 1);
    const text = this.host.text();
    if (text === null) return this.emit();
    const sent: Sent = { upload: this.makeId(), base: m.base, rev: m.rev, text };
    m.sent = sent;
    // Never send what couldn't be recorded first: its outcome would be unknowable.
    if (!this.save()) {
      m.sent = null;
      return this.fail("storage");
    }
    this.emit();
    return this.send(sent, round);
  }

  private async send(sent: Sent, round: number): Promise<void> {
    if (round >= MAX_ROUNDS) return this.fail("offline");
    const r = await this.cloud.put(this.code, sent.base, sent.upload, sent.text);
    if (this.stopped) return;
    const m = this.meta;
    if (!r.ok) {
      // Unclear: it stays pending and is sent again next time.
      if (r.reason === "unclear") return this.fail("offline");
      m.sent = null;
      this.save();
      return this.fail(r.reason);
    }
    if (r.outcome === "saved") {
      this.ack(r.revision, r.updatedAt, sent.rev);
      // Moves made while it was in flight go up next.
      if (m.dirty) return this.upload(round + 1);
      return this.emit();
    }
    m.sent = null;
    this.save();
    // A null conflict revision reports a missing cloud save, even if the next read fails.
    if (r.revision === null && !this.noSave()) return this.fail("storage");
    return this.fetchAndCompare(round + 1);
  }

  private ack(revision: number, at: string, rev: number): void {
    const m = this.meta;
    m.base = revision;
    m.synced = at;
    m.sent = null;
    m.missing = false;
    if (m.rev === rev) m.dirty = false;
    this.error = null;
    // If this fails, the upload stays pending on disk; resending it is answered as saved.
    this.save();
  }

  /**
   * Takes the cloud's run. The base moves only once the run is safely on the device. If the
   * stored run already is that run, only the record moves: replacing it again would put
   * the same run in its recovery copy, over the run an earlier choice kept there.
   */
  private adopt(row: CloudRow, state: GameState): boolean {
    this.quiet = true;
    let ok: boolean;
    try {
      ok = this.host.same(state) || this.host.adopt(state);
    } finally {
      this.quiet = false;
    }
    if (!ok) {
      this.fail("storage");
      return false;
    }
    // The run is in play, so this session goes on from its base even if the record can't
    // be stored; a reload then sees the adopted run under the old base and adopts again.
    this.meta = { ...this.meta, base: row.revision, dirty: false, sent: null, synced: row.updatedAt, blank: false, missing: false };
    this.error = null;
    if (!this.save()) this.fail("storage");
    return true;
  }

  /**
   * A read or upload reported that an acknowledged cloud save is missing. Record that so
   * a reload still knows. False if the write failed; the next such answer tries it again.
   */
  private noSave(): boolean {
    const m = this.meta;
    if (m.base === null) return true;
    m.missing = true;
    return this.save();
  }

  /** Stores a new record and takes it on; on failure the old one stays, in memory too. */
  private commit(next: Meta): boolean {
    if (this.stopped || !writeMeta(this.storage, this.prefix, next)) return false;
    this.meta = next;
    return true;
  }

  private fail(reason: SyncFailure): void {
    this.error = reason;
    this.emit();
  }

  private save(): boolean {
    if (this.stopped) return false;
    return writeMeta(this.storage, this.prefix, this.meta);
  }
}

/** A slot's store that tells the sync about every local write. */
export function syncedStore(inner: SaveStore, sync: CloudSync): SaveStore {
  return {
    ...inner,
    write(state): WriteResult {
      // A move the record can't mark as unsent isn't saved, or a reload would take it for synced.
      if (!sync.touch()) return { ok: false, reason: "full" };
      const r = inner.write(state);
      if (r.ok) sync.schedule();
      return r;
    },
  };
}
