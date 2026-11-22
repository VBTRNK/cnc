// What the player knows about the city: active events (announced in the paper or the
// midday brief), and prices live where you stand, else as last seen, tipped or rung round.

import {
  price,
  priceHint,
  usualPrice,
  type GameState,
  type GoodId,
  type MarketKind,
  type PlaceId,
} from "../sim/index.ts";
import { t } from "./text.ts";
import { seenText } from "./words.ts";

/** The active shortage or glut on a place and good, if any. Active events are public. */
export function eventAt(s: GameState, place: PlaceId, good: GoodId): MarketKind | null {
  for (const e of s.events) {
    if (e.activated && (e.kind === "shortage" || e.kind === "glut") && e.place === place && e.good === good) {
      return e.kind;
    }
  }
  return null;
}

export const sweepAt = (s: GameState, place: PlaceId): boolean =>
  s.events.some((e) => e.activated && e.kind === "sweep" && e.place === place);

export type Hint = "cheap" | "pricey" | null;

/** The hint for a remembered price, by the same thresholds as the sim's. */
export function hintFor(good: GoodId, p: number): Hint {
  const ratio = p / usualPrice(good);
  if (ratio <= 0.8) return "cheap";
  if (ratio >= 1.2) return "pricey";
  return null;
}

export interface PriceView {
  price: number | null;
  hint: Hint;
  /** When the price was seen; null when live (where you stand). */
  seen: { day: number; hour: number } | null;
  low: boolean;
  soldOut: boolean;
}

/** A place's price for a good as the player knows it. */
export function knownPrice(s: GameState, place: PlaceId, good: GoodId): PriceView {
  if (place === s.place) {
    const cell = s.market[place][good];
    return {
      price: price(s, place, good),
      hint: priceHint(s, place, good),
      seen: null,
      low: cell.stock > 0 && cell.stock <= Math.max(1, Math.floor(cell.freshStock / 4)),
      soldOut: cell.stock === 0,
    };
  }
  const m = s.memory[place][good];
  if (!m) return { price: null, hint: null, seen: null, low: false, soldOut: false };
  return { price: m.price, hint: hintFor(good, m.price), seen: { day: m.day, hour: m.hour }, low: false, soldOut: false };
}

/** One note for Street and City. A null view marks an undealt good. */
export function marketNote(
  s: GameState, place: PlaceId, good: GoodId, view: PriceView | null, newest: PriceView["seen"] = null,
): { text: string; warn: boolean } | null {
  if (!view) {
    return place === s.place && s.held[good] > 0 ? { text: t("note.noBuyers"), warn: true } : null;
  }
  const event = eventAt(s, place, good);
  if (view.soldOut) return { text: t("note.soldOut"), warn: true };
  if (event === "shortage") return { text: t("note.short"), warn: true };
  if (view.low) return { text: t("note.fewLeft"), warn: false };
  if (event === "glut") return { text: t("note.glut"), warn: false };
  if (view.price === null) return null;
  if (view.seen && newest && (view.seen.day !== newest.day || view.seen.hour !== newest.hour)) {
    return { text: seenText(s, view.seen.day, view.seen.hour), warn: false };
  }
  return view.hint ? { text: t(`hint.${view.hint}`), warn: false } : null;
}

