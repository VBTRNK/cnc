// Which goods this build trades: the game's own, or a 12-good test catalogue that proves the
// screens' layouts with a long goods list (#29) before the real catalogue (#18) is chosen.
// Only `vite build --mode goods12` selects the test catalogue, and in Node an environment of
// CNC_CATALOGUE=test12 (the browser check's --goods12 run); every other build plays the game's.

declare const __CNC_CATALOGUE__: string | undefined;

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const chosen = typeof __CNC_CATALOGUE__ === "string" ? __CNC_CATALOGUE__ : env?.CNC_CATALOGUE;

export const CATALOGUE: "game" | "test12" = chosen === "test12" ? "test12" : "game";
