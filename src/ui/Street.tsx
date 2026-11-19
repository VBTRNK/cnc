import { useEffect, useRef } from "react";
import {
  GOODS,
  RULES,
  canAskAround,
  hoursLeft,
  operationOn,
  price,
  priceHint,
  quoteJob,
  type Action,
  type DomainEvent,
  type GameState,
  type GoodId,
  type Refusal,
} from "../sim/index.ts";
import { Chip, RiskChip } from "./bits.tsx";
import { eventAt, sweepAt } from "./known.ts";
import type { Overlay } from "./overlay.ts";
import { codename, goodName, money, placeName, t } from "./text.ts";
import { briefs, oddsText, resultLines } from "./words.ts";

interface StreetProps {
  state: GameState;
  events: readonly DomainEvent[];
  refusal: Refusal | null;
  dismissed: ReadonlySet<string>;
  onDismiss: (id: string) => void;
  onOpen: (overlay: Overlay) => void;
  dispatch: (action: Action) => void;
}

/** Where you stand: the result of the last move, today's news, goods and actions. */
export function Street({ state, events, refusal, dismissed, onDismiss, onOpen, dispatch }: StreetProps) {
  const lines = refusal ? [t("result.refused")] : resultLines(events, state);
  const news = briefs(state)
    .map((b) => ({ ...b, id: `${state.runId}:${b.id}` }))
    .filter((b) => !dismissed.has(b.id));
  const left = hoursLeft(state);
  const job = quoteJob(state);
  const flavour = operationOn(state, state.place)
    ? t("street.flavour.operation", { Codename: codename(state.detective.case?.n ?? 1) })
    : sweepAt(state, state.place)
      ? t("street.flavour.sweep")
      : t(`street.flavour.${state.place}`);

  const resultRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (events.length > 0 || refusal) resultRef.current?.scrollIntoView({ block: "nearest" });
  }, [events, refusal]);

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

  return (
    <>
      <h1 ref={headRef} tabIndex={-1} className="place-name">
        {placeName(state.place)}
      </h1>
      <p className="flavour">{flavour}</p>

      <div className="result-slot" role="status">
        {lines.length > 0 && (
          <p ref={resultRef} className="result">
            <mark>{lines.join(" ")}</mark>
          </p>
        )}
      </div>

      {news.length > 0 && (
        <ul className="briefs">
          {news.map((b) => (
            <li key={b.id} className="brief">
              <p>{b.line}</p>
              <button type="button" className="icon-button" aria-label={t("dismiss")} onClick={() => onDismiss(b.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul className="goods">
        {GOODS.map((g) => (
          <li key={g}>
            <GoodRow state={state} good={g} onOpen={() => onOpen({ kind: "trade", good: g })} />
          </li>
        ))}
      </ul>

      <div className="actions">
        {left >= RULES.askHours && canAskAround(state) && (
          <ActionButton
            label={t("action.ask")}
            detail={t("action.ask.detail")}
            hours={RULES.askHours}
            onClick={() => dispatch({ type: "askAround" })}
          />
        )}
        {left >= RULES.lieLowHours && (
          <ActionButton
            label={t("action.lieLow")}
            detail={t("action.lieLow.detail")}
            hours={RULES.lieLowHours}
            onClick={() => dispatch({ type: "lieLow" })}
          />
        )}
        {left >= RULES.oddJobHours && (
          <ActionButton
            label={t("action.oddJob")}
            detail={t("action.oddJob.detail", { pay: money(RULES.oddJobPay) })}
            hours={RULES.oddJobHours}
            onClick={() => dispatch({ type: "oddJob" })}
          />
        )}
        <ActionButton
          label={t("action.callDay")}
          detail={t("action.callDay.detail")}
          onClick={() => onOpen({ kind: "callDay" })}
        />
        {typeof job !== "string" && (
          <button type="button" className="action action-wide" onClick={() => onOpen({ kind: "job" })}>
            <span className="action-label">{t("action.job")}</span>
            <span className="action-chips">
              <Chip kind="chance">{oddsText(job.success)}</Chip>
              <RiskChip chance={job.stopChance} />
              <Chip>{t("hours", { n: job.hours })}</Chip>
            </span>
          </button>
        )}
      </div>
    </>
  );
}

function GoodRow({ state, good, onOpen }: { state: GameState; good: GoodId; onOpen: () => void }) {
  const cell = state.market[state.place][good];
  const held = state.held[good];
  const event = eventAt(state, state.place, good);
  const hint = priceHint(state, state.place, good);
  let note: { text: string; warn: boolean } | null = null;
  if (cell.stock === 0) note = { text: t("note.soldOut"), warn: true };
  else if (event === "shortage") note = { text: t("note.short"), warn: true };
  else if (event === "glut") note = { text: t("note.glut"), warn: false };

  return (
    <button type="button" className="good" onClick={onOpen}>
      <span className="held">{held > 0 ? held : ""}</span>
      <span className="good-name">{goodName(good)}</span>
      <span className="good-price">{money(price(state, state.place, good))}</span>
      <span className={note?.warn ? "good-hint note-warn" : "good-hint"}>
        {note ? note.text : hint ? t(`hint.${hint}`) : ""}
      </span>
    </button>
  );
}

function ActionButton({ label, detail, hours, onClick }: { label: string; detail: string; hours?: number; onClick: () => void }) {
  return (
    <button type="button" className="action" onClick={onClick}>
      <span className="action-label">{label}</span>
      <span className="action-detail">{detail}</span>
      {hours !== undefined && <Chip>{t("hours", { n: hours })}</Chip>}
    </button>
  );
}
