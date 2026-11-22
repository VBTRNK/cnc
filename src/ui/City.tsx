import { Fragment, useCallback, useState } from "react";
import {
  PLACES,
  callHeat,
  deals,
  has,
  hoursLeft,
  ringDistance,
  type Action,
  type GameState,
  type GoodId,
  type PlaceId,
} from "../sim/index.ts";
import { Chevron, useNarrow } from "./bits.tsx";
import { CaseNotice } from "./CaseNotice.tsx";
import { operationNotice, sweepNotice } from "./caseWords.ts";
import { knownPrice, marketNote, sweepAt, type PriceView } from "./known.ts";
import { goodName, goodsByName, money, placeShort, placeValues, t } from "./text.ts";
import { rumourLine, seenText } from "./words.ts";

interface CityProps {
  state: GameState;
  /** Travel: the screen moves on to Street. */
  dispatch: (action: Action) => void;
  onCall: () => void;
}

/**
 * Every place's prices as the player knows them, goods down and places across, with the way
 * to each place on top. Unknown looks unknown. In the narrow layout the table comes first.
 */
export function City({ state, dispatch, onCall }: CityProps) {
  const narrow = useNarrow();
  const phone = has(state, "phone");
  const operation = state.detective.case;
  const sweeps = state.events.filter((e) => e.kind === "sweep" && e.activated);
  const warnings = (operation || sweeps.length > 0) && (
    <section aria-label="Route warnings">
      {operation && <CaseNotice id="city-operation" notice={operationNotice(operation, state.day)} />}
      {sweeps.map((e) => e.kind === "sweep" && <CaseNotice key={e.id} id={`city-sweep-${e.place}`} notice={sweepNotice(e)} />)}
    </section>
  );
  const call = (phone || state.rumour) && (
    <div className="call">
      {phone && (
        <button type="button" className="move move-row" onClick={onCall}>
          <span className="move-name">{t("city.ring")}</span>
          <span className="move-hours warn">{t("chip.heat", { heat: callHeat(state) })}</span>
        </button>
      )}
      {state.rumour && <p className="rumour">{rumourLine(state.rumour)}</p>}
    </div>
  );
  const prices = (
    <section className="prices" aria-labelledby="k-prices">
      <h2 className="kicker" id="k-prices">
        {t("city.prices")}
      </h2>
      <PriceTable state={state} narrow={narrow} onGo={(to) => dispatch({ type: "travel", to })} />
    </section>
  );
  return narrow || warnings ? (
    <>
      {warnings}
      {prices}
      {call}
    </>
  ) : (
    <>
      {call}
      {prices}
    </>
  );
}

interface Column {
  place: PlaceId;
  here: boolean;
  hours: number;
  /** When its newest price was seen; null for here (live) or never seen. */
  newest: PriceView["seen"];
  notes: string[];
  warnings: string[];
}

function column(state: GameState, place: PlaceId, goods: readonly GoodId[]): Column {
  const newest =
    goods
      .map((g) => knownPrice(state, place, g).seen)
      .filter((x): x is NonNullable<PriceView["seen"]> => x !== null)
      .sort((a, b) => b.day - a.day || b.hour - a.hour)[0] ?? null;
  const notes: string[] = [];
  const warnings: string[] = [];
  if (state.detective.case?.places.includes(place)) {
    notes.push(t("city.head.operation"));
    warnings.push("city-operation");
  }
  if (sweepAt(state, place)) {
    notes.push(t("city.head.sweep"));
    warnings.push(`city-sweep-${place}`);
  }
  return { place, here: place === state.place, hours: ringDistance(state.place, place), newest, notes, warnings };
}

function PriceTable({ state, narrow, onGo }: { state: GameState; narrow: boolean; onGo: (to: PlaceId) => void }) {
  const goods = goodsByName();
  const cols = PLACES.map((p) => column(state, p, goods));
  const left = hoursLeft(state);
  // Narrow, the head scrolls away with the page, so the place names come again above the last
  // rows: the last four, or the last half of a shorter list.
  const tail = Math.min(4, Math.floor(goods.length / 2));
  const repeatAt = narrow && tail > 0 ? goods.length - tail : -1;
  const [more, setMore] = useState(true);
  const watch = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    // A focused Go and its focus ring scroll clear of the fixed goods column and the fade (when
    // they are there), either way round; its left edge first, where the space is narrower.
    const reveal = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement) || e.target === el) return;
      const port = el.getBoundingClientRect();
      const box = e.target.getBoundingClientRect();
      const stick = el.querySelector<HTMLElement>("tbody .stick");
      const pinned = stick && getComputedStyle(stick).position === "sticky" ? stick.getBoundingClientRect().width : 0;
      const left = port.left + pinned;
      const right = port.right - (el.parentElement?.querySelector(".table-fade")?.getBoundingClientRect().width ?? 0);
      const ring = Math.max(0, Math.min(5, (right - left - box.width) / 2));
      const r = { left: box.left - ring, right: box.right + ring };
      if (r.left < left) el.scrollLeft -= left - r.left;
      else if (r.right > right) el.scrollLeft += Math.min(r.right - right, r.left - left);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("focusin", reveal);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("focusin", reveal);
    };
  }, []);
  const hc = (c: Column) => (c.here ? "here-col" : undefined);

  return (
    <div className="table-frame">
      {/* Narrow, the table scrolls sideways: a named region with a keyboard stop of its own. */}
      <div
        className="table-scroll"
        ref={narrow ? watch : undefined}
        {...(narrow ? { role: "region", tabIndex: 0, "aria-label": t("city.tableLabel") } : {})}
      >
        <table className="price-table">
          <colgroup>
            <col className="col-goods" />
            {cols.map((c) => (
              <col key={c.place} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <td className="stick" />
              {cols.map((c) => (
                <th key={c.place} scope="col" className={c.here ? "place-head here-col" : "place-head"}>
                  {placeShort(c.place)}
                  {c.notes.map((n) => (
                    <span key={n} className="head-note">
                      {n}
                    </span>
                  ))}
                </th>
              ))}
            </tr>
            <tr>
              <td className="stick" />
              {cols.map((c) => (
                <td key={c.place} className={c.here ? "go-cell here-col" : "go-cell"}>
                  {c.here ? (
                    <span className="here">
                      <mark>{t("city.here")}</mark>
                    </span>
                  ) : left >= c.hours ? (
                    <button
                      type="button"
                      className="go"
                      aria-label={t("city.goLabel", { place: placeValues(c.place).place!, hours: c.hours })}
                      aria-describedby={c.warnings.length ? c.warnings.join(" ") : undefined}
                      onClick={() => onGo(c.place)}
                    >
                      <span className="go-word">{t("city.go")}</span>
                      <span className="go-hours">{t("hours", { n: c.hours })}</span>
                    </button>
                  ) : (
                    <span className="go-late">{t("city.tooLate")}</span>
                  )}
                </td>
              ))}
            </tr>
            <tr className="seen-row">
              <th scope="row" className="stick">
                {t("city.seen")}
              </th>
              {cols.map((c) => (
                <td key={c.place} className={hc(c)}>
                  {c.here ? t("city.seenNow") : c.newest ? seenText(state, c.newest.day, c.newest.hour) : t("city.unseen")}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {goods.map((g, i) => (
              <Fragment key={g}>
                {i === repeatAt && (
                  <tr className="repeat-row" aria-hidden="true">
                    <td className="stick" />
                    {cols.map((c) => (
                      <td key={c.place} className={hc(c)}>
                        {placeShort(c.place)}
                      </td>
                    ))}
                  </tr>
                )}
                <tr>
                  <th scope="row" className="stick">
                    {goodName(g)}
                  </th>
                  {cols.map((c) => (
                    <PriceCell key={c.place} state={state} col={c} good={g} />
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {/* Kept in place (hidden at the end), so a focused Go always knows the room it covers. */}
      {narrow && (
        <div className="table-fade" data-more={more || undefined} aria-hidden="true">
          <Chevron />
        </div>
      )}
    </div>
  );
}

function PriceCell({ state, col, good }: { state: GameState; col: Column; good: GoodId }) {
  const view = deals(col.place, good) ? knownPrice(state, col.place, good) : null;
  const note = marketNote(state, col.place, good, view, col.newest);
  const cls = [col.here && "here-col", !view && "undealt", view?.price === null && "unknown"].filter(Boolean).join(" ");
  return (
    <td className={cls || undefined}>
      {!view ? (
        <>
          <span aria-hidden="true">{t("city.undealtPrice")}</span>
          {!note && <span className="visually-hidden">{t("city.undealtLabel")}</span>}
        </>
      ) : view.price === null ? (
        <>
          <span aria-hidden="true">{t("city.unknownPrice")}</span>
          <span className="visually-hidden">{t("city.unknownLabel")}</span>
        </>
      ) : (
        money(view.price)
      )}
      {note && <span className={note.warn ? "cell-hint warn" : "cell-hint"}>{note.text}</span>}
    </td>
  );
}
