import { useEffect, useRef, type ReactNode } from "react";
import {
  RULES,
  canAskAround,
  deals,
  hoursLeft,
  operationOn,
  price,
  priceHint,
  quoteJob,
  riskWord,
  type Action,
  type DomainEvent,
  type GameState,
  type GoodId,
} from "../sim/index.ts";
import { Chevron, CloseIcon, useNarrow } from "./bits.tsx";
import { eventAt, sweepAt } from "./known.ts";
import type { Overlay } from "./overlay.ts";
import { codename, goodName, goodsByName, money, placeName, t, upper } from "./text.ts";
import { briefs, oddsText } from "./words.ts";

interface StreetProps {
  state: GameState;
  events: readonly DomainEvent[];
  dismissed: ReadonlySet<string>;
  onDismiss: (id: string) => void;
  onOpen: (overlay: Overlay) => void;
  dispatch: (action: Action) => void;
}

/**
 * Where you stand: the place, today's tips, the moves and the market. In the narrow layout
 * the market comes first, then the moves, then the tips and the place's line.
 */
export function Street({ state, events, dismissed, onDismiss, onOpen, dispatch }: StreetProps) {
  const narrow = useNarrow();
  const news = briefs(state)
    .map((b) => ({ ...b, id: `${state.runId}:${b.id}` }))
    .filter((b) => !dismissed.has(b.id));
  const flavour = operationOn(state, state.place)
    ? t("street.flavour.operation", { Codename: codename(state.detective.case?.n ?? 1) })
    : sweepAt(state, state.place)
      ? t("street.flavour.sweep")
      : t(`street.flavour.${state.place}`);

  // Travelling or a new day removes the control that had focus; keep it on the page.
  const headRef = useRef<HTMLHeadingElement>(null);
  const where = `${state.day}:${state.place}`;
  // Arriving from City or the paper, the button that was pressed is gone too.
  const arrived = events.some((e) => e.type === "travelled" || e.type === "dayStarted");
  const lastWhere = useRef(arrived ? "" : where);
  useEffect(() => {
    if (lastWhere.current === where) return;
    lastWhere.current = where;
    if (!document.activeElement || document.activeElement === document.body) headRef.current?.focus();
  }, [where]);

  // A dismissed tip's button goes with it: focus moves to the next tip's (or the one before),
  // else to the control beside the tips, the first move (or, narrow, Call it a day above them).
  const tipsRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<string | null>(null);
  const dismiss = (i: number) => {
    focusAfter.current = (news[i + 1] ?? news[i - 1])?.id ?? "";
    onDismiss(news[i]!.id);
  };
  useEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    const next = id
      ? [...(tipsRef.current?.querySelectorAll<HTMLElement>("[data-tip]") ?? [])].find((e) => e.dataset.tip === id)
      : document.querySelector<HTMLElement>(narrow ? ".moves .row-button" : ".moves button");
    next?.focus();
  }, [news.length, narrow]);

  const place = <p className="flavour">{flavour}</p>;
  const tips = news.length > 0 && (
    <ul className="tips" ref={tipsRef}>
      {news.map((b, i) => (
        <li key={b.id} className="tip">
          <p>
            <b>{b.who}</b> {b.line}
          </p>
          <button
            type="button"
            className="icon-button"
            data-tip={b.id}
            aria-label={t(`tip.dismiss.${b.from}`, { line: b.line })}
            onClick={() => dismiss(i)}
          >
            <CloseIcon />
          </button>
        </li>
      ))}
    </ul>
  );
  const moves = <Moves state={state} onOpen={onOpen} dispatch={dispatch} />;
  const market = (
    <section className="market" aria-labelledby="k-market">
      <h2 className="kicker" id="k-market">
        {t("street.market")}
      </h2>
      <ul className="goods">
        {[
          ...goodsByName().filter((g) => deals(state.place, g)),
          ...goodsByName().filter((g) => !deals(state.place, g) && state.held[g] > 0),
        ].map((g) => (
          <li key={g}>
            <GoodRow state={state} good={g} onOpen={() => onOpen({ kind: "trade", good: g })} />
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <h1 ref={headRef} tabIndex={-1} className="place-name">
        {placeName(state.place)}
      </h1>
      {narrow ? (
        <>
          {market}
          {moves}
          {tips}
          {place}
        </>
      ) : (
        <>
          {place}
          {tips}
          {moves}
          {market}
        </>
      )}
    </>
  );
}

/** Ask around, Lie low, Odd job and Pull a job two by two; Call it a day a row below them. */
function Moves({ state, onOpen, dispatch }: Pick<StreetProps, "state" | "onOpen" | "dispatch">) {
  const left = hoursLeft(state);
  const job = quoteJob(state);
  const risk = typeof job === "string" ? null : riskWord(job.stopChance);
  return (
    <section className="moves" aria-labelledby="k-moves">
      <h2 className="kicker" id="k-moves">
        {t("street.moves")}
      </h2>
      <div className="move-grid">
        {left >= RULES.askHours && canAskAround(state) && (
          <Move label={t("action.ask")} hours={RULES.askHours} onClick={() => dispatch({ type: "askAround" })} />
        )}
        {left >= RULES.lieLowHours && (
          <Move label={t("action.lieLow")} hours={RULES.lieLowHours} onClick={() => dispatch({ type: "lieLow" })} />
        )}
        {left >= RULES.oddJobHours && (
          <Move label={t("action.oddJob")} hours={RULES.oddJobHours} onClick={() => dispatch({ type: "oddJob" })}>
            <span className="figure">{t("chip.gain", { amount: money(RULES.oddJobPay) })}</span>
          </Move>
        )}
        {typeof job !== "string" && risk && (
          <Move label={t("action.job")} hours={job.hours} onClick={() => onOpen({ kind: "job" })}>
            {upper(oddsText(job.success))} ·{" "}
            <span className={risk === "real" || risk === "high" ? "warn" : undefined}>
              {t("risk.figure", { word: t(`risk.${risk}`) })}
            </span>
          </Move>
        )}
      </div>
      <button type="button" className="row-button" onClick={() => onOpen({ kind: "callDay" })}>
        <span>{t("action.callDay")}</span>
        <Chevron />
      </button>
    </section>
  );
}

/** A move: its name and hours, and at most one figure line below (payout, odds, risk). */
function Move({ label, hours, onClick, children }: { label: string; hours: number; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className="move" onClick={onClick}>
      <span className="move-name">{label}</span>
      <span className="move-hours">{t("hours", { n: hours })}</span>
      {children && <span className="move-figure">{children}</span>}
    </button>
  );
}

function GoodRow({ state, good, onOpen }: { state: GameState; good: GoodId; onOpen: () => void }) {
  const cell = state.market[state.place][good];
  const dealt = deals(state.place, good);
  const held = state.held[good];
  const event = eventAt(state, state.place, good);
  const hint = priceHint(state, state.place, good);
  let note: { text: string; warn: boolean } | null = null;
  if (!dealt) note = { text: t("note.noBuyers"), warn: true };
  else if (cell.stock === 0) note = { text: t("note.soldOut"), warn: true };
  else if (event === "shortage") note = { text: t("note.short"), warn: true };
  else if (event === "glut") note = { text: t("note.glut"), warn: false };

  // Sold out stays tappable: the sheet can still sell, and says why it can't buy. A held good
  // nobody here deals in opens a sheet that says so.
  return (
    <button type="button" className="good" onClick={onOpen}>
      <span className="held">
        {held > 0 && (
          <>
            <span aria-hidden="true">{held}</span>
            <span className="visually-hidden">{t("street.held", { n: held })}</span>
          </>
        )}
      </span>
      <span className="good-name">{goodName(good)}</span>
      <span className="good-price">{dealt ? money(price(state, state.place, good)) : ""}</span>
      <span className={note?.warn ? "good-hint warn" : "good-hint"}>{note ? note.text : hint ? t(`hint.${hint}`) : ""}</span>
      <Chevron />
    </button>
  );
}
