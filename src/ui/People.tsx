import { useEffect, useRef, useState } from "react";
import { PINCH, type GameState } from "../sim/index.ts";
import { Chevron } from "./bits.tsx";
import { CaseNotice } from "./CaseNotice.tsx";
import { archivedCase, caseResult, currentCaseNotice, observation, resolvedCaseNotice } from "./caseWords.ts";
import { Portrait } from "./Portrait.tsx";
import { t } from "./text.ts";
import { castLines, dougieNotice, exhibits } from "./words.ts";

/**
 * Pinch's file on top, closed by default: his line, the exhibits' letters and the newest one.
 * Opened, it lists every exhibit newest first and his earlier operations. The cast below.
 */
export function People({ state }: { state: GameState }) {
  const [open, setOpen] = useState(false);
  const pinned = exhibits(state);
  const newest = pinned.at(-1);
  const cases = [...state.milestones.cases].reverse();
  const active = state.detective.case;
  const latest = active ? undefined : cases.shift();
  const older = state.milestones.older.closed + state.milestones.older.cold;
  const name = t(state.detective.promoted ? "people.pinch.inspector" : "people.pinch.sergeant");
  const hasFile = pinned.length > 0 || cases.length > 0 || older > 0;
  const loan = dougieNotice(state);

  // Opening pushes the toggle down the page, so focus goes to what it revealed; closing brings
  // it back into view.
  const firstHead = useRef<HTMLHeadingElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    if (open) firstHead.current?.focus();
    else toggle.current?.focus();
  }, [open]);

  const toggleFile = () => {
    toggled.current = true;
    setOpen(!open);
  };

  return (
    <>
      <section className="board" aria-label={name}>
        <div className="board-head">
          <Portrait who="pinch" />
          <div>
            <h1 className="board-who">{name}</h1>
          </div>
        </div>

        {active ? <CaseNotice notice={currentCaseNotice(state, active)} /> : latest ? (
          <CaseNotice notice={resolvedCaseNotice(latest)} />
        ) : <p>{t(state.day >= PINCH.introDay ? "people.pinch.watching" : "people.pinch.unaware")}</p>}

        {hasFile && (
          <button ref={toggle} type="button" className="toggle" aria-expanded={open} aria-controls="pinch-file" onClick={toggleFile}>
            <span>{t(open ? "people.file.close" : "people.file.open")}</span>
            <span className="toggle-figure">
              {!open && pinned.length > 0 && (pinned.length === 1 ? t("people.exhibits.one") : t("people.exhibits.count", { n: pinned.length }))}
              <Chevron to={open ? "up" : "down"} className="toggle-chev" />
            </span>
          </button>
        )}

        {!open && newest && (
          <>
            <p className="letters">
              <span className="label">{t("people.exhibits")}</span>
              {pinned.map((x) => (
                <span key={x.letter} className={x === newest ? "letter letter-new" : "letter"}>
                  {x.letter}
                </span>
              ))}
            </p>
            <div className="paper-note">
              <p className="exhibit-letter">{t("people.exhibit.newest", { letter: newest.letter })}</p>
              <p>{newest.what}</p>
              <p className="exhibit-reading">{newest.reading}</p>
            </div>
          </>
        )}

        <div id="pinch-file" hidden={!open}>
          {open && <>
            {(cases.length > 0 || older > 0) && (
              <>
                <h2 ref={firstHead} tabIndex={-1} className="label file-label">{t("people.cases")}</h2>
                <ul className="cases">
                  {cases.map((c) => (
                    <li key={c.n} className="case">
                      <p>{caseResult(archivedCase(state, c))}</p>
                      <p>{observation(c).body}</p>
                    </li>
                  ))}
                </ul>
                {older > 0 && (
                  <p className="cases-older">
                    {t("people.case.older", { n: older, closed: state.milestones.older.closed, cold: state.milestones.older.cold })}
                  </p>
                )}
              </>
            )}
            {pinned.length > 0 && (
              <>
                <h2 ref={cases.length === 0 && older === 0 ? firstHead : undefined} tabIndex={-1} className="label file-label">
                  {t("people.exhibits.newestFirst")}
                </h2>
                <ol className="exhibit-rows">
                  {[...pinned].reverse().map((x) => (
                    <li key={x.letter} className="exhibit-row">
                      <span className={x === newest ? "exhibit-mark exhibit-mark-new" : "exhibit-mark"}>
                        <span>{x.letter}</span>
                      </span>
                      <div>
                        <p>{x.what}</p>
                        <p className="exhibit-reading">{x.reading}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <button type="button" className="toggle" onClick={toggleFile}>{t("people.file.close")}</button>
          </>}
        </div>
      </section>

      {loan && <CaseNotice notice={loan} />}

      <section aria-labelledby="k-cast">
        <h2 className="kicker" id="k-cast">
          {t("people.cast")}
        </h2>
        <ul className="cast">
          {castLines(state).map((c) => (
            <li key={c.who} className="cast-member">
              <Portrait who={c.who} small />
              <div>
                <h3>{c.name}</h3>
                <p>{c.line}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
