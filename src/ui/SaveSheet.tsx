import { useRef, useState } from "react";
import type { GameState } from "../sim/index.ts";
import type { GameSession, SaveStatus } from "../game/session.ts";
import { download, saveFileName } from "./files.ts";
import { Sheet } from "./Sheet.tsx";
import { t, type TextKey } from "./text.ts";

interface SaveSheetProps {
  session: GameSession;
  state: GameState;
  save: SaveStatus;
  onClose: () => void;
}

type Step = { kind: "menu"; error: TextKey | null } | { kind: "import"; state: GameState } | { kind: "newRun" };

/** Export, import and starting over. Whatever is replaced is kept as a recovery copy. */
export function SaveSheet({ session, state, save, onClose }: SaveSheetProps) {
  const [step, setStep] = useState<Step>({ kind: "menu", error: null });
  const fileRef = useRef<HTMLInputElement>(null);

  const exportSave = () => {
    const text = session.exportText();
    if (text) download(text, saveFileName(state.day));
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
          <p>{t(`save.${save}`)}</p>
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
          </div>
        </>
      )}
      {step.kind === "import" && (
        <>
          <p>{t("save.import.confirm", { current: state.day, day: step.state.day })}</p>
          <div className="stack">
            <button
              type="button"
              className="commit"
              onClick={() => {
                session.replace(step.state, "imported");
                onClose();
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
                session.newRun();
                onClose();
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
