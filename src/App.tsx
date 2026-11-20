import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CloudSaves } from "./game/cloudSaves.ts";
import type { GameSession } from "./game/session.ts";
import type { Conflict } from "./game/sync.ts";
import type { Action } from "./sim/index.ts";
import { CardSheet } from "./ui/CardSheet.tsx";
import { CellsScreen } from "./ui/CellsScreen.tsx";
import { City } from "./ui/City.tsx";
import { CloudChoice } from "./ui/Cloud.tsx";
import { download, saveFileName } from "./ui/files.ts";
import { Me } from "./ui/Me.tsx";
import type { Overlay } from "./ui/overlay.ts";
import { PaperScreen } from "./ui/PaperScreen.tsx";
import { People } from "./ui/People.tsx";
import { CallDaySheet, JobSheet, TradeSheet, UpgradeSheet } from "./ui/Sheets.tsx";
import { SaveSheet } from "./ui/SaveSheet.tsx";
import { ResultStrip, Status } from "./ui/Status.tsx";
import { StopCard } from "./ui/StopCard.tsx";
import { Street } from "./ui/Street.tsx";
import { t } from "./ui/text.ts";
import { resultLines } from "./ui/words.ts";

type Tab = "street" | "city" | "people" | "me";
const TABS: readonly Tab[] = ["street", "city", "people", "me"];

export function App({ saves }: { saves: CloudSaves }) {
  const cloud = useSyncExternalStore(saves.subscribe, saves.getSnapshot);
  const session = cloud.session;
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [tab, setTab] = useState<Tab>("street");
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  /** The night whose cells screen was left, as "run:day"; the paper follows it. */
  const [leftCells, setLeftCells] = useState<string | null>(null);
  /** A conflict the player put off; it comes back from the save sheet or the next check. */
  const [later, setLater] = useState<Conflict | null>(null);
  const { state, mode } = snap;
  const readOnly = mode !== "play";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  // A rail that would take much of the screen (very large text) scrolls away, as in the narrow
  // layout; a result too long to pin (over 40% of the space above the tabs) scrolls with the
  // page too, so play stays in view. What stays at the top (the rail, the strip alone, or
  // nothing) sets --stick-h: City's table head sticks under it, and focus scrolling keeps
  // controls clear of it.
  const measureRail = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const root = document.documentElement;
    const parts = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
    const strip = parts.at(-1);
    const tabs = el.parentElement?.querySelector<HTMLElement>(".tabs");
    const sticky = (e: HTMLElement) => {
      const cs = getComputedStyle(e);
      return cs.position === "sticky" && cs.display !== "contents";
    };
    const update = () => {
      const height = parts.reduce((n, p) => n + p.offsetHeight, 0);
      root.toggleAttribute("data-tall-rail", height > window.innerHeight * 0.4);
      const below = tabs && getComputedStyle(tabs).position === "fixed" ? tabs.offsetHeight : 0;
      root.toggleAttribute("data-tall-strip", !!strip && strip.offsetHeight > (window.innerHeight - below) * 0.4);
      const stuck = sticky(el) ? height : strip && sticky(strip) ? strip.offsetHeight : 0;
      root.style.setProperty("--stick-h", `${stuck}px`);
    };
    const ro = new ResizeObserver(update);
    for (const p of parts) ro.observe(p);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      root.removeAttribute("data-tall-rail");
      root.removeAttribute("data-tall-strip");
    };
  }, []);

  if (mode === "future" || !state) return <FutureScreen onExport={() => exportSave(session, null)} />;

  // Two runs to choose between: this card comes before anything else, unless put off.
  const conflict = cloud.conflict !== later ? cloud.conflict : null;
  const choice =
    conflict || cloud.link.kind === "choose" ? (
      <CloudChoice
        // The device's side is the run in play now, which is what keeping it uploads.
        conflict={conflict && { ...conflict, device: state }}
        link={cloud.link}
        cloud={saves}
        session={session}
        onLater={() => (conflict ? setLater(conflict) : saves.dismiss())}
      />
    ) : null;

  const close = () => setOverlay(null);
  const commit = (action: Action) => {
    setOverlay(null);
    session.dispatch(action);
  };
  const travel = (action: Action) => {
    if (session.dispatch(action)) setTab("street");
  };

  const banners = (
    <>
      {mode === "watch" && <p className="banner">{t("watch.banner")}</p>}
      {(snap.save === "full" || snap.save === "failed" || snap.save === "off") && (
        <div className="banner banner-warn" role="alert">
          <p>{t(`save.${snap.save}`)}</p>
          <button type="button" className="choice" onClick={() => exportSave(session, state.day)}>
            {t("save.export")}
          </button>
        </div>
      )}
      {snap.notice && (
        <div className="banner">
          <p>{t(`notice.${snap.notice}`)}</p>
          {snap.notice === "lost" && session.keptText() && (
            <button type="button" className="choice" onClick={() => downloadKept(session)}>
              {t("save.exportKept")}
            </button>
          )}
          <button type="button" className="icon-button" aria-label={t("dismiss")} onClick={session.dismissNotice}>
            ×
          </button>
        </div>
      )}
    </>
  );

  if (state.phase === "night" && state.paper) {
    const paper = state.paper;
    // The action that ended the day still gets its line, before the paper takes over.
    const last = snap.events.some((e) => e.type === "dayEnded") ? resultLines(snap.events, state) : [];
    const night = `${state.runId}:${paper.day}`;
    return (
      <main className="night">
        {banners}
        {paper.log.arrested && leftCells !== night ? (
          <CellsScreen paper={paper} lines={last} onDone={() => setLeftCells(night)} />
        ) : (
          <PaperScreen
            paper={paper}
            last={paper.log.arrested ? [] : last}
            readOnly={readOnly}
            onStart={() => session.dispatch({ type: "startDay" })}
          />
        )}
        {choice}
      </main>
    );
  }

  // The latest result, on every screen, in the strip at the foot of the rail.
  const lines = snap.refusal ? [t("result.refused")] : resultLines(snap.events, state);

  return (
    <div className="app">
      <div className="rail">
        <div className="top" ref={measureRail}>
          <Status state={state} />
          <ResultStrip lines={lines} />
        </div>
        <nav className="tabs" aria-label={t("nav.label")}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {t(`nav.${id}`)}
            </button>
          ))}
        </nav>
      </div>
      <main className="screen">
        {banners}
        <fieldset className="plain" disabled={readOnly}>
          {tab === "street" && (
            <Street
              state={state}
              events={snap.events}
              dismissed={dismissed}
              onDismiss={(id) => setDismissed(new Set([...dismissed, id]))}
              onOpen={setOverlay}
              dispatch={session.dispatch}
            />
          )}
          {tab === "city" && (
            <City state={state} dispatch={travel} onCall={() => session.dispatch({ type: "ringRound" })} />
          )}
          {tab === "me" && <Me state={state} save={snap.save} sync={cloud.sync} onOpen={setOverlay} />}
        </fieldset>
        {/* People has no game actions, only the file's disclosure: a watching tab can read it. */}
        {tab === "people" && <People state={state} />}
      </main>

      {choice ?? (state.pending?.kind === "stop" ? (
        <StopCard state={state} stop={state.pending} dispatch={session.dispatch} readOnly={readOnly} />
      ) : state.pending?.kind === "card" ? (
        <CardSheet state={state} pending={state.pending} dispatch={session.dispatch} readOnly={readOnly} />
      ) : (
        !readOnly &&
        overlay && (
          <>
            {overlay.kind === "trade" && <TradeSheet state={state} good={overlay.good} onClose={close} commit={commit} />}
            {overlay.kind === "job" && <JobSheet state={state} onClose={close} commit={commit} />}
            {overlay.kind === "callDay" && <CallDaySheet state={state} onClose={close} commit={commit} />}
            {overlay.kind === "upgrade" && (
              <UpgradeSheet state={state} upgrade={overlay.upgrade} onClose={close} commit={commit} />
            )}
            {overlay.kind === "save" && (
              <SaveSheet
                session={session}
                state={state}
                save={snap.save}
                cloud={cloud}
                saves={saves}
                onClose={close}
                onChoose={() => {
                  setLater(null);
                  close();
                }}
              />
            )}
          </>
        )
      ))}
    </div>
  );
}

function FutureScreen({ onExport }: { onExport: () => void }) {
  return (
    <main className="night">
      <article className="paper">
        <h1 className="headline">{t("future.title")}</h1>
        <p className="story">{t("future.story")}</p>
        <div className="stack">
          <button type="button" className="commit" onClick={() => window.location.reload()}>
            {t("future.reload")}
          </button>
          <button type="button" className="choice" onClick={onExport}>
            {t("future.export")}
          </button>
        </div>
      </article>
    </main>
  );
}

function exportSave(session: GameSession, day: number | null) {
  const text = session.exportText();
  if (text) download(text, saveFileName(day));
}

function downloadKept(session: GameSession) {
  const text = session.keptText();
  if (text) download(text, "crime-and-crown-damaged-save.json");
}
