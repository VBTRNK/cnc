import { GOODS, PLACES, has, hoursLeft, ringDistance, type Action, type GameState, type PlaceId } from "../sim/index.ts";
import { eventAt, knownPrice, sweepAt, type PriceView } from "./known.ts";
import { goodValues, money, placeName, t } from "./text.ts";
import { rumourLine, seenText } from "./words.ts";

interface CityProps {
  state: GameState;
  dispatch: (action: Action) => void;
}

/** The four neighbourhoods: travel, and what you know of each. Unknown looks unknown. */
export function City({ state, dispatch }: CityProps) {
  return (
    <>
      {state.rumour && <p className="rumour">{rumourLine(state.rumour)}</p>}
      <ul className="places">
        {PLACES.map((p) => (
          <li key={p}>
            <PlaceCard state={state} place={p} onGo={() => dispatch({ type: "travel", to: p })} />
          </li>
        ))}
      </ul>
    </>
  );
}

function PlaceCard({ state, place, onGo }: { state: GameState; place: PlaceId; onGo: () => void }) {
  const here = place === state.place;
  const hours = ringDistance(state.place, place);
  const views = GOODS.map((g) => ({ good: g, view: knownPrice(state, place, g) }));
  const live = here || has(state, "phone");
  const newest = views
    .map((v) => v.view.seen)
    .filter((x): x is NonNullable<PriceView["seen"]> => x !== null)
    .sort((a, b) => b.day - a.day || b.hour - a.hour)[0];
  const notes: { text: string; warn: boolean }[] = [];
  if (sweepAt(state, place)) notes.push({ text: t("note.sweep"), warn: true });
  for (const g of GOODS) {
    const e = eventAt(state, place, g);
    if (e === "shortage") notes.push({ text: t("city.eventShort", goodValues(g)), warn: true });
    if (e === "glut") notes.push({ text: t("city.eventGlut", goodValues(g)), warn: false });
  }

  return (
    <article className={here ? "place-card place-here" : "place-card"}>
      <div className="place-head">
        <h2>{placeName(place)}</h2>
        {here ? (
          <span className="here">{t("city.here")}</span>
        ) : (
          hoursLeft(state) >= hours && (
            <button type="button" className="go" aria-label={t("city.goLabel", { place: placeName(place), hours })} onClick={onGo}>
              {t("city.go", { hours })}
            </button>
          )
        )}
      </div>
      {notes.length > 0 && (
        <p className="place-notes">
          {notes.map((n) => (
            <span key={n.text} className={n.warn ? "note-warn" : "note"}>
              {n.text}
            </span>
          ))}
        </p>
      )}
      {(live || newest) && (
        <dl className="prices">
          {views.map(({ good, view }) => (
            <div key={good} className={view.price === null ? "price price-unknown" : "price"}>
              <dt>{goodValues(good).Kind}</dt>
              <dd>
                <span className="money">{view.price === null ? t("city.unknownPrice") : money(view.price)}</span>
                <span className={view.soldOut ? "price-hint note-warn" : "price-hint"}>
                  {cellHint(state, view, newest)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!here && (
        <p className="seen">
          {live ? t("city.live") : newest ? seenText(state, newest.day, newest.hour) : t("city.unseen")}
        </p>
      )}
    </article>
  );
}

/** One word under a price: stock trouble, a stale age, or the price hint. */
function cellHint(s: GameState, v: PriceView, newest: PriceView["seen"] | undefined): string {
  if (v.soldOut) return t("note.soldOut");
  if (v.low) return t("note.low");
  if (v.seen && newest && v.seen.day !== newest.day) return seenText(s, v.seen.day, v.seen.hour);
  return v.hint ? t(`hint.${v.hint}`) : "";
}
