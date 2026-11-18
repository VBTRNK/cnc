// Browser flows on the production build under its real headers (docs/design.md, "How it
// is built"): drives `npm run preview` in a headless Chromium over the DevTools protocol
// with a phone viewport, touch and keys, and fails on any console error or CSP violation.
//
//   npm run build && npm run preview       (in one terminal)
//   npm run browser-check [-- <outdir>]    (screenshots go to <outdir>, default: a temp dir)
//
// BROWSER names a Chromium-based browser; the default is Edge on Windows. The page's
// storage is cleared first, so run it against a profile of its own (it makes one).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), "cnc-browser-check-"));
const REPO = join(import.meta.dirname, "..");
const URL0 = process.env.PREVIEW_URL ?? "http://localhost:4173/";
const BROWSER = process.env.BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
mkdirSync(OUT, { recursive: true });
const DL = join(OUT, "downloads");
mkdirSync(DL, { recursive: true });

const sim = await import(pathToFileURL(`${REPO}/src/sim/index.ts`).href);
const testing = await import(pathToFileURL(`${REPO}/src/sim/testing.ts`).href);

const edge = spawn(BROWSER, [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9333", "--no-first-run",
  `--user-data-dir=${join(OUT, "profile")}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 50 && !version; i++) {
  try { version = await (await fetch("http://127.0.0.1:9333/json/version")).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const pending = new Map();
const problems = [];
const log = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
    problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  } else if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level)) {
    problems.push(`log.${msg.params.entry.source}: ${msg.params.entry.text}`);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

async function newPage() {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s("Page.enable"); await s("Runtime.enable"); await s("Log.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s("Page.addScriptToEvaluateOnNewDocument", {
    source: `document.addEventListener("securitypolicyviolation", e => console.error("CSP violation", e.violatedDirective, e.blockedURI));`,
  });
  return { s, targetId };
}

const page = await newPage();
const s = page.s;
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });

const evaluate = async (expr, ss = s) => {
  const r = await ss("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const go = async (url = URL0, ss = s) => { await ss("Page.navigate", { url }); await sleep(1200); };
const reload = async () => { await s("Page.reload", {}); await sleep(1200); };
let shot = 0;
const snap = async (name) => {
  const { data } = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(OUT, `${String(++shot).padStart(2, "0")}-${name}.png`), Buffer.from(data, "base64"));
};
/** Taps the visible element matching the selector whose text contains `text`. */
const tap = async (selector, text = "") => {
  const box = await evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.textContent.includes(${JSON.stringify(text)}) || (e.getAttribute("aria-label") ?? "").includes(${JSON.stringify(text)}));
    const el = els.find(e => e.getClientRects().length > 0);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!el.disabled };
  })()`);
  if (!box) throw new Error(`no ${selector} with "${text}"`);
  await s("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
  await s("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(250);
  return box;
};
const key = async (k, code = k, keyCode = 0) => {
  await s("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: keyCode, ...(k === "Enter" ? { text: String.fromCharCode(13) } : {}) });
  await s("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: keyCode });
  await sleep(120);
};
const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const focused = () => evaluate(`(document.activeElement?.textContent || document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName || "").trim().slice(0, 60)`);
const check = (name, ok, detail = "") => log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);

try {
  // ---- First load, Street on a phone ------------------------------------------------
  await go();
  await evaluate(`localStorage.clear()`);
  await reload();
  await snap("street-day1");
  check("Street renders the Docks", (await text(".place-name")) === "The Docks", await text(".place-name"));
  check("fonts loaded from this origin", await evaluate(`document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family).join(","))`).then((f) => { log.push(`  fonts: ${f}`); return /Anton/.test(f) && /Newsreader/.test(f) && /Courier Prime/.test(f); }));
  check("no horizontal scroll at 390px", await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
  check("manifest linked", (await evaluate(`fetch("/manifest.webmanifest").then(r => r.json()).then(m => m.icons.length)`)) === 4);

  // ---- Buy by touch -------------------------------------------------------------------
  await tap("button.good", "Untaxed smokes");
  await snap("trade-sheet-buy");
  check("trade sheet open as modal", await evaluate(`document.querySelector("dialog.sheet")?.open === true`));
  const buyLabel = await text("dialog .commit");
  check("buy commit names trade and total", /^Buy \d+ for \$\d+$/.test(buyLabel), buyLabel);
  await tap("dialog .stepper button", "One fewer");
  await tap("dialog .commit");
  await snap("after-buy");
  check("inline result after buying", /^Bought \d+ cartons of smokes for \$\d+\.$/.test(await text(".result")), await text(".result"));
  check("sheet closed after commit", await evaluate(`!document.querySelector("dialog.sheet")`));

  // ---- Keyboard: open a sheet, Escape closes it, focus returns -------------------------
  await evaluate(`document.querySelector("button.good").focus()`);
  await key("Enter", "Enter", 13);
  await sleep(200);
  check("Enter opens the sheet", await evaluate(`document.querySelector("dialog.sheet")?.open === true`));
  check("focus moved into the sheet", await evaluate(`!!document.activeElement.closest("dialog")`), await focused());
  for (let i = 0; i < 12; i++) await key("Tab", "Tab", 9);
  check("Tab stays inside the sheet", await evaluate(`!!document.activeElement.closest("dialog")`), await focused());
  await key("Escape", "Escape", 27);
  await sleep(200);
  check("Escape closes the sheet", await evaluate(`!document.querySelector("dialog.sheet")`));
  check("focus restored to the good row", await evaluate(`document.activeElement?.classList.contains("good")`), await focused());

  // ---- City, travel, sell ---------------------------------------------------------------
  await tap(".tabs button", "City");
  await snap("city");
  await tap("button.go", "The Strip");
  check("travel lands on Street at the Strip", (await text(".place-name")) === "The Strip", await text(".place-name"));
  check("focus on the place after travel", await evaluate(`document.activeElement?.classList.contains("place-name")`), await focused());
  await tap("button.good", "Untaxed smokes");
  check("sell is the default with goods held", await evaluate(`document.querySelector('dialog [aria-pressed="true"]')?.textContent === "Sell"`));
  await snap("trade-sheet-sell");
  const sellLabel = await text("dialog .commit");
  check("sell commit shows total and hours", /^Sell \d+ for \$\d+ · \d+ h$/.test(sellLabel), sellLabel);
  check("sale shows a risk chip", /Risk (slight|some|real|high)/.test(await text("dialog .chips-line")));
  check("sale shows its profit", /(Profit|Loss) \$\d+/.test(await text("dialog .chips-line")), await text("dialog .chips-line"));
  await tap("dialog .commit");
  await sleep(300);
  if (await evaluate(`!!document.querySelector("dialog.card")`)) await tap("dialog.card .choice-card", "Hand it over");
  check("result after selling", /Sold|took the lot/.test(await text(".result") ?? ""), await text(".result"));

  // ---- Me, then reload resumes the same state -------------------------------------------
  await tap(".tabs button", "Me");
  await snap("me");
  const cashBefore = await text(".cash");
  await reload();
  check("reload keeps cash and place", (await text(".cash")) === cashBefore && (await text(".place-name")) === "The Strip", `${cashBefore} / ${await text(".cash")}`);

  // ---- Second tab watches ---------------------------------------------------------------
  const tab2 = await newPage();
  await go(URL0, tab2.s);
  const banner = await evaluate(`document.querySelector(".banner")?.textContent ?? ""`, tab2.s);
  check("second tab only watches", banner.includes("another tab"), banner);
  check("second tab's controls are disabled", await evaluate(`[...document.querySelectorAll("main button.good")].every(b => b.matches(":disabled"))`, tab2.s));
  await send("Target.closeTarget", { targetId: tab2.targetId });

  // ---- Paper -------------------------------------------------------------------------
  await tap(".tabs button", "Street");
  await tap("button.action", "Call it a day");
  await tap("dialog .commit");
  await sleep(300);
  await snap("paper");
  check("paper shows a headline", (await text(".headline"))?.length > 3, await text(".headline"));
  check("focus on the headline", await evaluate(`document.activeElement?.classList.contains("headline")`));
  await tap(".paper .commit", "Start day 2");
  check("day 2 starts", /Day 2/.test(await text(".daybar")), await text(".daybar"));
  check("focus on the place after the paper", await evaluate(`document.activeElement?.classList.contains("place-name")`), await focused());
  await snap("street-day2");

  // ---- A pending stop survives reload and blocks Escape ---------------------------------
  const start = testing.play(sim.newGame(1, "stopcheck"), { type: "buy", good: "smokes", units: 5 }).state;
  const r = sim.step({ ...start, rng: testing.rngWhere(testing.below(0.01)) }, { type: "pullJob" });
  const saveText = sim.toSave(r.state);
  await evaluate(`localStorage.setItem("cnc.save", ${JSON.stringify(saveText)}); localStorage.setItem("cnc.save.backup", ${JSON.stringify(saveText)})`);
  await reload();
  await snap("stop-card");
  check("stop card shows after reload", await evaluate(`document.querySelector("dialog.card")?.open === true`));
  await key("Escape", "Escape", 27);
  await key("Escape", "Escape", 27);
  await sleep(200);
  check("stop card survives Escape", await evaluate(`document.querySelector("dialog.card")?.open === true`));
  await tap("dialog.card .choice-card", "Hand it over");
  check("stop resolved", await evaluate(`!document.querySelector("dialog.card")`), await text(".result"));

  // ---- An arrest: the cells, then the paper -----------------------------------------------
  const caught = sim.step({ ...start, rng: testing.rngWhere(testing.below(0.01), testing.atLeast(0.9)) }, { type: "pullJob" });
  const nicked = sim.step(caught.state, { type: "resolveStop", choice: "legIt" });
  const nickedText = sim.toSave(nicked.state);
  await evaluate(`localStorage.setItem("cnc.save", ${JSON.stringify(nickedText)}); localStorage.setItem("cnc.save.backup", ${JSON.stringify(nickedText)})`);
  await reload();
  await sleep(600);
  await snap("cells");
  check("an arrest shows the cells first", (await text(".cells .headline")) === "Nicked!", await text(".cells .headline"));
  check("the cells name the fine", /Fine \$\d+/.test(await text(".cells-chips") ?? ""), await text(".cells-chips"));
  check("focus on the cells headline", await evaluate(`document.activeElement?.closest(".cells") !== null`), await focused());
  await tap(".cells .commit", "Spend the night");
  check("then the paper", /Fined \$\d+/.test(await text(".paper .story") ?? ""), await text(".paper .story"));

  // ---- The phone: ring round from City ------------------------------------------------------
  const phoned = sim.toSave({ ...sim.newGame(2, "phonecheck"), upgrades: ["phone"] });
  await evaluate(`localStorage.setItem("cnc.save", ${JSON.stringify(phoned)}); localStorage.setItem("cnc.save.backup", ${JSON.stringify(phoned)})`);
  await reload();
  await tap(".tabs button", "City");
  await tap(".ring .action", "Ring round");
  await snap("city-rang");
  check("ringing round gives a result line", /^Rang round/.test(await text(".ring .result") ?? ""), await text(".ring .result"));
  check("ringing round notes every price", await evaluate(`[...document.querySelectorAll(".price-unknown")].length === 0`));
  check("the next call costs more heat", /Heat \+10/.test(await text(".ring .action-chips") ?? ""), await text(".ring .action-chips"));
  await tap(".tabs button", "Street");

  // ---- Export -------------------------------------------------------------------------
  await tap(".tabs button", "Me");
  await tap(".save-line button", "Save and run");
  await snap("save-sheet");
  await tap("dialog .choice", "Export save");
  await sleep(1500);
  const files = readdirSync(DL).filter((f) => f.endsWith(".json"));
  check("export downloads a save file", files.length === 1, files.join(","));
  await key("Escape", "Escape", 27);

  // ---- Corrupt save is recovered visibly --------------------------------------------------
  await evaluate(`localStorage.setItem("cnc.save", "{broken")`);
  await reload();
  check("corrupt save recovered with a notice", (await evaluate(`document.querySelector(".banner")?.textContent ?? ""`)).includes("backup"));
  await snap("recovered");

  // ---- Future save is refused and kept ------------------------------------------------
  const future = JSON.stringify({ format: sim.SAVE_FORMAT, version: 99, state: {} });
  await evaluate(`localStorage.setItem("cnc.save", ${JSON.stringify(future)})`);
  await reload();
  await snap("future");
  check("future save shows the newer-save screen", (await text(".headline")) === "A newer save");
  check("future save untouched", (await evaluate(`localStorage.getItem("cnc.save")`)) === future);

  // ---- Desktop width ----------------------------------------------------------------------
  await evaluate(`localStorage.clear()`);
  await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await reload();
  await snap("desktop");
  // ---- Text zoom 200% on a phone -----------------------------------------------------------
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate(`document.documentElement.style.fontSize = "200%"`);
  await sleep(300);
  check("200% text: no horizontal scroll", await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), await evaluate(`document.documentElement.scrollWidth + "px"`));
  await snap("zoom-200");
} catch (e) {
  log.push(`ERROR ${e.stack}`);
} finally {
  log.push(problems.length ? `Console/CSP problems:\n  ${problems.join("\n  ")}` : "No console errors or CSP violations.");
  log.push(`Screenshots: ${OUT}`);
  console.log(log.join("\n"));
  ws.close();
  edge.kill();
  const failed = problems.length > 0 || log.some((line) => /^(FAIL|ERROR)/.test(line));
  process.exit(failed ? 1 : 0);
}
