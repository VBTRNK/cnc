import { useEffect, useState, useSyncExternalStore } from "react";
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
import { Status } from "./ui/Status.tsx";
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

  return (
    <div className="app">
      <div className="rail">
        <Status state={state} />
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
              refusal={snap.refusal}
              dismissed={dismissed}
              onDismiss={(id) => setDismissed(new Set([...dismissed, id]))}
              onOpen={setOverlay}
              dispatch={session.dispatch}
            />
          )}
          {tab === "city" && (
            <City
              state={state}
              events={snap.events}
              dispatch={travel}
              onRing={() => session.dispatch({ type: "ringRound" })}
            />
          )}
          {tab === "people" && <People state={state} />}
          {tab === "me" && <Me state={state} save={snap.save} sync={cloud.sync} onOpen={setOverlay} />}
        </fieldset>
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
