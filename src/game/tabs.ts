// One writing tab per browser (docs/design.md, "Saves"). The first tab holds a Web Lock
// for as long as it is open; a second tab follows the save read-only and takes over when
// the lock comes free. Without the Locks API (or if the request fails) every tab writes,
// as before it existed, but nothing then keeps a single writer: such a tab plays only the
// guest game, never a cloud code (ADR-009).

const LOCK = "cnc.writer";
const forever = () => new Promise<never>(() => {});

export interface Claim {
  /** This tab may write. */
  writer: boolean;
  /** A held Web Lock keeps this the only writing tab (or tells it another tab writes). */
  coordinated: boolean;
}

/** The part of the Web Locks API used here. */
export interface LocksLike {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<never> | undefined): Promise<unknown>;
  request(name: string, callback: () => Promise<never>): Promise<unknown>;
}

const browserLocks = (): LocksLike | undefined =>
  typeof navigator === "undefined" ? undefined : (navigator.locks as LocksLike | undefined);

/** Resolves to whether this tab may write. `onTakeOver` runs if it later may. */
export function claimWriter(onTakeOver: () => void, locks: LocksLike | null = browserLocks() ?? null): Promise<Claim> {
  const alone: Claim = { writer: true, coordinated: false };
  if (!locks) return Promise.resolve(alone);
  return new Promise((resolve) => {
    locks
      .request(LOCK, { ifAvailable: true }, (lock) => {
        if (lock) {
          resolve({ writer: true, coordinated: true });
          return forever();
        }
        resolve({ writer: false, coordinated: true });
        void locks.request(LOCK, () => {
          onTakeOver();
          return forever();
        });
        return undefined;
      })
      .catch(() => resolve(alone));
  });
}
