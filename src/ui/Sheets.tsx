import { useState } from "react";
import {
  PINCH,
  RULES,
  UPGRADE_COST,
  carried,
  deals,
  hoursLeft,
  marketEventOn,
  maxBuy,
  maxSale,
  pockets,
  price,
  priceHint,
  quoteJob,
  quoteSale,
  saleCost,
  saleHoursAtLevel,
  terryOffer,
  type Action,
  type GameState,
  type GoodId,
  type UpgradeId,
} from "../sim/index.ts";
import { Chip, RiskChip } from "./bits.tsx";
import { CaseNotice } from "./CaseNotice.tsx";
import { caseAt, eventNotice, localCase, operationNotice, sweepNotice } from "./caseWords.ts";
import { Portrait } from "./Portrait.tsx";
import { Sheet } from "./Sheet.tsx";
import { goodName, goodTagline, money, t, upgradeName, type TextKey } from "./text.ts";
import { jobSuccessText, terryQuoteLine } from "./words.ts";

interface CommitProps {
  state: GameState;
  onClose: () => void;
  /** Sends the action; the sheet closes first, so a stop card never stacks on it. */
  commit: (action: Action) => void;
}

// ---- Trade -------------------------------------------------------------------------

function buyBlock(s: GameState, good: GoodId): TextKey | null {
  if (s.market[s.place][good].stock === 0) return "trade.why.soldOut";
  if (pockets(s) - carried(s) === 0) return "trade.why.noPockets";
  if (s.cash < price(s, s.place, good)) return "trade.why.noCash";
  return null;
}

function sellBlock(s: GameState, good: GoodId): TextKey | null {
  if (s.held[good] === 0) return "trade.why.noGoods";
  if (s.market[s.place][good].demand === 0) return "trade.why.noDemand";
  if (maxSale(s, good) === 0) return "trade.why.noTime";
  return null;
}

export function TradeSheet(props: CommitProps & { good: GoodId }) {
  return deals(props.state.place, props.good) ? <DealtSheet {...props} /> : <UndealtSheet {...props} />;
}

/** A held good nobody here deals in: what you carry and what it cost, and nothing to trade. */
function UndealtSheet({ state, good, onClose }: CommitProps & { good: GoodId }) {
  return (
    <Sheet label={goodName(good)} onClose={onClose} focusHeading>
      <div className="sheet-head">
        <h2 tabIndex={-1}>{goodName(good)}</h2>
      </div>
      <p className="tagline">{goodTagline(good)}</p>
      <p className="facts">{t("trade.undealt.facts", { held: state.held[good], paid: money(state.paid[good]) })}</p>
      <p className="why">{t("trade.why.noBuyers")}</p>
    </Sheet>
  );
}

function DealtSheet({ state, good, onClose, commit }: CommitProps & { good: GoodId }) {
  const canSell = maxSale(state, good) > 0;
  const [mode, setMode] = useState<"buy" | "sell">(canSell ? "sell" : "buy");
  const max = mode === "buy" ? maxBuy(state, good) : maxSale(state, good);
  const [chosen, setChosen] = useState<number | null>(null);
  const units = Math.min(Math.max(chosen ?? max, max > 0 ? 1 : 0), max);
  const block = mode === "buy" ? buyBlock(state, good) : sellBlock(state, good);
  const unitPrice = price(state, state.place, good);
  const hint = priceHint(state, state.place, good);
  const quote = mode === "sell" && units > 0 ? quoteSale(state, good, units) : null;
  const marketEvent = marketEventOn(state, state.place, good);
  const patterHours = quote && typeof quote !== "string" ? saleHoursAtLevel(good, units, 0) - quote.hours : 0;
  const switchTo = (m: "buy" | "sell") => {
    setMode(m);
    setChosen(null);
  };

  return (
    <Sheet label={goodName(good)} onClose={onClose} focusHeading>
      <div className="sheet-head">
        <h2 tabIndex={-1}>{goodName(good)}</h2>
        <p className="sheet-price">
          <span className="money">{money(unitPrice)}</span>
          {hint && <span className="hint-word">{t(`hint.${hint}`)}</span>}
        </p>
      </div>
      <p className="facts">{t("trade.currentPrice", { at: caseAt(state.place) })}</p>
      <p className="tagline">{goodTagline(good)}</p>
      <p className="facts">
        {t("trade.facts", {
          held: state.held[good],
          stock: state.market[state.place][good].stock,
          free: pockets(state) - carried(state),
        })}
      </p>
      {marketEvent && <CaseNotice heading="h3" notice={eventNotice(marketEvent)} />}

      <div className="switch" role="group" aria-label={t("trade.mode")}>
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={mode === m ? "switch-on" : ""}
            onClick={() => switchTo(m)}
          >
            {t(m === "buy" ? "trade.buy" : "trade.sell")}
          </button>
        ))}
      </div>

      {block ? (
        <p className="why">{t(block)}</p>
      ) : (
        <>
          {/* Max wraps onto its own line when the row doesn't fit (large text, narrow phones). */}
          <div className="stepper">
            <div className="stepper-units">
              <button type="button" aria-label={t("trade.fewer")} disabled={units <= 1} onClick={() => setChosen(units - 1)}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                value={units}
                aria-label={t("trade.units")}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  if (Number.isFinite(n)) setChosen(Math.min(Math.max(n, 1), max));
                }}
              />
              <button type="button" aria-label={t("trade.more")} disabled={units >= max} onClick={() => setChosen(units + 1)}>
                +
              </button>
            </div>
            <button type="button" className="stepper-max" disabled={units === max} onClick={() => setChosen(max)}>
              {t("trade.max")}
            </button>
          </div>
          {quote && typeof quote !== "string" && (
            <>
              <QuoteWarning state={state} />
              <p className="chips-line">
                <ProfitChip profit={quote.proceeds - saleCost(state, good, units)} />
                <RiskChip chance={quote.stopChance} />
                <Chip>{t("chip.heat", { heat: Math.round(Math.min(quote.heat, RULES.heatMax - state.heat) * 10) / 10 })}</Chip>
              </p>
              {patterHours > 0 && <p className="facts">{t("trade.patter", { hours: patterHours })}</p>}
            </>
          )}
          <button
            type="button"
            className="commit"
            onClick={() => commit({ type: mode, good, units })}
          >
            {mode === "buy"
              ? t("trade.commitBuy", { n: units, total: money(units * unitPrice) })
              : quote && typeof quote !== "string"
                ? t("trade.commitSell", { n: units, total: money(quote.proceeds), hours: quote.hours })
                : ""}
          </button>
        </>
      )}
    </Sheet>
  );
}

function ProfitChip({ profit }: { profit: number }) {
  if (profit < 0) return <Chip warn>{t("trade.loss", { amount: money(-profit) })}</Chip>;
  return <Chip>{t("trade.profit", { amount: money(profit) })}</Chip>;
}

// ---- Job, day end, upgrade -----------------------------------------------------------

export function TerrySheet({ state, onClose, commit }: CommitProps) {
  const quote = terryOffer(state);
  if (!quote) return null;
  const title = t("terry.title");
  return (
    <Sheet label={title} onClose={onClose} focusHeading>
      <h2 tabIndex={-1}>{title}</h2>
      <p>{terryQuoteLine(quote)} {t("terry.noTime")}</p>
      {quote.block && <p className="warn">{t(`card.why.${quote.block}`)}</p>}
      <button type="button" className="commit" disabled={quote.block !== null} onClick={() => commit({ type: "buyTerry" })}>
        {quote.units > 0 ? t("terry.buy", { cost: money(quote.cost) }) : t("terry.unavailable")}
      </button>
    </Sheet>
  );
}

export function JobSheet({ state, onClose, commit }: CommitProps) {
  const q = quoteJob(state);
  if (typeof q === "string") return null;
  return (
    <Sheet label={t("job.title")} onClose={onClose} focusHeading>
      <h2 tabIndex={-1}>{t("job.title")}</h2>
      <p>{t("job.story", { low: money(q.pay[0]), high: money(q.pay[1]), at: caseAt(state.place) })}</p>
      <QuoteWarning state={state} />
      <p className="chips-line">
        <Chip kind="chance">{jobSuccessText(q.success)}</Chip>
        <RiskChip chance={q.stopChance} />
      </p>
      <button type="button" className="commit" onClick={() => commit({ type: "pullJob" })}>
        {t("job.commit", { hours: q.hours })}
      </button>
    </Sheet>
  );
}

function QuoteWarning({ state }: { state: GameState }) {
  const c = localCase(state, true);
  const sweep = state.events.find((e) => e.kind === "sweep" && e.activated && e.place === state.place);
  if (c) return <CaseNotice heading="h3" notice={operationNotice(c, state.day)} />;
  return sweep?.kind === "sweep" ? <CaseNotice heading="h3" notice={sweepNotice(sweep)} /> : null;
}

export function CallDaySheet({ state, onClose, commit }: CommitProps) {
  return (
    <Sheet label={t("callDay.title")} onClose={onClose}>
      <h2>{t("callDay.title")}</h2>
      <p>{t("callDay.story", { hours: hoursLeft(state) })}</p>
      <button type="button" className="commit" onClick={() => commit({ type: "callItADay" })}>
        {t("callDay.commit")}
      </button>
    </Sheet>
  );
}

export function UpgradeSheet({ state, upgrade, onClose, commit }: CommitProps & { upgrade: UpgradeId }) {
  if (upgrade === "crown") return <CrownSheet state={state} onClose={onClose} commit={commit} />;
  const name = upgradeName(upgrade);
  const cost = money(UPGRADE_COST[upgrade]);
  return (
    <Sheet label={name} onClose={onClose}>
      <h2>{name}</h2>
      <p>{t(`upgrade.${upgrade}.what`, { pockets: RULES.coatPockets, from: RULES.pockets, takings: money(PINCH.crownTakings) })}</p>
      <button
        type="button"
        className="commit"
        disabled={state.cash < UPGRADE_COST[upgrade]}
        onClick={() => commit({ type: "buyUpgrade", upgrade })}
      >
        {t("upgrade.commit", { name: name.toLowerCase(), cost })}
      </button>
    </Sheet>
  );
}

/** The Crown & Anchor: Old Reg's dossier and the first chapter's choice. */
function CrownSheet({ state, onClose, commit }: CommitProps) {
  const cost = money(UPGRADE_COST.crown);
  return (
    <Sheet label={upgradeName("crown")} onClose={onClose} className="card">
      <div className="dossier">
        <Portrait who="reg" />
        <div className="dossier-text">
          <p className="dossier-who">{t("crown.who")}</p>
          <p>{t("crown.story", { cost })}</p>
        </div>
      </div>
      <div className="choices">
        <button
          type="button"
          className="choice-card"
          disabled={state.cash < UPGRADE_COST.crown}
          onClick={() => commit({ type: "buyUpgrade", upgrade: "crown" })}
        >
          <span className="choice-title">{t("crown.buy")}</span>
          <span className="action-chips">
            <Chip warn>{t("chip.cost", { amount: cost })}</Chip>
            <Chip>{t("paper.chip.pub", { amount: money(PINCH.crownTakings) })}</Chip>
          </span>
        </button>
        <button type="button" className="choice-card" onClick={onClose}>
          <span className="choice-title">{t("crown.notYet")}</span>
        </button>
      </div>
    </Sheet>
  );
}
