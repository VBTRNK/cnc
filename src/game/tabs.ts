// One writing tab per browser (docs/design.md, "Saves"). The first tab holds a Web Lock
// for as long as it is open; a second tab follows the save read-only and takes over when
// the lock comes free. Without the Locks API every tab writes, as before it existed.

const LOCK = "cnc.writer";
const forever = () => new Promise<never>(() => {});

/** Resolves true when this tab may write. `onTakeOver` runs if it later may. */
export function claimWriter(onTakeOver: () => void): Promise<boolean> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    locks
      .request(LOCK, { ifAvailable: true }, (lock) => {
        if (lock) {
          resolve(true);
          return forever();
        }
        resolve(false);
        void locks.request(LOCK, () => {
          onTakeOver();
          return forever();
        });
        return undefined;
      })
      .catch(() => resolve(true));
  });
}
