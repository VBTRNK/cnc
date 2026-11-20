import { RULES, carried, hoursLeft, pockets, type GameState } from "../sim/index.ts";
import { Chip, DAY_HOURS, HeatChip, Marks } from "./bits.tsx";
import { money, t } from "./text.ts";

/** Cash, pockets, heat and the day: the top of every play screen. */
export function Status({ state }: { state: GameState }) {
  const left = state.phase === "day" ? hoursLeft(state) : 0;
  return (
    <header className="status">
      <div className="status-top">
        <span className="cash">{money(state.cash)}</span>
        <span className="status-chips">
          <Chip>{t("status.pockets", { used: carried(state), size: pockets(state) })}</Chip>
          <HeatChip heat={state.heat} />
        </span>
      </div>
      <div className="daybar">
        <span>{t("status.day", { day: state.day })}</span>
        <Marks className="hours" filled={state.hour - RULES.dayStart} total={DAY_HOURS} />
        <span>{left > 0 ? t("status.hoursLeft", { hours: left }) : t("status.dayOver")}</span>
      </div>
    </header>
  );
}

/**
 * The last move's result at the foot of the rail. It stays in view: with the rail where the
 * rail sticks, on its own where the rail scrolls away (docs/design.md, "Look and feel").
 */
export function ResultStrip({ lines }: { lines: readonly string[] }) {
  return (
    <div className="strip" role="status">
      {lines.length > 0 && (
        <p className="result">
          <mark>{lines.join(" ")}</mark>
        </p>
      )}
    </div>
  );
}
