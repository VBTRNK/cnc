// Seeded random numbers whose whole position is one 32-bit integer kept in the game
// state (mulberry32). The sim draws only through an Rng made from that state and writes
// the position back, so a reload continues exactly where the save left off.

export class Rng {
  state: number;

  constructor(state: number) {
    this.state = state;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Whole number in [lo, hi], inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }

  /** Roughly normal, mean 0 and standard deviation 1: a sum of six uniforms, so bounded at ±4.2. */
  normal(): number {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += this.next();
    return (sum - 3) / Math.SQRT1_2;
  }
}

/** A seed becomes the first generator position; any integer works. */
export const seedState = (seed: number): number => seed | 0;
