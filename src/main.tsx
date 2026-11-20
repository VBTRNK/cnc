import "@fontsource/anton/latin-400.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/courier-prime/latin-400.css";
import "@fontsource/courier-prime/latin-700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CODE_KEY, CloudSaves } from "./game/cloudSaves.ts";
import { configuredCloud } from "./game/cloud.ts";
import { claimWriter } from "./game/tabs.ts";
import { CATALOGUE } from "./sim/index.ts";
import "./styles.css";

const randomWord = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");

  // Without these settings the build is guest-only and offers no cloud save. The 12-good test
  // build is guest-only regardless: its saves hold goods the game doesn't know.
  const configured =
    CATALOGUE === "game"
      ? configuredCloud({
          url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
          key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
        })
      : null;
  let saves: CloudSaves | null = null;
  const claim = await claimWriter(() => saves?.takeOver());
  saves = new CloudSaves({
    storage: () => window.localStorage,
    // A cloud code's sync needs a single writing tab; without a held lock, guest play only.
    cloud: claim.coordinated ? configured : null,
    writer: claim.writer,
    makeSeed: randomWord,
    makeId: randomId,
    makeUuid: () => crypto.randomUUID(),
    random: (count) => crypto.getRandomValues(new Uint8Array(count)),
  });
  const a = saves;

  window.addEventListener("storage", (e) => {
    // Another tab switched cloud codes: this one opens the slot it switched to.
    if (e.key === CODE_KEY) window.location.reload();
    // A watching tab follows the writing tab's saves.
    else if (e.key === a.getSnapshot().saveKey) a.getSnapshot().session.follow();
  });
  // Uploads catch up on return to the foreground and on reconnect; hiding the page sends
  // what is unsent, best effort.
  document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? a.flush() : a.wake()));
  window.addEventListener("pagehide", a.flush);
  window.addEventListener("online", a.wake);

  createRoot(root).render(
    <StrictMode>
      <App saves={a} />
    </StrictMode>,
  );
  void a.start();
}

void boot();
