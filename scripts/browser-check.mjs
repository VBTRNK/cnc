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

  const op = { ...sim.newGame(4, "pinchcheck"), day: 7, held: { smokes: 5, tapes: 0, watches: 0, fireworks: 0 }, paid: { smokes: 30, tapes: 0, watches: 0, fireworks: 0 } };
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
  check("and the exhibits", (await evaluate(`document.querySelectorAll(".exhibit").length`)) === 4);
  check("and the cast", (await evaluate(`document.querySelectorAll(".cast-member").length`)) === 3);
  check("People: no horizontal scroll", await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
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

  // ---- Acceptance: every screen and sheet against M4 on a phone ------------------------------
  // Controls at least 48 px high (44 wide), no text under 14 px, text contrast 4.5:1 (3:1 when
  // large), and reflow at 320 px without sideways scrolling. Inside an open modal only the
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
    check(`${screen}: reflows at 320 px`, await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), await evaluate(`document.documentElement.scrollWidth + "px"`));
    await s("Emulation.setDeviceMetricsOverride", PHONE);
    await sleep(150);
  };

  await store({ ...sim.newGame(5, "audit"), day: 2 });
  await reload();
  await audit("Street");
  await tap("button.good", "Untaxed smokes");
  await audit("trade sheet");
  await key("Escape", "Escape", 27);
  await tap(".tabs button", "City");
  await audit("City");
  await store({ ...op, cash: 3000 });
  await reload();
  await tap(".tabs button", "Me");
  await audit("Me");
  await tap(".upgrade button", "$2,500");
  await snap("crown-sheet");
  check("the Crown sheet shows Old Reg", /Old Reg/.test(await text("dialog.card .dossier-who") ?? ""), await text("dialog.card .dossier-who"));
  await audit("Crown sheet");
  await key("Escape", "Escape", 27);
  await tap(".save-line button", "Save and run");
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
  await tap("button.good", "Bootleg tapes");
  check("a sheet rises by default", (await evaluate(sheetMotion)) !== "none", await evaluate(sheetMotion));
  await tap("dialog .commit");
  await sleep(6000);
  check("the result line is still there after 6 s", /^Bought/.test(await text(".result") ?? ""), await text(".result"));
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await tap("button.good", "Knock-off watches");
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

  // A version 2 save (before the detective) holding 10 smokes; then 8 tapes, then 1 watch.
  const v2state = structuredClone(testing.play(sim.newGame(9, "v2"), { type: "buy", good: "smokes", units: 10 }).state);
  for (const k of ["detective", "milestones", "cards", "flags"]) delete v2state[k];
  delete v2state.today.pub;
  delete v2state.today.best;
  const v2 = JSON.stringify({ format: sim.SAVE_FORMAT, version: 2, state: v2state });
  await evaluate(`localStorage.clear(); localStorage.setItem("cnc.save", ${JSON.stringify(v2)})`);
  await reload();
  check("an old save opens where it was", (await text("button.good .held")) === "10", await text("button.good"));
  check("and its original is kept", (await evaluate(`localStorage.getItem("cnc.save.kept")`)) === v2);
  check("and it is saved as the current version", (await evaluate(`JSON.parse(localStorage.getItem("cnc.save")).version`)) === sim.SAVE_VERSION);

  // A save from before ADR-012, its Old Town fireworks drift 1.8 (outside today's clamp), in both slots.
  const legacy = JSON.stringify(JSON.parse(readFileSync(join(REPO, "src/sim/fixtures/before-adr-012.json"), "utf8")).high);
  await evaluate(`localStorage.clear(); localStorage.setItem("cnc.save", ${JSON.stringify(legacy)}); localStorage.setItem("cnc.save.backup", ${JSON.stringify(legacy)})`);
  await reload();
  check("a save with the old drift range opens on its day", /Day 2/.test(await text(".daybar")) && !(await evaluate(`document.querySelector(".banner")?.textContent ?? ""`)).includes("couldn't be read"), await text(".daybar"));
  await evaluate(`localStorage.clear(); localStorage.setItem("cnc.save", ${JSON.stringify(v2)})`);
  await reload();

  await evaluate(`window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException("full", "QuotaExceededError"); }`);
  await tap("button.good", "Bootleg tapes");
  await tap("dialog .commit");
  await snap("write-failed");
  check("a failed write is shown", /out of room/.test(await text(".banner-warn") ?? ""), await text(".banner-warn"));
  check("with export beside it", await evaluate(`!!document.querySelector(".banner-warn button")`));
  check("and play goes on", /^Bought/.test(await text(".result") ?? ""), await text(".result"));
  await evaluate(`Storage.prototype.setItem = window.__setItem`);
  await tap("button.good", "Knock-off watches");
  await tap("dialog .commit");
  check("the next write clears it", await evaluate(`!document.querySelector(".banner-warn")`));
  check("and stores the run in play", (await evaluate(`JSON.parse(localStorage.getItem("cnc.save")).state.cash`)) === Number((await text(".cash")).replace(/[^\d]/g, "")), await text(".cash"));

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
  await tabTo("button.good", "Untaxed smokes"); await enter();
  await tabTo("dialog .commit"); await enter();
  check("keyboard: buy", /^Bought/.test(await text(".result") ?? ""), await text(".result"));
  await tabTo(".tabs button", "City"); await enter();
  await tabTo("button.go", "The Strip"); await enter();
  check("keyboard: travel", (await text(".place-name")) === "The Strip", await text(".place-name"));
  await tabTo("button.good", "Untaxed smokes"); await enter();
  await tabTo("dialog .commit"); await enter();
  if (await evaluate(`!!document.querySelector("dialog.card")`)) { await tabTo("dialog.card .choice-card", "Hand it over"); await enter(); }
  check("keyboard: sell", /Sold|took the lot/.test(await text(".result") ?? ""), await text(".result"));
  await tabTo("button.action", "Call it a day"); await enter();
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
  check("200% text: no horizontal scroll", await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), await evaluate(`document.documentElement.scrollWidth + "px"`));
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
