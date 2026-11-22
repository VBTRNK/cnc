import { PINCH, RULES, SKILLS, UPGRADES, UPGRADE_COST, has, level, type GameState } from "../sim/index.ts";
import type { SaveStatus } from "../game/session.ts";
import type { SyncStatus } from "../game/sync.ts";
import { saveLine } from "./Cloud.tsx";
import { Marks } from "./bits.tsx";
import type { Overlay } from "./overlay.ts";
import { money, skillName, t, upgradeName } from "./text.ts";

interface MeProps {
  state: GameState;
  save: SaveStatus;
  sync: SyncStatus | null;
  onOpen: (overlay: Overlay) => void;
}

/** The character: Classifieds (upgrades), Form (skills earned by doing) and the save. */
export function Me({ state, save, sync, onOpen }: MeProps) {
  const values = { pockets: RULES.coatPockets, from: RULES.pockets, takings: money(PINCH.crownTakings) };
  const forSale = UPGRADES.filter((u) => !has(state, u));
  const owned = UPGRADES.filter((u) => has(state, u));
  return (
    <>
      <section aria-labelledby="k-ads">
        <h2 className="kicker" id="k-ads">
          {t("me.classifieds")}
        </h2>
        {forSale.map((u) => {
          const cost = UPGRADE_COST[u];
          return (
            <article key={u} className="paper-note ad">
              <h3 className="ad-name">{upgradeName(u)}</h3>
              <p className="ad-what">{t(`upgrade.${u}.what`, values)}</p>
              <div className="ad-foot">
                <span className="ad-cost">{money(cost)}</span>
                {state.cash >= cost ? (
                  <button
                    type="button"
                    className="buy"
                    aria-label={t(`upgrade.${u}.buyLabel`, { cost: money(cost) })}
                    onClick={() => onOpen({ kind: "upgrade", upgrade: u })}
                  >
                    {t("upgrade.buy")}
                  </button>
                ) : (
                  <span className="ad-short">{t("upgrade.short", { amount: money(cost - state.cash) })}</span>
                )}
              </div>
            </article>
          );
        })}
        {owned.length > 0 && (
          <ul className="owned-list">
            {owned.map((u) => (
              <li key={u} className="owned-row">
                <span>
                  <span className="owned-name">{upgradeName(u)}</span> <span className="owned-what">{t(`upgrade.${u}.owned`, values)}</span>
                </span>
                <span className="yours">{t("upgrade.owned")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="k-form">
        <h2 className="kicker" id="k-form">
          {t("me.form")}
        </h2>
        <ul className="form">
          {SKILLS.map((k) => {
            const lv = level(state.xp[k]);
            return (
              <li key={k} className="skill">
                <h3 className="skill-name">{skillName(k)}</h3>
                <span className="skill-level" aria-hidden="true">
                  {lv}
                </span>
                <span className="visually-hidden">{t("skill.level", { level: lv })}</span>
                <Marks className="pips" filled={lv} total={RULES.levels.length} />
                <p className="skill-what">{t(`skill.${k}.what`)}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="k-print">
        <h2 className="kicker" id="k-print">
          {t("me.smallPrint")}
        </h2>
        <p className="save-line">{saveLine(save, sync)}</p>
        <button type="button" className="choice save-button" onClick={() => onOpen({ kind: "save" })}>
          {t("me.saveOptions")}
        </button>
      </section>
    </>
  );
}
