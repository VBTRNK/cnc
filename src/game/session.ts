// The running game between the simulation, the save store and React. Framework-free:
// React reads snapshots through subscribe/getSnapshot and sends actions to dispatch. The
// world advances only through `step`; opening, reloading or drawing never does.

import { loadSave, newGame, step, toSave, type Action, type DomainEvent, type GameState, type Refusal } from "../sim/index.ts";
import type { Opened, SaveStore, WriteResult } from "./store.ts";

export type SaveStatus = "saved" | "full" | "failed" | "off";
export type Notice = "recovered" | "lost" | "imported" | "newRun" | "fromCloud";
export type ImportError = "notSave" | "future" | "damaged" | "tooBig";

export interface Snapshot {
  /** play: this tab writes. watch: another tab writes; this one follows. future: a newer save. */
  mode: "play" | "watch" | "future";
  /** null only in future mode. */
  state: GameState | null;
  /** Domain events of the last action in this tab, for its one-line result. */
  events: readonly DomainEvent[];
  refusal: Refusal | null;
  save: SaveStatus;
  notice: Notice | null;
}

export interface SessionOptions {
  writer: boolean;
  makeSeed: () => number;
  makeId: () => string;
}

const MAX_IMPORT = 1_000_000;

export class GameSession {
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  private readonly store: SaveStore;
  private readonly options: SessionOptions;

  constructor(store: SaveStore, options: SessionOptions) {
    this.store = store;
    this.options = options;
    this.snap = { mode: "play", state: null, events: [], refusal: null, save: "saved", notice: null };
    this.begin(store.open(), options.writer);
  }

  // ---- React's side --------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snap;

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  // ---- Playing -------------------------------------------------------------------

  dispatch = (action: Action): boolean => {
    const { mode, state } = this.snap;
    if (mode !== "play" || !state) return false;
    const r = step(state, action);
    if (!r.ok) {
      this.set({ refusal: r.reason, events: [] });
      return false;
    }
    this.set({ state: r.state, events: r.events, refusal: null, save: this.persist(r.state) });
    return true;
  };

  dismissNotice = (): void => this.set({ notice: null });

  /** The save as a file's text: the running state, or a newer save this tab can't play. */
  exportText = (): string | null => (this.snap.state ? toSave(this.snap.state) : this.store.peek());

  /** The damaged or pre-migration save kept aside, if any. */
  keptText = (): string | null => this.store.kept();

  /** The run that an import, a new run or a cloud save last displaced, if any. */
  recoveryText = (): string | null => this.store.replaced();

  /** Reads an imported file. Nothing changes until `replace`. */
  readImport(text: string): { ok: true; state: GameState } | { ok: false; error: ImportError } {
    if (text.length > MAX_IMPORT) return { ok: false, error: "tooBig" };
    const r = loadSave(text);
    if (r.ok) return { ok: true, state: r.state };
    return { ok: false, error: r.error === "corrupt" ? "notSave" : r.error === "future" ? "future" : "damaged" };
  }

  /**
   * Replaces the run, keeping the run in play (even moves whose save failed) as the
   * recovery copy. All or nothing: if that copy can't be kept or the new run can't be
   * saved, the current run stays in play (with the save status showing the failure) and
   * the result is false.
   */
  replace(state: GameState, notice: Notice): boolean {
    if (this.snap.mode !== "play") return false;
    const off = this.snap.save === "off";
    const current = this.snap.state;
    if (!off && !(current ? this.store.keep(toSave(current)) : this.store.keepForRecovery()).ok) return false;
    const save = this.persist(state);
    if (!off && save !== "saved") {
      this.set({ save });
      return false;
    }
    this.set({ state, events: [], refusal: null, notice, save });
    return true;
  }

  newRun = (): boolean => this.replace(this.fresh(), "newRun");

  /** Stores the run in play again if its last write failed. True once it is stored. */
  saveNow = (): boolean => {
    const { mode, state, save } = this.snap;
    if (mode !== "play" || !state || save === "off") return false;
    if (save === "saved") return true;
    const again = this.persist(state);
    this.set({ save: again });
    return again === "saved";
  };

  // ---- Tabs ----------------------------------------------------------------------

  /** Another tab wrote the save: a watching tab follows it. */
  follow = (): void => {
    if (this.snap.mode !== "watch") return;
    const text = this.store.peek();
    if (text === null) return;
    const r = loadSave(text);
    if (r.ok) this.set({ state: r.state, events: [] });
    else if (r.error === "future") this.set({ mode: "future", state: null });
  };

  /** The writing tab closed: this one takes over from what it saved. */
  takeOver = (): void => {
    if (this.snap.mode !== "watch") return;
    this.begin(this.store.open(), true);
  };

  // ---- Internals -----------------------------------------------------------------

  private fresh(): GameState {
    return newGame(this.options.makeSeed(), this.options.makeId());
  }

  private persist(state: GameState): SaveStatus {
    if (this.snap.save === "off") return "off";
    return status(this.store.write(state));
  }

  private begin(opened: Opened, writer: boolean): void {
    const mode = writer ? "play" : "watch";
    const base: Pick<Snapshot, "events" | "refusal" | "notice"> = { events: [], refusal: null, notice: null };
    switch (opened.kind) {
      case "future":
        return this.set({ ...base, mode: "future", state: null, save: "saved" });
      case "unavailable":
        return this.set({ ...base, mode: "play", state: this.fresh(), save: "off" });
      case "loaded": {
        this.set({ ...base, mode, state: opened.state, save: "saved" });
        // A migrated save is written in the current format; the store kept the original.
        if (writer && opened.migratedFrom !== null) this.set({ save: this.persist(opened.state) });
        return;
      }
      case "recovered":
      case "lost":
      case "empty": {
        const state = opened.kind === "recovered" ? opened.state : this.fresh();
        const notice = opened.kind === "empty" ? null : opened.kind;
        this.set({ ...base, mode, state, notice: writer ? notice : null, save: "saved" });
        if (writer) this.set({ save: this.persist(state) });
        return;
      }
    }
  }
}

const status = (r: WriteResult): SaveStatus => (r.ok ? "saved" : r.reason === "full" ? "full" : "failed");
