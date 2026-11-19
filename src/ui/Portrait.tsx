import type { CastId } from "../sim/index.ts";

/** Who a portrait shows: the cast, the beat copper, or a stranger met on a card. */
export type Sitter = CastId | "copper" | "stranger";

const SHOULDERS = "M10 140c2-24 18-38 38-42l12 10 12-10c20 4 36 18 38 42H10Z";
const FACE = "M37 60c2 20 11 33 23 33s21-13 23-33H37Z";
/** A brimmed hat over the face: Pinch's trilby, Lenny's fedora. */
const BRIM = "M38 44c2-16 10-24 22-24s20 8 22 24h14v8H24v-8h14Z";

const HEADS: Record<Sitter, string> = {
  copper: "M60 8c-17 0-29 12-31 34l-6 4v8h74v-8l-6-4C89 20 77 8 60 8Z",
  pinch: BRIM,
  lenny: BRIM,
  stranger: "M36 50c2-14 12-22 26-22 13 0 22 6 26 16l12 6H36Z",
  mags: "M34 62c0-24 12-38 26-38s26 14 26 38l-6 2c-2-14-10-22-20-22s-18 8-20 22l-6-2Zm18 30 8 10 8-10H52Z",
  reg: "M60 22c-14 0-24 10-24 30v8h48v-8c0-20-10-30-24-30Zm-30 36c-4 0-6 4-4 8l8 6V58h-4Zm60 0h-4v14l8-6c2-4 0-8-4-8Zm-40 34c4 4 16 4 20 0l4 6H46l4-6Z",
};

/** An ink silhouette on a halftone ground. Decorative: the name is always beside it. */
export function Portrait({ who, small = false }: { who: Sitter; small?: boolean }) {
  return (
    <div className={small ? "portrait portrait-small" : "portrait"} aria-hidden="true">
      <svg viewBox="0 0 120 140" focusable="false">
        <path fill="currentColor" d={`${HEADS[who]} ${FACE} ${SHOULDERS}`} />
        {who === "copper" && <rect className="badge" x="52" y="24" width="16" height="14" />}
        {who === "lenny" && <rect className="badge" x="66" y="36" width="12" height="8" />}
      </svg>
    </div>
  );
}
