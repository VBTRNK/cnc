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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) ?? mkdtempSync(join(tmpdir(), "cnc-browser-check-"));
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
const shiftTab = async () => {
  await s("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
  await s("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
  await sleep(150);
};
/** Where the focused element sits: clear of what sticks at the top (the strip's foot) and of the
 *  fixed tabs, and inside a sideways scroller, clear of its fixed goods column and its fade. */
const FADE_SHOWN = `((f) => !!f && f.getClientRects().length > 0 && getComputedStyle(f).visibility !== "hidden")(document.querySelector(".table-fade"))`;
const FOCUS_SPOT = `(() => {
  const e = document.activeElement, r = e.getBoundingClientRect();
  const name = e.tagName + " " + ((e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 28));
  const top = Math.max(0, document.querySelector(".strip").getBoundingClientRect().bottom);
  const tabs = document.querySelector(".tabs"), bottom = getComputedStyle(tabs).position === "fixed" ? tabs.getBoundingClientRect().top : innerHeight;
  const bad = [];
  // A stop taller than the space (the sideways table) only needs to be partly in view.
  const tall = r.height > bottom - top;
  if (tall ? r.bottom < top + 1 || r.top > bottom - 1 : r.top < top - 1 || r.bottom > bottom + 1) bad.push("y " + Math.round(r.top) + "-" + Math.round(r.bottom) + " outside " + Math.round(top) + "-" + Math.round(bottom));
  const sc = e.closest(".table-scroll");
  if (sc && sc !== e && sc.scrollWidth > sc.clientWidth) {
    // The goods column and the fade count only where they are pinned and shown.
    const stick = sc.querySelector("tbody .stick"), left = getComputedStyle(stick).position === "sticky" ? stick.getBoundingClientRect().right : sc.getBoundingClientRect().left;
    const fade = document.querySelector(".table-fade"), right = ${FADE_SHOWN} ? fade.getBoundingClientRect().left : sc.getBoundingClientRect().right;
    if (r.left < left - 1 || r.right > right + 1) bad.push("x " + Math.round(r.left) + "-" + Math.round(r.right) + " outside " + Math.round(left) + "-" + Math.round(right));
  }
  return { name, inMain: !!e.closest("main"), bad: bad.join(", ") };
})()`;
/** Tabs from the current tab button to `selector` and Shift+Tabs back, collecting focus stops in
 *  the screen that aren't fully in view. */
const focusWalk = async (selector) => {
  await evaluate(`document.querySelector('.tabs [aria-current="page"]').focus()`);
  const hidden = [];
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await key("Tab", "Tab", 9);
    const f = await evaluate(FOCUS_SPOT);
    if (f.inMain && f.bad) hidden.push(`${f.name}: ${f.bad}`);
    reached = await evaluate(`document.activeElement.matches(${JSON.stringify(selector)})`);
  }
  for (let i = 0; i < 40; i++) {
    await shiftTab();
    const f = await evaluate(FOCUS_SPOT);
    if (!f.inMain) break;
    if (f.bad) hidden.push(`back, ${f.name}: ${f.bad}`);
  }
  return { reached, hidden: [...new Set(hidden)] };
};
const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const focused = () => evaluate(`(document.activeElement?.textContent || document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName || "").trim().slice(0, 60)`);
const check = (name, ok, detail = "") => log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
/** The text lines each matching element wraps onto, as "name: n"; the good-names rule allows two. */
const lineCounts = (selector) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => {
  const r = document.createRange(); r.selectNodeContents(e);
  return e.textContent.trim() + ": " + new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
})`);
const overTwoLines = (counts) => counts.filter((c) => Number(c.split(": ").pop()) > 2);

try {
  // ---- First load, Street on a phone ------------------------------------------------
  await go();
  await evaluate(`localStorage.clear()`);
  await reload();
  await snap("street-day1");
  check("Street renders the Docks", (await text(".place-name")) === "The Docks", await text(".place-name"));
  check("fonts loaded from this origin", await evaluate(`document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family).join(","))`).then((f) => { log.push(`  fonts: ${f}`); return /Anton/.test(f) && /Newsreader/.test(f) && /Courier Prime/.test(f); }));
  check("no horizontal scroll at 390px", await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  check("manifest linked", (await evaluate(`fetch("/manifest.webmanifest").then(r => r.json()).then(m => m.icons.length)`)) === 4);

  // ---- Buy by touch -------------------------------------------------------------------
  await tap("button.good", "Untaxed Smokes");
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
  await tap("button.go", "the Strip");
  check("travel lands on Street at the Strip", (await text(".place-name")) === "The Strip", await text(".place-name"));
  check("focus on the place after travel", await evaluate(`document.activeElement?.classList.contains("place-name")`), await focused());
  await tap("button.good", "Untaxed Smokes");
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
  await evaluate(`[...document.querySelectorAll(".tabs button")].find(b => b.textContent === "People").click()`, tab2.s);
  await sleep(200);
  check("a watching tab can still open Pinch's file", await evaluate(`!!document.querySelector(".board") && !document.querySelector(".board").closest(":disabled")`, tab2.s));
  await send("Target.closeTarget", { targetId: tab2.targetId });

  // ---- Paper -------------------------------------------------------------------------
  await tap(".tabs button", "Street");
  await tap("button.row-button", "Call it a day");
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

  // ---- The phone: call around from City ------------------------------------------------------
  const phoned = sim.toSave({ ...sim.newGame(2, "phonecheck"), upgrades: ["phone"] });
  await evaluate(`localStorage.setItem("cnc.save", ${JSON.stringify(phoned)}); localStorage.setItem("cnc.save.backup", ${JSON.stringify(phoned)})`);
  await reload();
  await tap(".tabs button", "City");
  check("prices not yet seen show as unknown", (await evaluate(`document.querySelectorAll(".price-table .unknown").length`)) > 0);
  await tap(".call .move", "Call around");
  await snap("city-called");
  check("calling around gives a result line in the strip", /^Called around/.test(await text(".strip .result") ?? ""), await text(".strip .result"));
  check("calling around notes every price", await evaluate(`document.querySelectorAll(".price-table .unknown").length === 0`));
  check("the next call costs more heat", /Heat \+10/.test(await text(".call .move-hours") ?? ""), await text(".call .move-hours"));
  check("every place's column says when it was seen", (await evaluate(`[...document.querySelectorAll(".seen-row td")].map(td => td.textContent).join("|")`)) === "now|now|now|now");
  await tap(".tabs button", "Street");

  // ---- A saved encounter card, Pinch himself at a stop, his board on People ----------------
  const store = (state) => {
    const text = JSON.stringify(sim.toSave(state));
    return evaluate(`localStorage.setItem("cnc.save", ${text}); localStorage.setItem("cnc.save.backup", ${text})`);
  };
  await store({ ...sim.newGame(3, "cardcheck"), cash: 400, pending: { kind: "card", card: "mugger", odds: 50 } });
  await reload();
  await snap("encounter-card");
  check("an encounter card shows after reload", /mugger/.test(await text("dialog.card .dossier-who") ?? ""), await text("dialog.card .dossier-who"));
  check("its chance shows its odds", /even odds/.test(await text("dialog.card .choices") ?? ""), await text("dialog.card .choices"));
  await tap("dialog.card .choice-card", "Run");
  check("the card's choice leaves a line", /You run/.test(await text(".result") ?? ""), await text(".result"));

  const op0 = sim.newGame(4, "pinchcheck");
  const op = { ...op0, day: 7, held: { ...op0.held, smokes: 5 }, paid: { ...op0.paid, smokes: 30 } };
  op.detective = { ...op.detective, case: { n: 1, place: "docks", habit: "oddJob", announced: 5, places: ["docks"], caught: false } };
  op.milestones = { firsts: { sale: 1, coat: 4, case: 5 }, best: { day: 3, takings: 640 }, cases: [], older: { closed: 0, cold: 0 } };
  const pinched = sim.step({ ...op, rng: testing.rngWhere(testing.below(0.001)) }, { type: "sell", good: "smokes", units: 1 });
  await store(pinched.state);
  await reload();
  await snap("pinch-stop");
  check("inside his operation the stop is Pinch", /Percy Pinch/.test(await text("dialog.card .dossier-who") ?? ""), await text("dialog.card .dossier-who"));
  check("and he can't be bought", await evaluate(`[...document.querySelectorAll("dialog.card .choice-card")].find(b => b.textContent.includes("Slip him"))?.disabled === true`));
  await tap("dialog.card .choice-card", "Hand it over");
  await tap(".tabs button", "People");
  await snap("people");
  check("People shows his open case", /Operation Kipper: The Docks Odd-Job Syndicate/.test(await text(".board") ?? ""), await text(".board"));
  check("the closed file shows the letters and the newest exhibit", (await text(".letters")) === "ExhibitsABCD" && /^Exhibit D · newest/.test(await text(".board .paper-note") ?? ""), `${await text(".letters")} / ${await text(".board .paper-note")}`);
  check("and how many exhibits the file holds", /Open the file4 exhibits/.test(await text(".board .toggle") ?? ""), await text(".board .toggle"));
  await tap(".board .toggle", "Open the file");
  check("opened, the exhibits run newest first", (await evaluate(`[...document.querySelectorAll(".exhibit-mark")].map(e => e.textContent).join("")`)) === "DCBA");
  check("the letters hide while it is open", await evaluate(`!document.querySelector(".letters") && document.querySelector(".board .toggle").getAttribute("aria-expanded") === "true"`));
  check("opening moves focus to the first heading it reveals", await evaluate(`document.activeElement?.classList.contains("file-label")`), await focused());
  await snap("people-open");
  await tap(".board .toggle", "Close the file");
  await sleep(200);
  const closed = await evaluate(FOCUS_SPOT);
  check("closing leaves focus on the toggle, in view", (await evaluate(`document.activeElement?.classList.contains("toggle")`)) && !closed.bad, `${closed.name} ${closed.bad}`);
  check("and the cast", (await evaluate(`document.querySelectorAll(".cast-member").length`)) === 3);
  check("People: no horizontal scroll", await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  await tap(".tabs button", "Street");

  // ---- Export -------------------------------------------------------------------------
  await tap(".tabs button", "Me");
  await tap(".save-button", "Cloud, export, new run");
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

  // ---- Acceptance: every screen and sheet against M4 on a phone ------------------------------
  // Controls at least 48 px high (44 wide), no text under 14 px, text contrast 4.5:1 (3:1 when
  // large), and reflow at 320 px without sideways scrolling (against the client width: a phone
// viewport in emulation widens to fit content that overflows it). Inside an open modal only the
  // dialog counts; disabled controls are exempt from contrast, as in WCAG.
  const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
  const AUDIT = `(() => {
    const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const name = (e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().replace(/\\s+/g, " ").slice(0, 30);
    const modal = [...document.querySelectorAll("dialog")].find((d) => d.open && d.matches(":modal"));
    const root = modal ?? document.body;
    const rgba = (c) => { const n = c.match(/[\\d.]+/g).map(Number); return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }; };
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const background = (e) => {
      const layers = [];
      for (let el = e; el; el = el.parentElement) {
        const c = rgba(getComputedStyle(el).backgroundColor);
        if (c.a > 0) layers.push(c);
        if (c.a >= 1) break;
      }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (const c of layers.reverse()) bg = over(c, bg);
      return bg;
    };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const small = [], tiny = new Set(), faint = new Set();
    let controls = 0, runs = 0;
    for (const e of root.querySelectorAll("button, a[href], input, select, textarea, summary")) {
      // A visually hidden file input is worked by the button that labels it.
      if (!visible(e) || e.closest(".visually-hidden")) continue;
      controls++;
      const r = e.getBoundingClientRect();
      if (r.height < 47.5 || r.width < 44) small.push(name(e) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    }
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const e = n.parentElement;
      if (!n.textContent.trim() || !e || !visible(e) || e.closest(".visually-hidden")) continue;
      runs++;
      const cs = getComputedStyle(e);
      const size = parseFloat(cs.fontSize);
      if (size < 13.9) tiny.add(name(e) + " " + size + "px");
      if (e.closest(":disabled, [aria-disabled='true']")) continue;
      const fg = over(rgba(cs.color), background(e));
      const need = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
      const got = ratio(fg, background(e));
      if (got < need) faint.add(name(e) + " " + got.toFixed(2) + ":1");
    }
    return { controls, runs, small, tiny: [...tiny], faint: [...faint] };
  })()`;
  const audit = async (screen) => {
    await sleep(250);
    const a = await evaluate(AUDIT);
    log.push(`  ${screen}: ${a.controls} controls, ${a.runs} runs of text measured`);
    check(`${screen}: something to measure`, a.controls > 0 && a.runs > 0);
    check(`${screen}: controls 48 px`, a.small.length === 0, a.small.join("; "));
    check(`${screen}: no text under 14 px`, a.tiny.length === 0, a.tiny.join("; "));
    check(`${screen}: text contrast`, a.faint.length === 0, a.faint.join("; "));
    await s("Emulation.setDeviceMetricsOverride", { ...PHONE, width: 320, height: 640 });
    await sleep(250);
    check(`${screen}: reflows at 320 px`, await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), await evaluate(`document.documentElement.scrollWidth + "px"`));
    await s("Emulation.setDeviceMetricsOverride", PHONE);
    await sleep(150);
  };

  await store({ ...sim.newGame(5, "audit"), day: 2 });
  await reload();
  await audit("Street");
  await tap("button.good", "Untaxed Smokes");
  await audit("trade sheet");
  await key("Escape", "Escape", 27);
  await tap(".tabs button", "City");
  await audit("City");
  await store({ ...op, cash: 3000 });
  await reload();
  await tap(".tabs button", "Me");
  await audit("Me");
  await tap(".ad .buy", "$2,500");
  await snap("crown-sheet");
  check("the Crown sheet shows Old Reg", /Old Reg/.test(await text("dialog.card .dossier-who") ?? ""), await text("dialog.card .dossier-who"));
  await audit("Crown sheet");
  await key("Escape", "Escape", 27);
  await tap(".save-button", "Cloud, export, new run");
  await audit("save sheet");
  await key("Escape", "Escape", 27);
  await tap(".tabs button", "People");
  check("every portrait is a same-origin image", await evaluate(`(() => { const i = [...document.querySelectorAll(".portrait img")]; return i.length === 4 && i.every(p => p.complete && p.naturalWidth > 0 && new URL(p.src).origin === location.origin); })()`));
  await audit("People");
  await store({ ...sim.newGame(3, "cardaudit"), cash: 400, pending: { kind: "card", card: "mugger", odds: 50 } });
  await reload();
  await audit("encounter card");
  await store(pinched.state);
  await reload();
  await audit("Pinch's stop");
  await store(testing.play(sim.newGame(6, "paperaudit"), { type: "callItADay" }).state);
  await reload();
  await audit("paper");
  await evaluate(`localStorage.setItem("cnc.save", ${JSON.stringify(nickedText)}); localStorage.setItem("cnc.save.backup", ${JSON.stringify(nickedText)})`);
  await reload();
  await audit("cells");

  // ---- Reduced motion, and no result that dismisses itself ----------------------------------
  // Day 1 at the Docks: 8 tapes for $120, then 3 watches with what is left.
  await store(sim.newGame(7, "motion"));
  await reload();
  const sheetMotion = `getComputedStyle(document.querySelector("dialog.sheet")).animationName`;
  await tap("button.good", "Bootleg Tapes");
  check("a sheet rises by default", (await evaluate(sheetMotion)) !== "none", await evaluate(sheetMotion));
  await tap("dialog .commit");
  await sleep(6000);
  check("the result line is still there after 6 s", /^Bought/.test(await text(".result") ?? ""), await text(".result"));
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await tap("button.good", "Swiss-ish Watches");
  check("reduced motion: the sheet doesn't move", (await evaluate(sheetMotion)) === "none", await evaluate(sheetMotion));
  await tap("dialog .commit");
  await evaluate(`localStorage.setItem("cnc.save", ${JSON.stringify(nickedText)}); localStorage.setItem("cnc.save.backup", ${JSON.stringify(nickedText)})`);
  await reload();
  check("reduced motion: the bars don't drop", await evaluate(`[...document.querySelectorAll(".cells *")].every(e => getComputedStyle(e).animationName === "none")`));
  await s("Emulation.setEmulatedMedia", { features: [] });

  // ---- T7: no rerolls, an old save, a write that fails ------------------------------------------
  await store({ ...sim.newGame(8, "reroll"), day: 2 });
  await reload();
  const prices = `[...document.querySelectorAll("button.good")].map(b => b.textContent).join("|")`;
  const before = await evaluate(prices);
  await reload();
  check("reload rerolls no price", (await evaluate(prices)) === before, before);

  // A version 2 save (before the detective; four goods) holding 10 smokes; then tapes, then watches.
  const v2state = structuredClone(testing.play(sim.newGame(9, "v2"), { type: "buy", good: "smokes", units: 10 }).state);
  const first = ["smokes", "tapes", "watches", "fireworks"];
  const onlyFirst = (rec) => { for (const g of sim.GOODS) if (!first.includes(g)) delete rec[g]; };
  [v2state.held, v2state.paid].forEach(onlyFirst);
  for (const p of sim.PLACES) [v2state.drift[p], v2state.market[p], v2state.memory[p]].forEach(onlyFirst);
  for (const k of ["detective", "milestones", "cards", "flags"]) delete v2state[k];
  delete v2state.today.pub;
  delete v2state.today.best;
  const v2 = JSON.stringify({ format: sim.SAVE_FORMAT, version: 2, state: v2state });
  await evaluate(`localStorage.clear(); localStorage.setItem("cnc.save", ${JSON.stringify(v2)})`);
  await reload();
  const smokesHeld = `[...document.querySelectorAll("button.good")].find(b => b.textContent.includes("Untaxed Smokes"))?.querySelector(".held")?.textContent ?? ""`;
  check("an old save opens where it was", (await evaluate(smokesHeld)) === "1010 held", await evaluate(smokesHeld));
  check("and its original is kept", (await evaluate(`localStorage.getItem("cnc.save.kept")`)) === v2);
  check("and it is saved as the current version", (await evaluate(`JSON.parse(localStorage.getItem("cnc.save")).version`)) === sim.SAVE_VERSION);

  // A save from before ADR-012 (format 3, four goods), its Old Town fireworks drift 1.8 (outside
  // today's clamp), in both slots.
  const legacy = JSON.stringify(JSON.parse(readFileSync(join(REPO, "src/sim/fixtures/before-adr-012.json"), "utf8")).high);
  await evaluate(`localStorage.clear(); localStorage.setItem("cnc.save", ${JSON.stringify(legacy)}); localStorage.setItem("cnc.save.backup", ${JSON.stringify(legacy)})`);
  await reload();
  check("a save with the old drift range opens on its day", /Day 2/.test(await text(".daybar")) && !(await evaluate(`document.querySelector(".banner")?.textContent ?? ""`)).includes("couldn't be read"), await text(".daybar"));
  check("and lists the Docks' ten goods", (await evaluate(`document.querySelectorAll("button.good").length`)) === 10);
  await evaluate(`localStorage.clear(); localStorage.setItem("cnc.save", ${JSON.stringify(v2)})`);
  await reload();

  await evaluate(`window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException("full", "QuotaExceededError"); }`);
  await tap("button.good", "Bootleg Tapes");
  await tap("dialog .commit");
  await snap("write-failed");
  check("a failed write is shown", /out of room/.test(await text(".banner-warn") ?? ""), await text(".banner-warn"));
  check("with export beside it", await evaluate(`!!document.querySelector(".banner-warn button")`));
  check("and play goes on", /^Bought/.test(await text(".result") ?? ""), await text(".result"));
  await evaluate(`Storage.prototype.setItem = window.__setItem`);
  await tap("button.good", "Swiss-ish Watches");
  await tap("dialog .commit");
  check("the next write clears it", await evaluate(`!document.querySelector(".banner-warn")`));
  check("and stores the run in play", (await evaluate(`JSON.parse(localStorage.getItem("cnc.save")).state.cash`)) === Number((await text(".cash")).replace(/[^\d]/g, "")), await text(".cash"));

  // ---- Layout: a long goods list and a thick file at two text sizes (#29) ---------------------
  // Day 9 at 15:00 at the Docks with the coat and phone: eight exhibits, two old cases and an open
  // one on the Strip, a sweep in Old Town, prices seen at different times. Twelve goods: the Docks
  // deals in ten; 4 bubblegum held that it doesn't deal in, and 5 e-bikes it buys but has none of.
  const L0 = sim.newGame(10, "layout");
  const G = sim.GOODS;
  const day9 = { ...L0, day: 9, hour: 15, cash: 1420, heat: 30, upgrades: ["coat", "phone"], xp: { patter: 30, nerve: 10, savvy: 25 } };
  // Pricey phones with a single unit left, so stock and price compete for the note.
  Object.assign(day9.market.docks.phones, { baseline: Math.ceil(sim.usualPrice("phones") * 1.25), freshStock: 2, stock: 1 });
  day9.held = { ...L0.held, smokes: 3, ebikes: 5, gum: 4 };
  day9.paid = { ...L0.paid, smokes: 3 * sim.price(L0, "docks", "smokes"), ebikes: 5 * 400, gum: 4 * 10 };
  // No stop on the sale below: the next draw is high.
  day9.rng = testing.rngWhere(testing.atLeast(0.5));
  const seenAt = (place, day, hour, keep = () => true) =>
    Object.fromEntries(G.filter((g) => sim.deals(place, g) && keep(g)).map((g) => [g, { price: sim.price(L0, place, g), day, hour }]));
  day9.memory = {
    ...L0.memory,
    oldtown: { ...seenAt("oldtown", 9, 13), [G[2]]: { price: sim.price(L0, "oldtown", G[2]), day: 7, hour: 12 }, [G[3]]: { price: sim.price(L0, "oldtown", G[3]), day: 9, hour: 11 } },
    uptown: seenAt("uptown", 8, 18, (g) => G.indexOf(g) % 3 !== 2),
    strip: {},
  };
  day9.events = [
    { id: "layout-sweep", slot: "midday", startDay: 8, startHour: 16, endDay: 9, activated: true, kind: "sweep", place: "oldtown" },
    { id: "layout-short", slot: "morning", startDay: 9, startHour: 10, endDay: 10, activated: true, kind: "shortage", place: "docks", good: G[1] },
    { id: "layout-glut", slot: "morning", startDay: 9, startHour: 10, endDay: 10, activated: true, kind: "glut", place: "uptown", good: G[3] },
  ];
  day9.detective = { ...L0.detective, case: { n: 3, place: "strip", habit: "fireworks", announced: 7, places: ["strip"], caught: false }, next: 12 };
  day9.milestones = {
    firsts: { sale: 1, grand: 4, coat: 5, case: 5, escape: 6, job: 8, phone: 9 },
    best: { day: 7, takings: 900 },
    cases: [{ n: 1, place: "docks", habit: "smokes", outcome: "closed", day: 6 }, { n: 2, place: "uptown", habit: "watches", outcome: "cold", day: 7 }],
    older: { closed: 0, cold: 0 },
  };
  await s("Emulation.setDeviceMetricsOverride", PHONE);
  await store(day9);
  await reload();
  check("layout: the day 9 run loads", (await text(".cash")) === "$1,420" && /Day 9/.test(await text(".daybar") ?? ""), `${await text(".cash")} ${await text(".daybar")}`);
  const streetNames = `[...document.querySelectorAll(".good-name")].map(e => e.textContent)`;
  check("layout: Street lists the ten goods the Docks deals in by name, then the held one it doesn't",
    await evaluate(`(() => { const n = ${streetNames}; const ten = n.slice(0, 10); return n.length === 11 && ten.every((x, i) => i === 0 || ten[i - 1].localeCompare(x, "en") <= 0) && n[10] === "Banned Bubblegum"; })()`),
    await evaluate(`${streetNames}.join("|")`));
  check("layout: the held undealt row says no buyers, with no price",
    await evaluate(`(() => { const b = [...document.querySelectorAll("button.good")].at(-1); return b.querySelector(".good-hint").textContent === "no buyers" && b.querySelector(".good-price").textContent === ""; })()`));
  check("layout: a dealt good with no stock is sold out",
    await evaluate(`[...document.querySelectorAll("button.good")].find(b => b.textContent.includes("Pre-Loved E-Bikes"))?.querySelector(".good-hint")?.textContent === "sold out"`));
  await tap("button.good", "Banned Bubblegum");
  check("layout: its sheet has its tagline, what is held and no buyers, and no trade controls",
    await evaluate(`(() => { const d = document.querySelector("dialog"); return /Illegal in three countries/.test(d.querySelector(".tagline")?.textContent ?? "") && d.textContent.includes("4 held · they cost $40") && d.textContent.includes("No buyers here.") && !d.querySelector(".commit, .switch, .sheet-price"); })()`),
    await text("dialog"));
  await snap("layout-390-undealt-sheet");
  await key("Escape", "Escape", 27);
  await sleep(200);
  await tap("button.good", "Pre-Loved E-Bikes");
  check("layout: a buyer-only good offers its sale with no stock", /^Sell \d+ for \$[\d,]+ · \d+ h$/.test(await text("dialog .commit") ?? ""), await text("dialog .commit"));
  await tap("dialog .commit");
  const ebikesHeld = `[...document.querySelectorAll("button.good")].find(b => b.textContent.includes("Pre-Loved E-Bikes"))?.querySelector(".held span")?.textContent ?? "0"`;
  check("layout: and the sale goes through", /^Sold \d+ e-bikes for/.test(await text(".strip .result") ?? "") && Number(await evaluate(ebikesHeld)) < 5,
    `${await text(".strip .result")} / held ${await evaluate(ebikesHeld)}`);
  // Back to the day 9 state for the layout checks.
  await store(day9);
  await reload();
  check("layout: a held count is named for screen readers", await evaluate(`[...document.querySelectorAll("button.good .held")].filter(e => e.textContent).every(e => e.textContent === e.firstChild.textContent + e.firstChild.textContent + " held" && e.firstChild.getAttribute("aria-hidden") === "true")`));
  // A result to show in the strip: buy what the list starts with.
  await tap("button.good");
  await tap("dialog .commit");
  check("layout: the result shows in the strip", /^Bought/.test(await text(".strip .result") ?? ""), await text(".strip .result"));
  await evaluate(`window.scrollTo(0, 0)`);
  await sleep(200);
  const arrival = (sel) => evaluate(`(() => { const tabs = document.querySelector(".tabs").getBoundingClientRect().top;
    return [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getBoundingClientRect().bottom <= tabs).length; })()`);
  log.push(`  layout 390: Street shows ${await arrival("button.good")} goods on arrival`);
  check("layout 390: Street names fit two lines", overTwoLines(await lineCounts(".good-name")).length === 0, overTwoLines(await lineCounts(".good-name")).join("; "));
  await snap("layout-390-street");
  await evaluate(`window.scrollTo(0, 400)`);
  await sleep(200);
  check("layout 390: the rail and its result strip stay in view", await evaluate(`Math.abs(document.querySelector(".top").getBoundingClientRect().top) < 1 && document.querySelector(".strip").getBoundingClientRect().bottom > 0`));
  const streetNotes = await evaluate(`Object.fromEntries([...document.querySelectorAll("button.good")].map(row =>
    [row.querySelector(".good-name").textContent, row.querySelector(".good-hint").textContent]))`);
  check("market notes: few left wins over pricey", sim.priceHint(day9, "docks", "phones") === "pricey" && streetNotes["Hot Phones"] === "few left", streetNotes["Hot Phones"]);
  await tap(".tabs button", "City");
  const cityNotes = await evaluate(`Object.fromEntries([...document.querySelectorAll(".price-table tbody tr:not(.repeat-row)")].map(row =>
    [row.querySelector("th").textContent, row.querySelector(".here-col .cell-hint")?.textContent ?? ""]))`);
  const mismatchedNotes = Object.keys(streetNotes).filter(name => streetNotes[name] !== cityNotes[name]);
  check("market notes: Street and City's current column agree for every Street row", mismatchedNotes.length === 0, mismatchedNotes.join(", "));
  check("layout 390: City's goods names fit two lines", overTwoLines(await lineCounts(".price-table tbody th")).length === 0, overTwoLines(await lineCounts(".price-table tbody th")).join("; "));
  check("layout 390: the table fits without scrolling sideways", await evaluate(`(() => { const t = document.querySelector(".table-scroll"); return t.scrollWidth <= t.clientWidth; })()`));
  check("layout 390: place warnings sit in the column heads", (await evaluate(`[...document.querySelectorAll(".head-note")].map(e => e.textContent).join("|")`)) === "Sweep|Pinch", await evaluate(`[...document.querySelectorAll(".head-note")].map(e => e.textContent).join("|")`));
  check("layout 390: the Seen row", (await evaluate(`[...document.querySelectorAll(".seen-row td")].map(td => td.textContent).join("|")`)) === "now|13:00|day 8|never", await evaluate(`[...document.querySelectorAll(".seen-row td")].map(td => td.textContent).join("|")`));
  check("layout 390: a price older than its column's says when, by day or by hour", await evaluate(`(() => { const h = [...document.querySelectorAll(".cell-hint")].map(e => e.textContent); return h.includes("11:00") && h.includes("day 7"); })()`),
    await evaluate(`[...document.querySelectorAll(".cell-hint")].map(e => e.textContent).join("|")`));
  check("layout 390: no repeated place names where the head sticks", (await evaluate(`document.querySelectorAll(".repeat-row").length`)) === 0);
  check("layout 390: City has twelve rows and a dash for each pair not dealt, named apart from an unseen price",
    await evaluate(`(() => { const u = [...document.querySelectorAll(".price-table td.undealt")]; const q = [...document.querySelectorAll(".price-table td.unknown")];
      return document.querySelectorAll(".price-table tbody tr:not(.repeat-row)").length === 12 && u.length === 8
        && u.every(c => c.textContent === (c.matches(".here-col") && c.parentElement.firstElementChild.textContent === "Banned Bubblegum" ? "—no buyers" : "—not dealt here"))
        && q.length > 0 && q.every(c => c.textContent.startsWith("?not seen")); })()`),
    await evaluate(`[...document.querySelectorAll(".price-table td.undealt, .price-table td.unknown")].map(c => c.textContent).join("|")`));
  const wide = await focusWalk(".call .move");
  check("layout 390: Tab and Shift+Tab through City keep each control in view", wide.reached && wide.hidden.length === 0, wide.hidden.join("; "));
  await evaluate(`(() => { document.activeElement.blur(); window.scrollTo(0, 0); })()`);
  await sleep(200);
  log.push(`  layout 390: City shows ${await arrival(".price-table tbody tr")} price rows on arrival`);
  await snap("layout-390-city");
  // Scroll the head up to 60 px past the rail, as far as the page goes.
  const room = await evaluate(`(() => { const h = document.querySelector(".price-table thead").getBoundingClientRect(), r = document.querySelector(".top").getBoundingClientRect(), b = document.querySelector(".price-table tbody").getBoundingClientRect();
    const max = document.documentElement.scrollHeight - innerHeight, by = Math.min(h.top - r.bottom + 60, max);
    window.scrollTo(0, by); return { ok: h.top - window.scrollY < r.bottom - 10 && b.bottom - window.scrollY > r.bottom + h.height, by, max }; })()`);
  await sleep(200);
  if (room.ok) check("layout 390: the table head sticks under the rail", await evaluate(`Math.abs(document.querySelector(".price-table thead").getBoundingClientRect().top - document.querySelector(".top").getBoundingClientRect().bottom) < 2`),
    await evaluate(`document.querySelector(".price-table thead").getBoundingClientRect().top + " / " + document.querySelector(".top").getBoundingClientRect().bottom`));
  else log.push(`  layout 390: the table is too short to scroll its head under the rail (${JSON.stringify(room)})`);
  await snap("layout-390-city-scrolled");
  // A short screen (390 x 350): the rail scrolls away, and the head sticks under the strip alone.
  await s("Emulation.setDeviceMetricsOverride", { ...PHONE, height: 350 });
  await sleep(300);
  const low = await evaluate(`(() => { const h = document.querySelector(".price-table thead").getBoundingClientRect(), max = document.documentElement.scrollHeight - innerHeight;
    const by = Math.min(window.scrollY + h.top + 40, max); window.scrollTo(0, by); return by > window.scrollY - 1 && max > 0; })()`);
  await sleep(250);
  const under = `(() => { const h = document.querySelector(".price-table thead").getBoundingClientRect(), st = document.querySelector(".strip").getBoundingClientRect(); return { head: Math.round(h.top), strip: Math.round(st.top) + "-" + Math.round(st.bottom), stuck: Math.abs(st.top) < 1 && Math.abs(h.top - st.bottom) < 2 }; })()`;
  if (low) { const u = await evaluate(under); check("layout 390x350: the head sticks under the strip, not behind it", u.stuck, JSON.stringify(u)); }
  else log.push("  layout 390x350: too short to scroll the head");
  await snap("layout-390x350-city");
  await s("Emulation.setDeviceMetricsOverride", PHONE);
  await sleep(250);
  await tap(".tabs button", "People");
  check("layout 390: the closed file counts eight exhibits", /8 exhibits/.test(await text(".board .toggle") ?? ""), await text(".board .toggle"));
  await snap("layout-390-people");
  await tap(".board .toggle", "Open the file");
  check("layout 390: the open file lists them newest first", (await evaluate(`[...document.querySelectorAll(".exhibit-mark")].map(e => e.textContent).join("")`)) === "HGFEDCBA");
  check("layout 390: and his earlier operations", (await evaluate(`document.querySelectorAll(".case").length`)) === 2);
  await snap("layout-390-people-open");
  await tap(".tabs button", "Me");
  const short = `$${(2500 - Number((await text(".cash")).replace(/[^\d]/g, ""))).toLocaleString("en")} short`;
  check("layout 390: the Crown's ad names what is short, with no Buy", (await text(".ad .ad-short")) === short && !(await evaluate(`!!document.querySelector(".ad .buy")`)), `${await text(".ad")} (want ${short})`);
  await snap("layout-390-me");

  // 356 px with text at 150 %: the browser's default text size, so rem media queries follow it
  // as they do for a player's large-text setting. Without that setting, 150 % page zoom.
  await s("Page.setFontSizes", { fontSizes: { standard: 24, fixed: 20 } }).catch(() => {});
  await s("Emulation.setDeviceMetricsOverride", { ...PHONE, width: 356, height: 760 });
  await sleep(300);
  let how = "default text 24 px";
  if (!(await evaluate(`matchMedia("(max-width: 22.24rem)").matches`))) {
    how = "150 % zoom (237 css px)";
    await s("Emulation.setDeviceMetricsOverride", { ...PHONE, width: 237, height: 507, deviceScaleFactor: 3 });
    await sleep(300);
  }
  log.push(`  layout 356/150 %: ${how}`);
  check("layout 356/150 %: the narrow layout applies", await evaluate(`matchMedia("(max-width: 22.24rem)").matches`));
  // Fewer, the number, More and Max each 48 px and inside the sheet; Max under the other three.
  const STEPPER = `(() => {
    const d = document.querySelector("dialog.sheet"), b = d.getBoundingClientRect();
    const parts = [...d.querySelectorAll(".stepper button, .stepper input")].map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= b.left - 0.5 && r.right <= b.right + 0.5 }; });
    const u = d.querySelector(".stepper-units").getBoundingClientRect(), m = d.querySelector(".stepper-max").getBoundingClientRect();
    return { ok: d.scrollWidth <= d.clientWidth && parts.length === 4 && parts.every((p) => p.inside && p.w >= 47.5 && p.h >= 47.5), maxOwnLine: m.top >= u.bottom - 1, parts };
  })()`;
  const narrowAudit = async (screen) => {
    const a = await evaluate(AUDIT);
    check(`layout 356/150 % ${screen}: controls 48 px, text 14 px, contrast`, a.small.length + a.tiny.length + a.faint.length === 0, [...a.small, ...a.tiny, ...a.faint].join("; "));
    check(`layout 356/150 % ${screen}: no sideways page scroll`, await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  };
  await tap(".tabs button", "Street");
  await evaluate(`window.scrollTo(0, 0)`);
  await sleep(200);
  check("layout 356/150 %: Street puts the market before the moves", await evaluate(`!!(document.querySelector(".market").compareDocumentPosition(document.querySelector(".moves")) & Node.DOCUMENT_POSITION_FOLLOWING)`));
  log.push(`  layout 356/150 %: Street shows ${await arrival("button.good")} goods on arrival`);
  check("layout 356/150 %: Street names fit two lines", overTwoLines(await lineCounts(".good-name")).length === 0, overTwoLines(await lineCounts(".good-name")).join("; "));
  await narrowAudit("Street");
  await snap("layout-356x150-street");
  await evaluate(`window.scrollTo(0, 700)`);
  await sleep(200);
  check("layout 356/150 %: the rail scrolls away and the strip sticks", await evaluate(`document.querySelector(".status").getBoundingClientRect().bottom <= 0 && Math.abs(document.querySelector(".strip").getBoundingClientRect().top) < 1`));
  await snap("layout-356x150-street-scrolled");
  await tap("button.good");
  const stepper = await evaluate(STEPPER);
  check("layout 356/150 %: the stepper fits the sheet, Max on its own line", stepper.ok && stepper.maxOwnLine, JSON.stringify(stepper));
  await snap("layout-356x150-trade");
  await key("Escape", "Escape", 27);
  await tap(".tabs button", "City");
  check("layout 356/150 %: City puts the table before Call around", await evaluate(`!!(document.querySelector(".prices").compareDocumentPosition(document.querySelector(".call")) & Node.DOCUMENT_POSITION_FOLLOWING)`));
  check("layout 356/150 %: the table scrolls sideways under a fade, the goods column pinned", await evaluate(`(() => { const t = document.querySelector(".table-scroll"); return t.scrollWidth > t.clientWidth && ${FADE_SHOWN} && getComputedStyle(document.querySelector("tbody .stick")).position === "sticky"; })()`));
  check("layout 356/150 %: City's goods names fit two lines", overTwoLines(await lineCounts(".price-table tbody th")).length === 0, overTwoLines(await lineCounts(".price-table tbody th")).join("; "));
  check("layout 356/150 %: place names come again above the last rows", await evaluate(`(() => { const rows = [...document.querySelectorAll(".price-table tbody tr")], i = rows.findIndex(r => r.classList.contains("repeat-row")); return document.querySelectorAll(".repeat-row").length === 1 && rows.length - 1 - i === Math.min(4, Math.floor((rows.length - 1) / 2)); })()`));
  check("layout 356/150 %: the sideways table is a named keyboard stop", await evaluate(`(() => { const t = document.querySelector(".table-scroll"); return t.tabIndex === 0 && t.getAttribute("role") === "region" && !!t.getAttribute("aria-label"); })()`));
  const narrowWalk = await focusWalk(".call .move");
  check("layout 356/150 %: Tab and Shift+Tab through City keep each control in view", narrowWalk.reached && narrowWalk.hidden.length === 0, narrowWalk.hidden.join("; "));
  await evaluate(`(() => { document.activeElement.blur(); document.querySelector(".table-scroll").scrollLeft = 0; window.scrollTo(0, 0); })()`);
  await sleep(300);
  log.push(`  layout 356/150 %: City shows ${await arrival(".price-table tbody tr")} price rows on arrival`);
  await narrowAudit("City");
  await snap("layout-356x150-city");
  await evaluate(`(() => { const t = document.querySelector(".table-scroll"); t.scrollLeft = t.scrollWidth; })()`);
  await sleep(300);
  check("layout 356/150 %: the fade goes at the table's end", !(await evaluate(FADE_SHOWN)));
  await snap("layout-356x150-city-end");
  await tap(".tabs button", "People");
  await narrowAudit("People");
  await snap("layout-356x150-people");
  await tap(".tabs button", "Me");
  check("layout 356/150 %: Me's Form stacks", await evaluate(`getComputedStyle(document.querySelector(".form")).gridTemplateColumns.split(" ").length === 1`));
  await narrowAudit("Me");
  await snap("layout-356x150-me");

  // 320 px with text at 200 %: the frame, the trade sheet and the file still fit.
  await s("Page.setFontSizes", { fontSizes: { standard: 32, fixed: 26 } }).catch(() => {});
  await s("Emulation.setDeviceMetricsOverride", { ...PHONE, width: 320, height: 640 });
  await sleep(300);
  if (await evaluate(`parseFloat(getComputedStyle(document.documentElement).fontSize) === 32`)) {
    const fits = `(() => { const w = document.documentElement.clientWidth, out = [];
      for (const e of document.querySelectorAll(".status *, .tabs button, main *")) { const r = e.getBoundingClientRect(); if (r.width && (r.left < -0.5 || r.right > w + 0.5)) out.push(e.tagName + "." + (e.getAttribute("class") ?? "") + " " + Math.round(r.left) + "-" + Math.round(r.right) + " " + (e.textContent ?? "").trim().slice(0, 16)); }
      return { page: document.documentElement.scrollWidth <= w, out: [...new Set(out)].slice(0, 6) }; })()`;
    await tap(".tabs button", "Street");
    await evaluate(`window.scrollTo(0, 0)`);
    await sleep(200);
    const street = await evaluate(fits);
    check("layout 320/200 %: the rail and the tabs fit", street.page && street.out.length === 0, JSON.stringify(street));
    await snap("layout-320x200-street");
    await tap("button.good");
    const big = await evaluate(STEPPER);
    check("layout 320/200 %: the stepper fits the sheet, Max on its own line", big.ok && big.maxOwnLine, JSON.stringify(big));
    await snap("layout-320x200-trade");
    await key("Escape", "Escape", 27);
    await tap(".tabs button", "People");
    await evaluate(`window.scrollTo(0, 0)`);
    await sleep(200);
    const people = await evaluate(fits);
    check("layout 320/200 %: Pinch's file fits", people.page && people.out.length === 0, JSON.stringify(people));
    await snap("layout-320x200-people");
    await tap(".board .toggle", "Open the file");
    await sleep(200);
    const opened = await evaluate(fits);
    check("layout 320/200 %: the open file fits, exhibits and past operations", opened.page && opened.out.length === 0 && (await evaluate(`document.querySelectorAll(".exhibit-row").length === 8 && document.querySelectorAll(".case").length === 2`)), JSON.stringify(opened));
    await snap("layout-320x200-people-open");

    // A long result (a bribe, a sale that empties demand, two skills up) isn't pinned over the
    // screen: it is read in full and scrolls away. Day 9 at 12:00, eight watches held at the Docks.
    const b0 = sim.newGame(11, "bribe");
    const bribing = { ...b0, day: 9, hour: 12, cash: 4500, heat: 40, upgrades: ["coat", "phone"], xp: { ...b0.xp, patter: 9, nerve: 8 } };
    bribing.held = { ...b0.held, watches: 8 };
    bribing.paid = { ...b0.paid, watches: 120 };
    bribing.market = { ...b0.market, docks: { ...b0.market.docks, watches: { ...b0.market.docks.watches, demand: 8 } } };
    const stopped = sim.step({ ...bribing, rng: testing.rngWhere(testing.below(0.001), testing.below(0.1)) }, { type: "sell", good: "watches", units: 8 });
    await store(stopped.state);
    await reload();
    await tap("dialog.card .choice-card", "Slip him");
    await sleep(300);
    const STRIP = `(() => { const st = document.querySelector(".strip"), r = st.getBoundingClientRect(), tabs = document.querySelector(".tabs").getBoundingClientRect().top;
      return { top: Math.round(r.top), height: Math.round(r.height), tabs: Math.round(tabs), pinned: getComputedStyle(st).position === "sticky", whole: st.scrollHeight <= st.clientHeight + 1 }; })()`;
    const long = await evaluate(STRIP);
    check("layout 320/200 %: a long result is read in full, not pinned", !long.pinned && long.whole && /patter improves.*nerve hardens/.test(await text(".strip") ?? ""), `${JSON.stringify(long)} ${await text(".strip")}`);
    await evaluate(`window.scrollTo(0, window.scrollY + document.querySelector(".strip").getBoundingClientRect().bottom + 40)`);
    await sleep(250);
    const past = await evaluate(STRIP);
    check("layout 320/200 %: scrolled past it, the screen has the space above the tabs", past.top + past.height <= 0 && (await evaluate(`!!document.querySelector("main button.good") && [...document.querySelectorAll("main button.good")].some(b => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= ${past.tabs}; })`)), JSON.stringify(past));
    await snap("layout-320x200-long-result");
    // An ordinary result still sticks.
    await evaluate(`window.scrollTo(0, 0)`);
    await tap("button.good");
    await tap("dialog .commit");
    await sleep(300);
    await evaluate(`window.scrollTo(0, 900)`);
    await sleep(250);
    const short = await evaluate(STRIP);
    check("layout 320/200 %: an ordinary result still sticks", short.pinned && Math.abs(short.top) < 1 && /^Bought/.test(await text(".strip") ?? ""), `${JSON.stringify(short)} ${await text(".strip")}`);
    await snap("layout-320x200-short-result");
    // City: no room for a whole place column beside the pinned goods column and the fade, so
    // the goods column scrolls too and the fade goes; each Go is shown whole when focused.
    await tap(".tabs button", "City");
    check("layout 320/200 %: City's goods column scrolls and the fade goes", await evaluate(`getComputedStyle(document.querySelector("tbody .stick")).position === "static" && !${FADE_SHOWN} && document.querySelectorAll("button.go").length >= 2`),
      await evaluate(`document.querySelectorAll("button.go").length + " Go"`));
    const bigWalk = await focusWalk(".call .move");
    check("layout 320/200 %: Tab and Shift+Tab through City show each Go whole", bigWalk.reached && bigWalk.hidden.length === 0, bigWalk.hidden.join("; "));
    await evaluate(`[...document.querySelectorAll("button.go")].at(-1).focus()`);
    await sleep(200);
    await snap("layout-320x200-city-go");
  } else log.push("  layout 320/200 %: skipped, this browser ignores Page.setFontSizes");
  await s("Page.setFontSizes", { fontSizes: { standard: 16, fixed: 13 } }).catch(() => {});
  await s("Emulation.setDeviceMetricsOverride", PHONE);
  await sleep(200);

  // Each tip's dismiss button is named for its tip; dismissing one moves focus on, not away.
  await store(day9);
  await reload();
  await tap(".tabs button", "Street");
  const names = await evaluate(`[...document.querySelectorAll(".tip button")].map(b => b.getAttribute("aria-label"))`);
  check("tips: each dismiss button is named for its tip", names.length === 2 && new Set(names).size === 2 && names.every((n) => /^Dismiss Mags's tip: /.test(n)), names.join(" | "));
  await evaluate(`document.querySelector(".tip button").focus()`);
  await key("Enter", "Enter", 13);
  check("tips: focus moves to the next tip's button", await evaluate(`document.activeElement?.matches(".tip button") && document.querySelectorAll(".tip").length === 1`), await focused());
  await key("Enter", "Enter", 13);
  check("tips: after the last, focus moves to the first move", await evaluate(`!document.querySelector(".tip") && document.activeElement?.matches(".moves button")`), await focused());

  // ---- Desktop: the wide layout and a keyboard-only day ---------------------------------------
  await evaluate(`localStorage.clear()`);
  await s("Emulation.setTouchEmulationEnabled", { enabled: false });
  await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await reload();
  await snap("desktop");
  const layout = await evaluate(`(() => { const m = document.querySelector(".screen").getBoundingClientRect(), r = document.querySelector(".rail").getBoundingClientRect(); return { main: Math.round(m.width), beside: r.right <= m.left }; })()`);
  check("desktop: a bounded main column with status beside it", layout.main <= 608 && layout.beside, JSON.stringify(layout));
  const unringed = [];
  /** Tabs forward until the focused element matches, checking each stop shows its focus. */
  const tabTo = async (selector, label = "") => {
    for (let i = 0; i < 60; i++) {
      await key("Tab", "Tab", 9);
      const f = await evaluate(`(() => { const e = document.activeElement, cs = getComputedStyle(e);
        return { hit: e.matches(${JSON.stringify(selector)}) && (e.textContent + (e.getAttribute("aria-label") ?? "")).includes(${JSON.stringify(label)}),
          ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== "none", name: e.tagName + "." + e.className + " " + (e.textContent ?? "").trim().slice(0, 30) }; })()`);
      // Tab past the last control leaves the page (focus on BODY) before it wraps round.
      if (!f.ring && !f.name.startsWith("BODY.")) unringed.push(f.name);
      if (f.hit) return true;
    }
    throw new Error(`Tab never reached ${selector} "${label}"`);
  };
  const enter = async () => { await key("Enter", "Enter", 13); await sleep(250); };
  await tabTo("button.good", "Untaxed Smokes"); await enter();
  await tabTo("dialog .commit"); await enter();
  check("keyboard: buy", /^Bought/.test(await text(".result") ?? ""), await text(".result"));
  await tabTo(".tabs button", "City"); await enter();
  await tabTo("button.go", "the Strip"); await enter();
  check("keyboard: travel", (await text(".place-name")) === "The Strip", await text(".place-name"));
  await tabTo("button.good", "Untaxed Smokes"); await enter();
  await tabTo("dialog .commit"); await enter();
  if (await evaluate(`!!document.querySelector("dialog.card")`)) { await tabTo("dialog.card .choice-card", "Hand it over"); await enter(); }
  check("keyboard: sell", /Sold|took the lot/.test(await text(".result") ?? ""), await text(".result"));
  await tabTo("button.row-button", "Call it a day"); await enter();
  await tabTo("dialog .commit"); await enter();
  await tabTo(".paper .commit", "Start day 2"); await enter();
  check("keyboard: a whole day to the next morning", /Day 2/.test(await text(".daybar")), await text(".daybar"));
  await store({ ...sim.newGame(3, "cardkeys"), cash: 400, pending: { kind: "card", card: "mugger", odds: 50 } });
  await reload();
  check("keyboard: focus starts inside the card", await evaluate(`!!document.activeElement.closest("dialog.card")`), await focused());
  await tabTo("dialog.card .choice-card", "Run"); await enter();
  check("keyboard: a card's choice", /You run/.test(await text(".result") ?? ""), await text(".result"));
  check("keyboard: every focus stop is visible", unringed.length === 0, [...new Set(unringed)].join("; "));
  await snap("desktop-keyboard");
  // ---- Text zoom 200% on a phone -----------------------------------------------------------
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate(`document.documentElement.style.fontSize = "200%"`);
  await sleep(300);
  check("200% text: no horizontal scroll", await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), await evaluate(`document.documentElement.scrollWidth + "px"`));
  await evaluate(`window.scrollTo(0, 900)`);
  await sleep(300);
  check("200% text: the rail scrolls away and the result strip stays", await evaluate(`document.querySelector(".status").getBoundingClientRect().bottom <= 0 && Math.abs(document.querySelector(".strip").getBoundingClientRect().top) < 1`),
    await evaluate(`document.querySelector(".status").getBoundingClientRect().bottom + " / " + document.querySelector(".strip").getBoundingClientRect().top`));
  await evaluate(`window.scrollTo(0, 0)`);
  await snap("zoom-200");
} catch (e) {
  log.push(`ERROR ${e.stack}`);
} finally {
  log.push(problems.length ? `Console/CSP problems:\n  ${problems.join("\n  ")}` : "No console errors or CSP violations.");
  log.push(`Screenshots: ${OUT}`);
  console.log(log.join("\n"));
  // Closing over the protocol ends the whole browser; killing the launcher alone leaves
  // Edge's processes running on Windows, holding the port and the game's save lock.
  await Promise.race([send("Browser.close").catch(() => {}), sleep(2000)]);
  ws.close();
  edge.kill();
  const failed = problems.length > 0 || log.some((line) => /^(FAIL|ERROR)/.test(line));
  process.exit(failed ? 1 : 0);
}
