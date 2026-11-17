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
