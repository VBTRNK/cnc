import { useState } from "react";
import {
  RULES,
  UPGRADE_COST,
  carried,
  hoursLeft,
  maxBuy,
  maxSale,
  pockets,
  price,
  priceHint,
  quoteJob,
  quoteSale,
  type Action,
  type GameState,
  type GoodId,
  type UpgradeId,
} from "../sim/index.ts";
import { Chip, RiskChip } from "./bits.tsx";
import { Sheet } from "./Sheet.tsx";
import { goodName, money, t, upgradeName, type TextKey } from "./text.ts";
import { oddsText } from "./words.ts";

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

export function TradeSheet({ state, good, onClose, commit }: CommitProps & { good: GoodId }) {
  const canSell = maxSale(state, good) > 0;
  const [mode, setMode] = useState<"buy" | "sell">(canSell ? "sell" : "buy");
  const max = mode === "buy" ? maxBuy(state, good) : maxSale(state, good);
  const [chosen, setChosen] = useState<number | null>(null);
  const units = Math.min(Math.max(chosen ?? max, max > 0 ? 1 : 0), max);
  const block = mode === "buy" ? buyBlock(state, good) : sellBlock(state, good);
  const unitPrice = price(state, state.place, good);
  const hint = priceHint(state, state.place, good);
  const quote = mode === "sell" && units > 0 ? quoteSale(state, good, units) : null;
  const switchTo = (m: "buy" | "sell") => {
    setMode(m);
    setChosen(null);
  };

  return (
    <Sheet label={goodName(good)} onClose={onClose}>
      <div className="sheet-head">
        <h2>{goodName(good)}</h2>
        <p className="sheet-price">
          <span className="money">{money(unitPrice)}</span>
          {hint && <span className="hint-word">{t(`hint.${hint}`)}</span>}
        </p>
      </div>
      <p className="facts">
        {t("trade.facts", {
          held: state.held[good],
          stock: state.market[state.place][good].stock,
          free: pockets(state) - carried(state),
        })}
      </p>

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
          <div className="stepper">
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
            <button type="button" className="stepper-max" disabled={units === max} onClick={() => setChosen(max)}>
              {t("trade.max")}
            </button>
          </div>
          {quote && typeof quote !== "string" && (
            <p className="chips-line">
              <RiskChip chance={quote.stopChance} />
            </p>
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

// ---- Job, day end, upgrade -----------------------------------------------------------

export function JobSheet({ state, onClose, commit }: CommitProps) {
  const q = quoteJob(state);
  if (typeof q === "string") return null;
  return (
    <Sheet label={t("job.title")} onClose={onClose}>
      <h2>{t("job.title")}</h2>
      <p>{t("job.story", { low: money(q.pay[0]), high: money(q.pay[1]) })}</p>
      <p className="chips-line">
        <Chip kind="chance">{oddsText(q.success)}</Chip>
        <RiskChip chance={q.stopChance} />
      </p>
      <button type="button" className="commit" onClick={() => commit({ type: "pullJob" })}>
        {t("job.commit", { hours: q.hours })}
      </button>
    </Sheet>
  );
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
  const name = upgradeName(upgrade);
  const cost = money(UPGRADE_COST[upgrade]);
  return (
    <Sheet label={name} onClose={onClose}>
      <h2>{name}</h2>
      <p>{t(`upgrade.${upgrade}.what`, { pockets: RULES.coatPockets, from: RULES.pockets })}</p>
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
