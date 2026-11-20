import { useSyncExternalStore, type ReactNode } from "react";
import { RULES, heatWord, riskWord } from "../sim/index.ts";
import { t } from "./text.ts";

type ChipKind = "certain" | "chance" | "unknown";

/** Solid for a certain effect, dashed with a die for a chance, dashed with ? for unknown. */
export function Chip({ kind = "certain", warn = false, children }: { kind?: ChipKind; warn?: boolean; children: ReactNode }) {
  return (
    <span className={`chip chip-${kind} ${warn ? "chip-warn" : ""}`}>
      {kind === "chance" && <Die />}
      {kind === "unknown" && <span aria-hidden="true">?</span>}
      {children}
    </span>
  );
}

function Die() {
  return (
    <svg className="die" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="5" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="11" cy="11" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function RiskChip({ chance }: { chance: number }) {
  const word = riskWord(chance);
  return (
    <Chip kind="chance" warn={word === "real" || word === "high"}>
      {t("risk.chip", { word: t(`risk.${word}`) })}
    </Chip>
  );
}

export function HeatChip({ heat }: { heat: number }) {
  const word = heatWord(heat);
  return <Chip warn={word === "hot" || word === "wanted"}>{t("status.heat", { word: t(`heat.${word}`) })}</Chip>;
}

/** Filled marks out of a total, e.g. skill levels or the day's hours. Decorative. */
export function Marks({ filled, total, className }: { filled: number; total: number; className: string }) {
  return (
    <span className={className} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < filled ? "mark mark-on" : "mark"} />
      ))}
    </span>
  );
}

export const DAY_HOURS = RULES.dayEnd - RULES.dayStart;

/** A row's or a toggle's chevron. Decorative: the control's text says what it does. */
export function Chevron({ to = "right", className = "chev" }: { to?: "right" | "down" | "up"; className?: string }) {
  const d = to === "right" ? "M6 3l5 5-5 5" : to === "down" ? "M3 6l5 5 5-5" : "M3 10l5-5 5 5";
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/**
 * The narrow layout: below 22.25 rem wide, which is 356 px at default text or any phone with
 * large text (docs/design.md, "Look and feel"). Keep in step with the same query in styles.css.
 */
export const NARROW = "(max-width: 22.24rem)";

const narrowQuery = () => (typeof window === "undefined" ? null : window.matchMedia(NARROW));
const subscribeNarrow = (onChange: () => void) => {
  const q = narrowQuery();
  q?.addEventListener("change", onChange);
  return () => q?.removeEventListener("change", onChange);
};

/** True in the narrow layout, where screens put what the player came for first. */
export const useNarrow = (): boolean =>
  useSyncExternalStore(subscribeNarrow, () => narrowQuery()?.matches ?? false, () => false);
