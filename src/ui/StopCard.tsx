import { GOODS, RULES, carried, type Action, type GameState, type PendingStop } from "../sim/index.ts";
import { Chip } from "./bits.tsx";
import { Portrait } from "./Portrait.tsx";
import { Sheet } from "./Sheet.tsx";
import { CaseNotice } from "./CaseNotice.tsx";
import { caseAt, localCase, operationNotice, sweepNotice } from "./caseWords.ts";
import { goodCount, money, t } from "./text.ts";
import { displayChance } from "./words.ts";

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
  const c = pinch ? localCase(state, true) : null;
  const sweep = state.events.find((e) => e.activated && e.kind === "sweep" && e.place === state.place);
  const officer = pinch ? "Pinch" : "Police";
  const at = caseAt(state.place);
  const situation = q.type === "sell"
    ? `${officer} stopped your sale of ${goodCount(q.good, q.units)} ${at}.`
    : `${officer} stopped you on your way to a risky job ${at}.`;
  const who = pinch ? t(state.detective.promoted ? "people.pinch.inspector" : "people.pinch.sergeant") : t("stop.who");
  const choose = (choice: "bribe" | "legIt" | "handOver") => dispatch({ type: "resolveStop", choice });
  const count = carried(state);
  const kinds = GOODS.filter((g) => state.held[g] > 0);
  const cargo = kinds.length === 1 ? goodCount(kinds[0]!, count) : `${count} units of goods`;

  return (
    <Sheet label={t("stop.stamp")} blocking className="card" focusHeading>
      <div className="dossier">
        <Portrait who={pinch ? "pinch" : "copper"} />
        <div className="dossier-text">
          <p className="stamp">{t("stop.stamp")}</p>
          <h2 tabIndex={-1} className="dossier-who">{who}</h2>
        </div>
      </div>
      <div className="card-context">
        <p>{situation} {count > 0 ? `You’re carrying ${cargo}.` : "Your pockets are empty."}</p>
        {c ? <CaseNotice heading="h3" notice={operationNotice(c, state.day)} /> : sweep?.kind === "sweep" ? <CaseNotice heading="h3" notice={sweepNotice(sweep)} /> : null}
        {pinch && !c && <p>Pinch refuses bribes.</p>}
      </div>

      <fieldset className="choices" disabled={readOnly}>
        {!pinch && <button
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
                <Chip kind="chance">{t("stop.bribe.acceptance", { chance: displayChance(stop.bribeOdds) })}</Chip>
                <Chip>{t("stop.bribe.cost", { amount: money(stop.bribe) })}</Chip>
                <Chip>{t("chip.heat", { heat: RULES.bribeHeat })}</Chip>
              </span>
            </>
          )}
        </button>}

        <button type="button" className="choice-card" onClick={() => choose("legIt")}>
          <span className="choice-title">{t("stop.legIt")}</span>
          <span className="choice-after">
            {displayChance(q.legIt)}% chance to escape. Escape means +{RULES.legItHeat} heat and the {kind === "sell" ? "sale" : "job"} continues. Failure means arrest.
          </span>
        </button>

        <button type="button" className="choice-card" onClick={() => choose("handOver")}>
          <span className="choice-title">{count > 0 ? "Hand over all carried goods" : "Let them check your pockets"}</span>
          <span className="choice-after">
            {count > 0 ? `Give up ${cargo}.` : "You have nothing to hand over."} {kind === "sell" ? "The sale is cancelled." : "The job goes ahead."}
          </span>
        </button>
      </fieldset>
    </Sheet>
  );
}
