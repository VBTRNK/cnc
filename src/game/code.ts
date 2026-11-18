// Cloud codes (docs/design.md, "Cloud saves"): 16 characters of Crockford base32, 80
// random bits, shown in groups of four. The code is the only key to a cloud save, so it
// is long enough that guessing one is hopeless. Typing is forgiving: case, spaces and
// dashes don't matter, and O, I and L read as 0, 1 and 1.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 16;

/** A new random code, in its canonical form (no dashes). */
export function newCode(random: (count: number) => Uint8Array): string {
  const bytes = random(LENGTH);
  // 256 is a multiple of 32, so taking each byte mod 32 is unbiased.
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
}

/** The canonical form of what a player typed, or null if it isn't a code. */
export function normalizeCode(typed: string): string | null {
  const code = typed
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return code.length === LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** "7KQF-M2XD-9HPA-T4WN": the code as the player reads it. */
export const showCode = (code: string): string => code.match(/.{1,4}/g)?.join("-") ?? code;
