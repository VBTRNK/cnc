import type { GameState } from "../sim/index.ts";
import { Portrait } from "./Portrait.tsx";
import { t } from "./text.ts";
import { castLines, exhibits, pastCaseLine, pinchLine } from "./words.ts";

/** Pinch's board of exhibits and cases on top; below it the cast, one current line each. */
export function People({ state }: { state: GameState }) {
  const pinned = exhibits(state);
  const cases = [...state.milestones.cases].reverse();
  const older = state.milestones.older.closed + state.milestones.older.cold;
  return (
    <>
      <section className="board" aria-label={t(state.detective.promoted ? "people.pinch.inspector" : "people.pinch.sergeant")}>
        <div className="board-head">
          <Portrait who="pinch" />
          <div className="dossier-text">
            <h1 className="dossier-who">
              {t(state.detective.promoted ? "people.pinch.inspector" : "people.pinch.sergeant")}
            </h1>
            <p>{pinchLine(state)}</p>
          </div>
        </div>
        {pinned.length > 0 && (
          <ol className="exhibits">
            {pinned.map((x) => (
              <li key={x.letter} className="exhibit">
                <p className="exhibit-letter">{t("people.exhibit", { letter: x.letter })}</p>
                <p>{x.what}</p>
                <p className="exhibit-reading">{x.reading}</p>
              </li>
            ))}
          </ol>
        )}
        {cases.length > 0 && (
          <ul className="cases">
            {cases.map((c) => (
              <li key={c.n} className="case">
                <p>{pastCaseLine(c)}</p>
                <p className="stamp">{t(c.outcome === "closed" ? "people.case.closed" : "people.case.cold")}</p>
              </li>
            ))}
          </ul>
        )}
        {older > 0 && (
          <p className="cases-older">
            {t("people.case.older", { n: older, closed: state.milestones.older.closed, cold: state.milestones.older.cold })}
          </p>
        )}
      </section>

      <ul className="cast">
        {castLines(state).map((c) => (
          <li key={c.who} className="cast-member">
            <Portrait who={c.who} small />
            <div>
              <h2>{c.name}</h2>
              <p>{c.line}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
