import { CARDS, choiceBlock, type Action, type GameState, type PendingCard } from "../sim/index.ts";
import { Chip } from "./bits.tsx";
import { Portrait } from "./Portrait.tsx";
import { Sheet } from "./Sheet.tsx";
import { t } from "./text.ts";
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
  const values = cardValues(state, id);
  const who = cardText(id, "who", values);

  return (
    <Sheet label={who} blocking className="card">
      <div className="dossier">
        <Portrait who={card.who ?? "stranger"} />
        <div className="dossier-text">
          <p className="stamp">{t(card.who === "lenny" ? "card.stamp.lenny" : "card.stamp")}</p>
          <p className="dossier-who">{who}</p>
          <p>{cardText(id, "story", values)}</p>
        </div>
      </div>

      <fieldset className="choices" disabled={readOnly}>
        {card.choices.map((choice) => {
          const block = choiceBlock(state, choice);
          const chips = block ? [] : choiceChips(state, choice, pending.odds);
          return (
            <button
              key={choice.id}
              type="button"
              className="choice-card"
              disabled={block !== null}
              onClick={() => dispatch({ type: "resolveCard", choice: choice.id })}
            >
              <span className="choice-title">{cardText(id, choice.id, values)}</span>
              {block ? (
                <span className="choice-after">{t(`card.why.${block}`)}</span>
              ) : (
                choice.chance && <span className="choice-after">{cardText(id, `${choice.id}.after`, values)}</span>
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
