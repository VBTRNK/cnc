import "@fontsource/anton/latin-400.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/courier-prime/latin-400.css";
import "@fontsource/courier-prime/latin-700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { GameSession } from "./game/session.ts";
import { KEYS, webStore } from "./game/store.ts";
import { claimWriter } from "./game/tabs.ts";
import "./styles.css";

const randomWord = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");

  let session: GameSession | null = null;
  const writer = await claimWriter(() => session?.takeOver());
  session = new GameSession(
    webStore(() => window.localStorage),
    { writer, makeSeed: randomWord, makeId: randomId },
  );
  const s = session;
  // A watching tab follows the writing tab's saves.
  window.addEventListener("storage", (e) => {
    if (e.key === KEYS.save) s.follow();
  });

  createRoot(root).render(
    <StrictMode>
      <App session={s} />
    </StrictMode>,
  );
}

void boot();
