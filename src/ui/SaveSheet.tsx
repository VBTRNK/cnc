import { useRef, useState } from "react";
import type { GameState } from "../sim/index.ts";
import type { CloudSaves, CloudSnapshot } from "../game/cloudSaves.ts";
import type { GameSession, SaveStatus } from "../game/session.ts";
import { CloudSection, saveLine, StopSyncing } from "./Cloud.tsx";
import { download, saveFileName } from "./files.ts";
import { Sheet } from "./Sheet.tsx";
import { t, type TextKey } from "./text.ts";

interface SaveSheetProps {
  session: GameSession;
  state: GameState;
  save: SaveStatus;
  cloud: CloudSnapshot;
  saves: CloudSaves;
  onClose: () => void;
  /** Brings back a conflict card the player put off. */
  onChoose: () => void;
}

type Step =
  | { kind: "menu"; error: TextKey | null }
  | { kind: "stop"; code: string }
  | { kind: "import"; state: GameState }
  | { kind: "newRun" };

/** The cloud save, export, import and starting over. Whatever is replaced is kept as a recovery copy. */
export function SaveSheet({ session, state, save, cloud, saves, onClose, onChoose }: SaveSheetProps) {
  const [step, setStep] = useState<Step>({ kind: "menu", error: null });
  const fileRef = useRef<HTMLInputElement>(null);

  const exportSave = () => {
    const text = session.exportText();
    if (text) download(text, saveFileName(state.day));
  };

  const exportRecovery = () => {
    const text = session.recoveryText();
    if (text) download(text, "crime-and-crown-recovery-copy.json");
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setStep({ kind: "menu", error: "save.import.unreadable" });
      return;
    }
    const r = session.readImport(text);
    if (r.ok) setStep({ kind: "import", state: r.state });
    else setStep({ kind: "menu", error: `save.import.${r.error}` });
  };

  return (
    <Sheet label={t("save.title")} onClose={onClose}>
      <h2>{t("save.title")}</h2>
      {step.kind === "menu" && (
        <>
          <p>{saveLine(save, cloud.sync)}</p>
          <CloudSection
            snap={cloud}
            cloud={saves}
            onChoose={onChoose}
            onStop={(code) => setStep({ kind: "stop", code })}
          />
          {step.error && (
            <p className="why" role="alert">
              {t(step.error)}
            </p>
          )}
          <div className="stack">
            <button type="button" className="choice" onClick={exportSave}>
              {t("save.export")}
            </button>
            <button type="button" className="choice" onClick={() => fileRef.current?.click()}>
              {t("save.import")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button type="button" className="choice" onClick={() => setStep({ kind: "newRun" })}>
              {t("save.newRun")}
            </button>
            {session.recoveryText() !== null && (
              <button type="button" className="choice" onClick={exportRecovery}>
                {t("save.exportRecovery")}
              </button>
            )}
          </div>
        </>
      )}
      {step.kind === "stop" && (
        <StopSyncing
          cloud={saves}
          code={step.code}
          onExport={exportSave}
          onDone={() => setStep({ kind: "menu", error: null })}
        />
      )}
      {step.kind === "import" && (
        <>
          <p>{t("save.import.confirm", { current: state.day, day: step.state.day })}</p>
          <div className="stack">
            <button
              type="button"
              className="commit"
              onClick={() => {
                if (session.replace(step.state, "imported")) onClose();
                else setStep({ kind: "menu", error: "save.replaceFailed" });
              }}
            >
              {t("save.import.commit")}
            </button>
            <button type="button" className="choice" onClick={() => setStep({ kind: "menu", error: null })}>
              {t("save.cancel")}
            </button>
          </div>
        </>
      )}
      {step.kind === "newRun" && (
        <>
          <p>{t("save.newRun.confirm")}</p>
          <div className="stack">
            <button
              type="button"
              className="commit"
              onClick={() => {
                if (session.newRun()) onClose();
                else setStep({ kind: "menu", error: "save.replaceFailed" });
              }}
            >
              {t("save.newRun.commit")}
            </button>
            <button type="button" className="choice" onClick={() => setStep({ kind: "menu", error: null })}>
              {t("save.cancel")}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
