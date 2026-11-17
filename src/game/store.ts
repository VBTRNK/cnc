// The local save store (docs/design.md, "Saves"; ADR-007). `localStorage` behind an
// interface, so tests and a later cloud layer can supply their own. The store keeps the
// latest snapshot twice (the save and its backup copy), keeps an original it migrated or
// could not read, and keeps the save a replacement displaced. It never overwrites a save
// from a newer version of the game.

import { loadSave, toSave, validateState, type GameState, type Migration } from "../sim/index.ts";

/** The part of the Web Storage API the store uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEYS = {
  save: "cnc.save",
  backup: "cnc.save.backup",
  /** The text of a save that was migrated or could not be read, as it was. */
  kept: "cnc.save.kept",
  /** The save an import or a new run replaced. */
  replaced: "cnc.save.replaced",
} as const;

export type Opened =
  | { kind: "empty" }
  | { kind: "loaded"; state: GameState; migratedFrom: number | null }
  /** The save could not be read; its backup copy could. */
  | { kind: "recovered"; state: GameState }
  /** Neither the save nor its backup could be read. Both texts are kept. */
  | { kind: "lost" }
  /** The save is from a newer version of the game; it is left untouched. */
  | { kind: "future"; version: number }
  /** This browser won't let the game store anything. */
  | { kind: "unavailable" };

export type WriteResult = { ok: true } | { ok: false; reason: "full" | "failed" | "blocked" };

export interface SaveStore {
  open(): Opened;
  /** The raw text of the current save, for a read-only tab to follow. */
  peek(): string | null;
  write(state: GameState): WriteResult;
  /** Keeps the current save as the recovery copy before something replaces it. */
  keepForRecovery(): WriteResult;
  /** The text kept from a save that couldn't be read or was migrated, if any. */
  kept(): string | null;
}

export interface StoreOptions {
  migrations?: Readonly<Record<number, Migration>>;
  current?: number;
}

const isQuota = (e: unknown): boolean =>
  e instanceof Error && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");

/** A store over Web Storage. `storage` is a getter because merely touching it can throw. */
export function webStore(storage: () => StorageLike, options: StoreOptions = {}): SaveStore {
  let resolved: StorageLike | null | undefined;
  // Set when the save on disk is from a newer version: nothing may overwrite it.
  let blocked = false;

  const db = (): StorageLike | null => {
    if (resolved === undefined) {
      try {
        resolved = storage();
        resolved.getItem(KEYS.save);
      } catch {
        resolved = null;
      }
    }
    return resolved;
  };
  const set = (key: string, value: string): WriteResult => {
    const store = db();
    if (!store) return { ok: false, reason: "failed" };
    try {
      store.setItem(key, value);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: isQuota(e) ? "full" : "failed" };
    }
  };
  const get = (key: string): string | null => {
    try {
      return db()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const load = (text: string) => loadSave(text, options);

  return {
    open(): Opened {
      if (!db()) return { kind: "unavailable" };
      const text = get(KEYS.save);
      const backup = get(KEYS.backup);
      if (text === null && backup === null) return { kind: "empty" };

      if (text !== null) {
        const r = load(text);
        if (r.ok) {
          if (r.migratedFrom !== null) set(KEYS.kept, text);
          return { kind: "loaded", state: r.state, migratedFrom: r.migratedFrom };
        }
        if (r.error === "future") {
          blocked = true;
          return { kind: "future", version: r.version ?? 0 };
        }
        set(KEYS.kept, text);
      }
      if (backup !== null) {
        const r = load(backup);
        if (r.ok) return { kind: "recovered", state: r.state };
        if (r.error === "future") {
          blocked = true;
          return { kind: "future", version: r.version ?? 0 };
        }
        if (text === null) set(KEYS.kept, backup);
      }
      return { kind: "lost" };
    },

    peek: () => get(KEYS.save),

    write(state) {
      if (blocked) return { ok: false, reason: "blocked" };
      // A state the loader would refuse is a bug; never let it replace a good save.
      if (validateState(state)) return { ok: false, reason: "failed" };
      const text = toSave(state);
      const first = set(KEYS.save, text);
      if (!first.ok) return first;
      return set(KEYS.backup, text);
    },

    keepForRecovery() {
      const text = get(KEYS.save);
      return text === null ? { ok: true } : set(KEYS.replaced, text);
    },

    kept: () => get(KEYS.kept),
  };
}

/** A store that keeps nothing, for a browser without usable storage. */
export const memoryStorage = (): StorageLike => {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
};
