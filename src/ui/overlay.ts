import type { GoodId, UpgradeId } from "../sim/index.ts";

/** The one sheet that may be open. Overlays never stack; a stop card replaces any sheet. */
export type Overlay =
  | { kind: "trade"; good: GoodId }
  | { kind: "job" }
  | { kind: "callDay" }
  | { kind: "upgrade"; upgrade: UpgradeId }
  | { kind: "save" };
