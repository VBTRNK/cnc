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

/** The character: skills earned by doing, upgrades bought once, and the save. */
export function Me({ state, save, sync, onOpen }: MeProps) {
  return (
    <>
      <ul className="skills">
        {SKILLS.map((k) => {
          const lv = level(state.xp[k]);
          return (
            <li key={k} className="skill">
              <div className="skill-head">
                <h2>{skillName(k)}</h2>
                <Marks className="pips" filled={lv} total={RULES.levels.length} />
                <span className="visually-hidden">{t("skill.level", { level: lv })}</span>
              </div>
              <p>{t(`skill.${k}.what`)}</p>
            </li>
          );
        })}
      </ul>

      <ul className="upgrades">
        {UPGRADES.map((u) => (
          <li key={u} className="upgrade">
            <div>
              <h2>{upgradeName(u)}</h2>
              <p>
                {t(`upgrade.${u}.what`, { pockets: RULES.coatPockets, from: RULES.pockets, takings: money(PINCH.crownTakings) })}
              </p>
            </div>
            {has(state, u) ? (
              <span className="owned">{t("upgrade.owned")}</span>
            ) : (
              <button
                type="button"
                className="choice"
                aria-label={t("upgrade.buyLabel", { name: upgradeName(u).toLowerCase(), cost: money(UPGRADE_COST[u]) })}
                disabled={state.cash < UPGRADE_COST[u]}
                onClick={() => onOpen({ kind: "upgrade", upgrade: u })}
              >
                {t("upgrade.buy", { cost: money(UPGRADE_COST[u]) })}
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="save-line">
        <p>{saveLine(save, sync)}</p>
        <button type="button" className="choice" onClick={() => onOpen({ kind: "save" })}>
          {t("me.saveOptions")}
        </button>
      </div>
    </>
  );
}
