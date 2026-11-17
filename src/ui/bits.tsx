import type { ReactNode } from "react";
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
