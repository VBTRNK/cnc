import { useEffect, useRef, useState } from "react";
import type { CloudSaves, CloudSnapshot, ForgetError, Link, UseError } from "../game/cloudSaves.ts";
import { showCode } from "../game/code.ts";
import type { GameSession, SaveStatus } from "../game/session.ts";
import type { Conflict, SyncStatus } from "../game/sync.ts";
import { hoursLeft, type GameState } from "../sim/index.ts";
import { download, saveFileName } from "./files.ts";
import { Sheet } from "./Sheet.tsx";
import { money, t, when } from "./text.ts";

/** The save's one-line status: the device first, then the cloud (docs/design.md, D12). */
export function saveLine(save: SaveStatus, sync: SyncStatus | null): string {
  if (save !== "saved" || !sync) return t(`save.${save}`);
  switch (sync.kind) {
    case "synced":
      return t("sync.synced", { when: when(sync.at) });
    case "pending":
      return t("sync.pending");
    case "conflict":
      return t("sync.conflict");
    case "failed": {
      const line = t(`sync.failed.${sync.reason}`);
      return sync.at && sync.reason !== "future" ? `${line} ${t("sync.last", { when: when(sync.at) })}` : line;
    }
  }
}

interface CloudSectionProps {
  snap: CloudSnapshot;
  cloud: CloudSaves;
  onStop: (code: string) => void;
  /** Brings back a conflict card the player put off. */
  onChoose: () => void;
}

/** Keeping the run in the cloud, its code, and using a code, at the top of the save sheet. */
export function CloudSection({ snap, cloud, onStop, onChoose }: CloudSectionProps) {
  const [using, setUsing] = useState(false);
  const [error, setError] = useState<"full" | null>(null);
  const [copied, setCopied] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const code = snap.code;

  if (!snap.available || snap.session.getSnapshot().mode !== "play") return null;

  if (using) return <UseCodeForm cloud={cloud} onDone={() => setUsing(false)} />;

  if (!code) {
    return (
      <div className="cloud">
        <p>{t("cloud.guest")}</p>
        {error && (
          <p className="why" role="alert">
            {t(`cloud.error.${error}`)}
          </p>
        )}
        <div className="stack">
          <button type="button" className="choice" onClick={() => setError(cloud.keep())}>
            {t("cloud.keep")}
          </button>
          <button type="button" className="choice" onClick={() => setUsing(true)}>
            {t("cloud.use")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cloud">
      <p className="code-label">{t("cloud.code")}</p>
      <p className="code">{showCode(code)}</p>
      <p className="hint">{t("cloud.codeHelp")}</p>
      {restoreFailed && cloud.missing() && (
        <p className="why" role="alert">
          {t("cloud.error.restore")}
        </p>
      )}
      <div className="stack">
        {snap.conflict && (
          <button type="button" className="commit" onClick={onChoose}>
            {t("choice.open")}
          </button>
        )}
        {cloud.missing() && (
          <button type="button" className="choice" onClick={() => setRestoreFailed(!cloud.restore())}>
            {t("cloud.restore")}
          </button>
        )}
        {typeof navigator !== "undefined" && navigator.clipboard && (
          <button
            type="button"
            className="choice"
            onClick={() => {
              navigator.clipboard.writeText(showCode(code)).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {t(copied ? "cloud.copied" : "cloud.copy")}
          </button>
        )}
        <button type="button" className="choice" onClick={() => onStop(code)}>
          {t("cloud.forget")}
        </button>
      </div>
    </div>
  );
}

interface StopSyncingProps {
  cloud: CloudSaves;
  code: string;
  onExport: () => void;
  onDone: () => void;
}

export function StopSyncing({ cloud, code, onExport, onDone }: StopSyncingProps) {
  const [status, setStatus] = useState<ForgetError | "stopping" | null>(null);
  const stopping = status === "stopping";

  const stop = async (remove: boolean) => {
    setStatus("stopping");
    const error = await cloud.forget(remove);
    if (error) setStatus(error);
    else onDone();
  };

  if (status === "notRemoved") {
    return (
      <>
        <p className="why" role="alert">{t("cloud.error.notRemoved")}</p>
        <div className="stack">
          <button type="button" className="commit" onClick={() => cloud.remove(code) && onDone()}>
            {t("cloud.removeRetry")}
          </button>
          <button type="button" className="choice" onClick={onDone}>
            {t("cloud.removeLeave")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <p>{t("cloud.forget.confirm")}</p>
      {status === "full" && <p className="why" role="alert">{t("cloud.error.stop")}</p>}
      <div className="stack">
        <button type="button" className="commit" disabled={stopping} onClick={() => void stop(false)}>
          {t(stopping ? "cloud.forget.stopping" : "cloud.forget")}
        </button>
      </div>
      <p className="hint">{t("cloud.forget.removeHint")}</p>
      <div className="stack">
        <button type="button" className="choice" disabled={stopping} onClick={onExport}>
          {t("save.export")}
        </button>
        <button type="button" className="choice" disabled={stopping} onClick={() => void stop(true)}>
          {t("cloud.forget.remove")}
        </button>
        <button type="button" className="choice" disabled={stopping} onClick={onDone}>
          {t("save.cancel")}
        </button>
      </div>
    </>
  );
}

function UseCodeForm({ cloud, onDone }: { cloud: CloudSaves; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UseError | null>(null);
  // Only this form's own lookup, answered while it is still open, finishes it.
  const open = useRef(true);
  // Closing the sheet walks away from a lookup still in flight.
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      cloud.cancel();
    };
  }, [cloud]);

  return (
    <form
      className="cloud"
      onSubmit={(e) => {
        e.preventDefault();
        const typed = String(new FormData(e.currentTarget).get("code") ?? "");
        setBusy(true);
        setError(null);
        void cloud.use(typed).then((r) => {
          if (!open.current || r === "cancelled") return;
          setBusy(false);
          if (r) setError(r);
          else onDone();
        });
      }}
    >
      <label className="field">
        <span>{t("cloud.code")}</span>
        <input
          name="code"
          className="code-input"
          required
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX"
        />
      </label>
      {error && (
        <p className="why" role="alert">
          {t(`cloud.error.${error}`)}
        </p>
      )}
      <div className="stack">
        <button type="submit" className="commit" disabled={busy}>
          {t(busy ? "cloud.checking" : "cloud.useCommit")}
        </button>
        <button
          type="button"
          className="choice"
          onClick={() => {
            cloud.cancel();
            onDone();
          }}
        >
          {t("save.cancel")}
        </button>
      </div>
    </form>
  );
}

interface CloudChoiceProps {
  /** The conflict to settle, unless the player put it off. */
  conflict: Conflict | null;
  link: Link;
  cloud: CloudSaves;
  session: GameSession;
  /** Puts the choice off: a conflict waits (uploads stay paused), a guest-run choice ends. */
  onLater: () => void;
}

/**
 * Two runs and the player picks one: a conflict, or a guest run meeting the cloud's. If
 * the choice can't be stored, the card says so and offers an export; "Not now" leaves
 * without choosing.
 */
export function CloudChoice({ conflict, link, cloud, session, onLater }: CloudChoiceProps) {
  const [failed, setFailed] = useState(false);
  const after = (
    <>
      {failed && (
        <p className="why" role="alert">
          {t("choice.failed")}
        </p>
      )}
      <div className="stack">
        {failed && (
          <button type="button" className="choice" onClick={() => exportRun(session)}>
            {t("save.export")}
          </button>
        )}
        <button type="button" className="choice" onClick={onLater}>
          {t("choice.later")}
        </button>
      </div>
    </>
  );
  if (conflict) {
    return (
      <Sheet label={t("choice.title")} blocking className="card">
        <h2>{t("choice.title")}</h2>
        <p>{t("choice.conflict")}</p>
        <div className="choices">
          {conflict.device && (
            <button type="button" className="choice-card" onClick={() => setFailed(!cloud.resolve("device"))}>
              <span className="choice-title">{t("choice.keepDevice")}</span>
              <Side label={t("choice.device")} state={conflict.device} other={conflict.cloud} />
            </button>
          )}
          <button
            type="button"
            className="choice-card"
            disabled={!conflict.cloud}
            onClick={() => setFailed(!cloud.resolve("cloud"))}
          >
            <span className="choice-title">{t("choice.keepCloud")}</span>
            <Side
              label={t("choice.cloud")}
              state={conflict.cloud}
              other={conflict.device}
              saved={conflict.cloudAt}
            />
          </button>
        </div>
        {after}
      </Sheet>
    );
  }
  if (link.kind !== "choose") return null;
  return (
    <Sheet label={t("choice.title")} blocking className="card">
      <h2>{t("choice.title")}</h2>
      <p>{t("choice.guest")}</p>
      <div className="choices">
        <button type="button" className="choice-card" onClick={() => setFailed(cloud.choose("cloud") !== null)}>
          <span className="choice-title">{t("choice.playCloud")}</span>
          <Side label={t("choice.cloud")} state={link.cloud} other={link.guest} saved={link.cloudAt} />
        </button>
        <button type="button" className="choice-card" onClick={() => setFailed(cloud.choose("guest") !== null)}>
          <span className="choice-title">{t("choice.keepGuest")}</span>
          <Side label={t("choice.guestRun")} state={link.guest} other={link.cloud} />
        </button>
      </div>
      {after}
    </Sheet>
  );
}

/** One run in a choice: where it is, how far it got, and when it was saved. */
function Side({ label, state, other, saved }: { label: string; state: GameState | null; other: GameState | null; saved?: string }) {
  if (!state) {
    return (
      <span className="choice-after">
        {label}: {t("choice.unreadable")}
      </span>
    );
  }
  const values = { day: state.day, hours: state.phase === "day" ? hoursLeft(state) : 0, cash: money(state.cash) };
  return (
    <span className="choice-after">
      {t(state.phase === "day" ? "choice.day" : "choice.night", values)}
      {other && other.runId !== state.runId && (
        <>
          <br />
          {t("choice.otherRun")}
        </>
      )}
      {saved && (
        <>
          <br />
          {t("choice.saved", { when: when(saved) })}
        </>
      )}
    </span>
  );
}

function exportRun(session: GameSession) {
  const text = session.exportText();
  const state = session.getSnapshot().state;
  if (text) download(text, saveFileName(state?.day ?? null));
}
