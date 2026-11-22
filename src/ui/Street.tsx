import { useEffect, useRef, type MouseEventHandler, type ReactNode } from "react";
import {
  RULES,
  canAskAround,
  deals,
  falseTrailOffer,
  hoursLeft,
  level,
  quoteJob,
  riskWord,
  rumourAccuracy,
  terryOffer,
  type Action,
  type DomainEvent,
  type GameState,
  type GoodId,
} from "../sim/index.ts";
import { Chevron, CloseIcon, useNarrow } from "./bits.tsx";
import { CaseNotice } from "./CaseNotice.tsx";
import { localCase, operationNotice, sweepNotice } from "./caseWords.ts";
import { knownPrice, marketNote } from "./known.ts";
import type { Overlay } from "./overlay.ts";
import { goodName, goodsByName, money, placeName, t } from "./text.ts";
import { briefs, jobSuccessText, terryQuoteLine } from "./words.ts";

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
  const trail = falseTrailOffer(state);
  const c = localCase(state) ?? (trail ? state.detective.case : null);
  const terry = terryOffer(state);
  const sweep = state.events.find((e) => e.kind === "sweep" && e.activated && e.place === state.place);

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
      : document.querySelector<HTMLElement>(".moves button");
    next?.focus();
  }, [news.length]);

  const place = !c && !sweep && <p className="flavour">{t(`street.flavour.${state.place}`)}</p>;
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
  const moves = <Moves state={state} narrow={narrow} onOpen={onOpen} dispatch={dispatch} />;
  const market = (
    <section className="market" aria-labelledby="k-market">
      <h2 className="kicker" id="k-market">
        {t("street.market")}
      </h2>
      {terry && (
        <button type="button" className="row-button offer-row" onClick={() => onOpen({ kind: "terry" })}>
          <span>
            <strong>{t("terry.title")}</strong>
            <span className="offer-detail">{terryQuoteLine(terry)}</span>
            {terry.block && <span className="offer-detail warn">{t(`card.why.${terry.block}`)}</span>}
          </span>
          <Chevron />
        </button>
      )}
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
      {c && (
        <CaseNotice notice={operationNotice(c, state.day)}>
          {trail?.block === "noCash" && <p>{t("trail.short", { cost: money(trail.cost) })}</p>}
          {trail?.block === "unavailable" && <p>{t("trail.unavailable")}</p>}
          {trail && !trail.block && (
            <button type="button" className="row-button" onClick={() => dispatch({ type: "openFalseTrail" })}>
              <span>{t("trail.open")}</span>
              <Chevron />
            </button>
          )}
        </CaseNotice>
      )}
      {sweep?.kind === "sweep" && <CaseNotice notice={sweepNotice(sweep)} />}
      {narrow ? <>{market}{moves}</> : <>{moves}{market}</>}
      {tips}
      {place}
    </>
  );
}

/** End-day control before the timed moves on narrow screens, after them elsewhere. */
function Moves({ state, narrow, onOpen, dispatch }: Pick<StreetProps, "state" | "onOpen" | "dispatch"> & { narrow: boolean }) {
  const left = hoursLeft(state);
  const job = quoteJob(state);
  const risk = typeof job === "string" ? null : riskWord(job.stopChance);
  const canAsk = left >= RULES.askHours && canAskAround(state);
  const accuracy = rumourAccuracy(level(state.xp.savvy + RULES.askSavvy));
  const dayRef = useRef<HTMLButtonElement>(null);
  const restoreAsk = useRef(false);
  useEffect(() => {
    if (restoreAsk.current && !canAsk && document.activeElement === document.body) dayRef.current?.focus();
    restoreAsk.current = false;
  }, [state, canAsk]);

  const endDay = (
    <button ref={dayRef} type="button" className="row-button" onClick={() => onOpen({ kind: "callDay" })}>
      <span>{t("action.callDay")}</span>
      <Chevron />
    </button>
  );
  return (
    <section className="moves" aria-labelledby="k-moves">
      <h2 className="kicker" id="k-moves">
        {t("street.moves")}
      </h2>
      {narrow && endDay}
      <div className="move-grid">
        {canAsk && (
          <Move label={t("action.ask")} hours={RULES.askHours} onClick={(event) => {
            restoreAsk.current = document.activeElement === event.currentTarget;
            dispatch({ type: "askAround" });
          }}>
            {state.rumour ? t("action.askQuote") : t("action.askRumour", { day: state.day + 1 })}
            {!state.rumour && accuracy > RULES.rumourTruth && (
              <span className="move-detail">{t("action.askAccuracy", { accuracy })}</span>
            )}
          </Move>
        )}
        {left >= RULES.lieLowHours && (
          <Move label={t("action.lieLow")} hours={RULES.lieLowHours} onClick={() => dispatch({ type: "lieLow" })} />
        )}
        {left >= RULES.oddJobHours && (
          <Move label={t("action.oddJob")} hours={RULES.oddJobHours} onClick={() => dispatch({ type: "oddJob" })}>
            {t("action.oddJobPay", { pay: money(RULES.oddJobPay) })}
          </Move>
        )}
        {typeof job !== "string" && risk && (
          <Move label={t("action.job")} hours={job.hours} onClick={() => onOpen({ kind: "job" })}>
            {jobSuccessText(job.success)} ·{" "}
            <span className={risk === "real" || risk === "high" ? "warn" : undefined}>
              {t("risk.chip", { word: t(`risk.${risk}`) })}
            </span>
          </Move>
        )}
      </div>
      {!narrow && endDay}
    </section>
  );
}

/** A move with its name, duration and details for the decision. */
function Move({ label, hours, onClick, children }: {
  label: string;
  hours: number;
  onClick: MouseEventHandler<HTMLButtonElement>;
  children?: ReactNode;
}) {
  return (
    <button type="button" className="move" onClick={onClick}>
      <span className="move-name">{label}</span>
      <span className="move-hours">{t("hours", { n: hours })}</span>
      {children && <span className="move-figure">{children}</span>}
    </button>
  );
}

function GoodRow({ state, good, onOpen }: { state: GameState; good: GoodId; onOpen: () => void }) {
  const view = deals(state.place, good) ? knownPrice(state, state.place, good) : null;
  const price = view?.price ?? null;
  const held = state.held[good];
  const note = marketNote(state, state.place, good, view);

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
      <span className="good-price">{price === null ? "" : money(price)}</span>
      <span className={note?.warn ? "good-hint warn" : "good-hint"}>{note?.text}</span>
      <Chevron />
    </button>
  );
}
