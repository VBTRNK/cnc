import { useEffect, useRef } from "react";
import { RULES, type Paper } from "../sim/index.ts";
import { Chip } from "./bits.tsx";
import { clock, money, t } from "./text.ts";
import { heatText } from "./words.ts";

interface CellsProps {
  paper: Paper;
  /** What happened, from the action that ended in the arrest; empty after a reload. */
  lines: readonly string[];
  onDone: () => void;
}

/** After an arrest, before the paper: the bars come down and the cost is spelled out. */
export function CellsScreen({ paper, lines, onDone }: CellsProps) {
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headRef.current?.focus();
  }, [paper.day]);

  const { log } = paper;
  return (
    <article className="cells">
      <div className="bars" aria-hidden="true">
        <span className="bars-rail" />
      </div>
      <h1 ref={headRef} tabIndex={-1} className="headline">
        {t("cells.head")}
      </h1>
      {lines.length > 0 && (
        <p className="result">
          <mark>{lines.join(" ")}</mark>
        </p>
      )}
      <p className="chips-line cells-chips">
        {log.seized > 0 && <Chip warn>{t("paper.chip.seized", { n: log.seized })}</Chip>}
        <Chip warn>{t("paper.chip.fine", { amount: money(log.fine) })}</Chip>
        <Chip>{t("paper.chip.cash", { amount: money(paper.cash) })}</Chip>
        <Chip>{t("paper.chip.heat", { word: heatText(paper.heat) })}</Chip>
        <Chip>{t("cells.out", { time: clock(RULES.arrestStart) })}</Chip>
      </p>
      <button type="button" className="commit" onClick={onDone}>
        {t("cells.go")}
      </button>
    </article>
  );
}
