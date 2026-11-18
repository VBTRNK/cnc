import { claimWriter, type LocksLike } from "./tabs.ts";

// One writing tab, and whether a held lock keeps it that way (review 3, H5).

/** A Locks API whose writer lock is free, taken, or whose requests fail. */
function locks(state: "free" | "taken" | "broken"): LocksLike {
  return {
    request(_name: string, a: unknown, b?: unknown) {
      if (state === "broken") return Promise.reject(new Error("SecurityError"));
      const callback = (typeof a === "function" ? a : b) as (lock: unknown) => unknown;
      if (typeof a === "function") return new Promise(() => {}); // waits for the lock
      void callback(state === "free" ? {} : null);
      return Promise.resolve();
    },
  } as LocksLike;
}

describe("claiming the writing tab", () => {
  it("writes, coordinated, with the lock; follows, coordinated, without it", async () => {
    expect(await claimWriter(() => {}, locks("free"))).toEqual({ writer: true, coordinated: true });
    expect(await claimWriter(() => {}, locks("taken"))).toEqual({ writer: false, coordinated: true });
  });

  it("writes uncoordinated when there is no Locks API or the request fails", async () => {
    expect(await claimWriter(() => {}, null)).toEqual({ writer: true, coordinated: false });
    expect(await claimWriter(() => {}, locks("broken"))).toEqual({ writer: true, coordinated: false });
  });
});
