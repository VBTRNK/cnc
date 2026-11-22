import { CARDS, TRAIL, choiceBlock, type Action, type GameState, type PendingCard } from "../sim/index.ts";
import { Chip } from "./bits.tsx";
import { caseDates, operationName, refusal } from "./caseWords.ts";
import { Portrait } from "./Portrait.tsx";
import { Sheet } from "./Sheet.tsx";
import { placesText, t } from "./text.ts";
import { cardText, cardValues, choiceChips } from "./words.ts";

interface CardSheetProps {
  state: GameState;
  pending: PendingCard;
  dispatch: (action: Action) => void;
  readOnly: boolean;
}

/** An authored card: a dossier with who and what, then two or three choices with their effects as chips. */
export function CardSheet({ state, pending, dispatch, readOnly }: CardSheetProps) {
  const id = pending.card;
  const card = CARDS[id];
  const values = cardValues(id);
  const who = cardText(id, "who", values);
  const trail = TRAIL.includes(id);
  const c = trail ? state.detective.case : null;

  return (
    <Sheet label={who} blocking className="card" focusHeading={trail}>
      <div className="dossier">
        <Portrait who={card.who ?? "stranger"} />
        <div className="dossier-text">
          <p className="stamp">{t(card.who === "lenny" ? "card.stamp.lenny" : "card.stamp")}</p>
          <h2 tabIndex={-1} className="dossier-who">{who}</h2>
          {!trail && <p>{cardText(id, "story", values)}</p>}
        </div>
      </div>
      {trail && (
        <div className="card-context">
          {c
            ? <p><strong>{operationName(c)}</strong> · {placesText(c.places)} · {caseDates(c)}. {refusal}</p>
            : <p>There’s no current operation warning to move.</p>}
          <p>“I can give him another story. Always room for one of those.”</p>
        </div>
      )}

      <fieldset className="choices" disabled={readOnly}>
        {card.choices.map((choice) => {
          const block = choiceBlock(state, choice);
          const chips = block || trail ? [] : choiceChips(state, choice, pending.odds);
          return (
            <button
              key={choice.id}
              type="button"
              className="choice-card"
              disabled={block !== null}
              onClick={() => dispatch({ type: "resolveCard", choice: choice.id })}
            >
              <span className="choice-title">{trail && choice.chance ? `Pay Lenny ${values.cost}` : cardText(id, choice.id, values)}</span>
              {block ? (
                <span className="choice-after">{t(`card.why.${block}`)}</span>
              ) : (
                trail ? (
                  <span className="choice-after">
                    {choice.chance
                      ? c
                        ? `${pending.odds}% chance Pinch takes the bait. If there’s room, ${c.places.length === 2 ? "one or both sites can change" : "he moves the operation"}. The dates stay. You pay either way.`
                        : "You pay for the story."
                      : "Keep your cash and plan around the warning."}
                  </span>
                ) : choice.chance && <span className="choice-after">{cardText(id, `${choice.id}.after`, values)}</span>
              )}
              {chips.length > 0 && (
                <span className="action-chips">
                  {chips.map((c, i) => (
                    <Chip key={i} kind={c.kind} warn={c.warn}>
                      {c.text}
                    </Chip>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </fieldset>
    </Sheet>
  );
}
