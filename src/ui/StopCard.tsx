import { GOODS, RULES, type Action, type GameState, type PendingStop } from "../sim/index.ts";
import { Chip } from "./bits.tsx";
import { Sheet } from "./Sheet.tsx";
import { goodValues, money, t } from "./text.ts";
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
  const situation = q.type === "sell" ? t("stop.sell", goodValues(q.good)) : t("stop.job");
  const choose = (choice: "bribe" | "legIt" | "handOver") => dispatch({ type: "resolveStop", choice });
  const carrying = GOODS.some((g) => state.held[g] > 0);

  return (
    <Sheet label={t("stop.stamp")} blocking className="card">
      <div className="dossier">
        <Portrait />
        <div className="dossier-text">
          <p className="stamp">{t("stop.stamp")}</p>
          <p className="dossier-who">{t("stop.who")}</p>
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
            <span className="choice-after">{t(stop.bribeRefusal === "wanted" ? "stop.bribe.wanted" : "stop.bribe.short")}</span>
          ) : (
            <>
              <span className="choice-after">{t(`stop.bribe.after.${kind}`)}</span>
              <span className="action-chips">
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

/** An ink silhouette of a beat copper on a halftone ground. */
function Portrait() {
  return (
    <div className="portrait" aria-hidden="true">
      <svg viewBox="0 0 120 140" focusable="false">
        <path
          fill="currentColor"
          d="M60 8c-17 0-29 12-31 34l-6 4v8h74v-8l-6-4C89 20 77 8 60 8Zm-23 52c2 20 11 33 23 33s21-13 23-33H37Zm-27 80c2-24 18-38 38-42l12 10 12-10c20 4 36 18 38 42H10Z"
        />
        <rect className="badge" x="52" y="24" width="16" height="14" />
      </svg>
    </div>
  );
}
