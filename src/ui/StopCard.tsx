import { GOODS, RULES, type Action, type GameState, type PendingStop } from "../sim/index.ts";
import { Chip } from "./bits.tsx";
import { Portrait } from "./Portrait.tsx";
import { Sheet } from "./Sheet.tsx";
import { codename, goodValues, money, t } from "./text.ts";
import { oddsText } from "./words.ts";

interface StopCardProps {
  state: GameState;
  stop: PendingStop;
  dispatch: (action: Action) => void;
  readOnly: boolean;
}

/** A police stop: a saved card that blocks until the player chooses. */
export function StopCard({ state, stop, dispatch, readOnly }: StopCardProps) {
  const q = stop.quote;
  const kind = q.type;
  // Inside his operation the stop is Pinch himself.
  const pinch = stop.bribeRefusal === "pinch";
  const op = { Codename: codename(state.detective.case?.n ?? 1) };
  const situation = pinch
    ? q.type === "sell"
      ? t("stop.pinch.sell", { ...op, ...goodValues(q.good) })
      : t("stop.pinch.job", op)
    : q.type === "sell"
      ? t("stop.sell", goodValues(q.good))
      : t("stop.job");
  const who = pinch ? t(state.detective.promoted ? "people.pinch.inspector" : "people.pinch.sergeant") : t("stop.who");
  const choose = (choice: "bribe" | "legIt" | "handOver") => dispatch({ type: "resolveStop", choice });
  const carrying = GOODS.some((g) => state.held[g] > 0);

  return (
    <Sheet label={t("stop.stamp")} blocking className="card">
      <div className="dossier">
        <Portrait who={pinch ? "pinch" : "copper"} />
        <div className="dossier-text">
          <p className="stamp">{t("stop.stamp")}</p>
          <p className="dossier-who">{who}</p>
          <p>{situation}</p>
        </div>
      </div>

      <fieldset className="choices" disabled={readOnly}>
        <button
          type="button"
          className="choice-card"
          disabled={stop.bribe === null}
          onClick={() => choose("bribe")}
        >
          <span className="choice-title">{t("stop.bribe")}</span>
          {stop.bribe === null ? (
            <span className="choice-after">{t(`stop.bribe.${stop.bribeRefusal ?? "short"}`)}</span>
          ) : (
            <>
              <span className="choice-after">{t(`stop.bribe.after.${kind}`)}</span>
              <span className="action-chips">
                <Chip kind="chance">{oddsText(stop.bribeOdds)}</Chip>
                <Chip>{t("chip.cost", { amount: money(stop.bribe) })}</Chip>
                <Chip>{t("chip.heat", { heat: RULES.bribeHeat })}</Chip>
              </span>
            </>
          )}
        </button>

        <button type="button" className="choice-card" onClick={() => choose("legIt")}>
          <span className="choice-title">{t("stop.legIt")}</span>
          <span className="choice-after">{t("stop.legIt.after", { heat: RULES.legItHeat })}</span>
          <span className="action-chips">
            <Chip kind="chance">{oddsText(q.legIt)}</Chip>
          </span>
        </button>

        <button type="button" className="choice-card" onClick={() => choose("handOver")}>
          <span className="choice-title">{t("stop.handOver")}</span>
          <span className="choice-after">{t(`stop.handOver.after.${kind}`)}</span>
          {carrying && (
            <span className="action-chips">
              <Chip warn>{t("chip.goods")}</Chip>
            </span>
          )}
        </button>
      </fieldset>
    </Sheet>
  );
}
