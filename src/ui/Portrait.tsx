import type { CastId } from "../sim/index.ts";
import copper from "./portraits/copper.svg";
import lenny from "./portraits/lenny.svg";
import mags from "./portraits/mags.svg";
import pinch from "./portraits/pinch.svg";
import reg from "./portraits/reg.svg";
import stranger from "./portraits/stranger.svg";

/** Who a portrait shows: the cast, the beat copper, or a stranger met on a card. */
export type Sitter = CastId | "copper" | "stranger";

/** Pre-made ink drawings, served as same-origin files (docs/design.md, "Portraits"). */
const FILES: Record<Sitter, string> = { copper, lenny, mags, pinch, reg, stranger };

/** An ink portrait on a halftone ground. Decorative: the name is always beside it. */
export function Portrait({ who, small = false }: { who: Sitter; small?: boolean }) {
  return (
    <div className={small ? "portrait portrait-small" : "portrait"} aria-hidden="true">
      <img src={FILES[who]} alt="" width={120} height={140} draggable={false} />
    </div>
  );
}
