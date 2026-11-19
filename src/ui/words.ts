// What the player reads, derived from the state and the last action's domain events.
// Pure functions, so they are tested without a browser.

import {
  CARDS,
  GOODS,
  MILESTONES,
  PINCH,
  RULES,
  UPGRADE_COST,
  cardSale,
  chanceOdds,
  gainOf,
  has,
  heatWord,
  operationStart,
  type CardId,
  type Choice,
  type DomainEvent,
  type Effect,
  type GameState,
  type GoodId,
  type MilestoneId,
  type OpenCase,
  type Paper,
  type PastCase,
  type PerGood,
  type PinchItem,
  type PlaceId,
  type Rumour,
  type WorldEvent,
} from "../sim/index.ts";
import {
  caseLabel,
  clock,
  codename,
  goodCount,
  goodValues,
  hasText,
  money,
  placeValues,
  placesText,
  skillName,
  t,
  upper,
  type TextKey,
  type Values,
} from "./text.ts";

export type OddsWord = "likely" | "good" | "even" | "poor" | "long";

/** Odds in percent as a word: hints over figures. */
export function oddsWord(percent: number): OddsWord {
  if (percent >= 80) return "likely";
  if (percent >= 60) return "good";
  if (percent >= 40) return "even";
  if (percent >= 25) return "poor";
  return "long";
}

export const oddsText = (percent: number): string => t(`odds.${oddsWord(percent)}`);
export const heatText = (heat: number): string => t(`heat.${heatWord(heat)}`);

const at = (place: PlaceId, good?: GoodId) => ({ ...placeValues(place), ...(good ? goodValues(good) : {}) });

/** "12 tapes, 3 watches": the goods in a seizure, in catalogue order. */
export function goodsList(goods: PerGood<number>): string {
  return GOODS.filter((g) => goods[g] > 0)
    .map((g) => goodCount(g, goods[g]))
    .join(", ");
}

export function rumourLine(r: Rumour): string {
  if (!r.claim) return t("result.rumourNone");
  return t(r.claim.kind === "shortage" ? "result.rumourShortage" : "result.rumourGlut", at(r.claim.place, r.claim.good));
}

/** The one-line result of the last action: whole sentences, in the order things happened. */
export function resultLines(events: readonly DomainEvent[], state: GameState): string[] {
  const out: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case "bought":
        out.push(t("result.bought", { count: goodCount(e.good, e.units), cost: money(e.cost) }));
        break;
      case "sold": {
        const values = { count: goodCount(e.good, e.units), proceeds: money(e.proceeds) };
        const profit = e.proceeds - e.cost;
        if (profit > 0) out.push(t("result.soldProfit", { ...values, profit: money(profit) }));
        else if (profit < 0) out.push(t("result.soldLoss", { ...values, loss: money(-profit) }));
        else out.push(t("result.sold", values));
        if (state.phase === "day" && state.market[state.place][e.good].demand === 0) {
          out.push(t("result.soldOut", goodValues(e.good)));
        }
        break;
      }
      case "travelled":
        out.push(t("result.travelled", { ...placeValues(e.to), hours: e.hours }));
        break;
      case "tip":
        // Mags voices what asking around turns up; a card's tip is the card's own.
        if (e.tip.kind === "price") {
          const line = t("result.tipPrice", { ...at(e.tip.place, e.tip.good), price: money(e.tip.price) });
          out.push(events.some((x) => x.type === "cardResolved") ? line : t("result.mags", { line }));
        } else if (e.tip.via === "ask") {
          out.push(t("result.mags", { line: rumourLine(e.tip) }));
        }
        break;
      case "laidLow":
        out.push(t("result.laidLow", { word: heatText(e.heat) }));
        break;
      case "oddJob":
        out.push(t("result.oddJob", { pay: money(e.pay), word: heatText(state.heat) }));
        break;
      case "job":
        if (e.outcome === "success") out.push(t("result.job.success", { pay: money(e.pay) }));
        else if (e.outcome === "nothing") out.push(t("result.job.nothing"));
        else out.push(t(e.outcome === "hurt" ? "result.job.hurt" : "result.job.arrested"));
        break;
      case "pattedDown":
        out.push(t("result.pattedDown"));
        break;
      case "bribed":
        out.push(t("result.bribed", { amount: money(e.amount) }));
        break;
      case "bribeRefused":
        out.push(t(e.saleOff ? "result.bribeRefusedSale" : "result.bribeRefused"));
        break;
      case "rangRound":
        out.push(t("result.rangRound", { word: heatText(state.heat) }));
        break;
      case "leggedIt":
        out.push(t(e.success ? "result.leggedIt" : "result.legItFailed"));
        break;
      case "arrested": {
        const goods = goodsList(e.seized);
        const fine = money(e.fine);
        out.push(goods ? t("result.arrested", { goods, fine }) : t("result.arrestedEmpty", { fine }));
        break;
      }
      case "handedOver":
        out.push(t(e.saleOff ? "result.handedOverSale" : "result.handedOver"));
        break;
      case "upgraded":
        out.push(t(`result.upgraded.${e.upgrade}`, { pockets: RULES.coatPockets }));
        break;
      case "cardResolved":
        out.push(cardResult(e, state));
        break;
      case "levelUp":
        out.push(t(`result.levelUp.${e.skill}`, { level: e.level }));
        break;
      case "dayStarted":
        out.push(
          e.hour > RULES.dayStart
            ? t("result.dayStartedLate", { day: e.day, time: clock(e.hour) })
            : t("result.dayStarted", { day: e.day }),
        );
        break;
      default:
        break;
    }
  }
  return out;
}

// ---- Briefs: today's news on Street, each dismissable --------------------------------

export interface Brief {
  id: string;
  line: string;
}

function eventLine(e: WorldEvent): string {
  switch (e.kind) {
    case "shortage":
      return t(e.slot === "morning" ? "brief.morningShortage" : "brief.shortage", at(e.place, e.good));
    case "glut":
      return t(e.slot === "morning" ? "brief.morningGlut" : "brief.glut", at(e.place, e.good));
    case "sweep":
      return t("brief.sweep", at(e.place));
    case "harmless":
      return t(`brief.harmless.${e.line}`);
  }
}

/** Today's news: the day-1 line, events that started today, the phone's midday tip. */
export function briefs(s: GameState): Brief[] {
  if (s.phase !== "day") return [];
  const out: Brief[] = [];
  if (s.day === 1) out.push({ id: "d1-line", line: t("brief.day1") });
  const today = s.events
    .filter((e) => e.activated && e.startDay === s.day)
    .sort((a, b) => b.startHour - a.startHour);
  for (const e of today) out.push({ id: e.id, line: eventLine(e) });
  if (s.rumour?.via === "phone") {
    out.push({ id: `d${s.day}-phone`, line: t("brief.phone", { line: rumourLine(s.rumour) }) });
  }
  return out;
}

// ---- The newspaper -------------------------------------------------------------------

export interface PaperView {
  head: string;
  story: string;
  briefs: string[];
  chips: string[];
}

const middayHead = (e: WorldEvent): string => {
  switch (e.kind) {
    case "shortage":
      return t("paper.shortage.head", at(e.place, e.good));
    case "glut":
      return t("paper.glut.head", at(e.place, e.good));
    case "sweep":
      return t("paper.sweep.head", at(e.place));
    case "harmless":
      return t(`paper.harmless.${e.line}.head`);
  }
};

function tomorrowBrief(e: WorldEvent, day: number): string | null {
  const fresh = !e.activated && e.startDay === day + 1;
  switch (e.kind) {
    case "shortage":
      return t(fresh ? "paper.brief.tomorrowShortage" : "paper.brief.stillShortage", at(e.place, e.good));
    case "glut":
      return t(fresh ? "paper.brief.tomorrowGlut" : "paper.brief.stillGlut", at(e.place, e.good));
    case "sweep":
      return t("paper.brief.stillSweep", at(e.place));
    case "harmless":
      return null;
  }
}

/** A case's values for its lines: codename, label, places and days. */
function caseValues(c: OpenCase | PastCase): Values {
  const label = caseLabel(c.place, c.habit);
  const values: Values = { Codename: codename(c.n), label, Label: upper(label) };
  if ("places" in c) {
    const first = operationStart(c);
    Object.assign(values, {
      places: placesText(c.places),
      Places: upper(placesText(c.places)),
      at: placesText(c.places, "at"),
      first,
      last: first + PINCH.operationDays - 1,
    });
  }
  return values;
}

/** Front-page milestones, in the order they lead; a first case or promotion is Pinch's story. */
const FRONT = ["crown", "grand", "phone", "coat", "arrest", "escape", "job", "sale"] as const satisfies readonly MilestoneId[];
const PINCH_ORDER: readonly PinchItem["kind"][] = ["promoted", "closed", "cold", "announced", "intro"];

const pinchHead = (item: PinchItem): [string, string] => {
  const v = "case" in item ? caseValues(item.case) : {};
  switch (item.kind) {
    case "credit":
      return [t("paper.brief.credit"), ""];
    default:
      return [t(`paper.pinch.${item.kind}.head`, v), t(`paper.pinch.${item.kind}.story`, v)];
  }
};
const pinchBrief = (item: PinchItem): string =>
  t(`paper.brief.${item.kind}`, "case" in item ? caseValues(item.case) : {});

/** The evening paper: committed results and scheduled facts, so every line is true. */
export function paperView(p: Paper): PaperView {
  const { log } = p;
  let head: string;
  let story: string;
  let used: WorldEvent | null = null;
  let usedPinch: PinchItem | null = null;

  const front = FRONT.find((m) => p.firsts.includes(m));
  const arrested = (): [string, string] => [
    t("paper.arrested.head"),
    t("paper.arrested.story", { fine: money(log.fine), time: clock(RULES.arrestStart) }),
  ];
  const pinch = PINCH_ORDER.map((k) => p.pinch.find((i) => i.kind === k)).find((i) => i !== undefined);
  const freshMorning = p.tomorrow.find((e) => !e.activated && e.startDay === p.day + 1);
  if (front) {
    [head, story] = front === "arrest" ? arrested() : [t(`paper.first.${front}.head`), t(`paper.first.${front}.story`)];
  } else if (pinch) {
    [head, story] = pinchHead(pinch);
    usedPinch = pinch;
  } else if (log.arrested) {
    [head, story] = arrested();
  } else if (log.hurt) {
    head = t("paper.hurt.head");
    story = t("paper.hurt.story");
  } else if (p.unseenMidday) {
    head = middayHead(p.unseenMidday);
    story = t(p.unseenMidday.kind === "harmless" ? "paper.harmless.story" : "paper.midday.story");
    used = p.unseenMidday;
  } else if (freshMorning && (freshMorning.kind === "shortage" || freshMorning.kind === "glut")) {
    head = t(freshMorning.kind === "shortage" ? "paper.tomorrowShortage.head" : "paper.tomorrowGlut.head", at(freshMorning.place, freshMorning.good));
    story = t("paper.tomorrow.story");
    used = freshMorning;
  } else if (log.best) {
    const b = log.best;
    head = t("paper.best.head", at(b.place, b.good));
    story = t("paper.best.story", { count: upper(goodCount(b.good, b.units)), proceeds: money(b.proceeds) });
  } else {
    head = t("paper.quiet.head");
    story = t("paper.quiet.story");
  }

  const briefs: string[] = [];
  // A midday item nobody saw always makes the paper: as the headline, or else as the first
  // brief, ahead of anything the three-brief cap could cut.
  if (p.unseenMidday && used?.id !== p.unseenMidday.id) {
    briefs.push(eventLine(p.unseenMidday));
    used = p.unseenMidday;
  }
  for (const item of p.pinch) if (item !== usedPinch) briefs.push(pinchBrief(item));
  const c = p.case;
  if (c && !p.pinch.some((i) => i.kind === "announced")) {
    const first = operationStart(c);
    const v = caseValues(c);
    if (first === p.day + 1) briefs.push(t("paper.brief.opTomorrow", v));
    else if (first <= p.day && p.day + 1 < first + PINCH.operationDays) briefs.push(t("paper.brief.opStill", v));
  }
  for (const e of p.tomorrow) {
    if (e.id === used?.id) continue;
    const line = tomorrowBrief(e, p.day);
    if (line) briefs.push(line);
  }
  // Old Reg's worries trail the pub's sale, every fourth day until it is sold.
  if (!p.crown && p.day % 4 === 0) {
    briefs.push(t(`paper.brief.reg.${(p.day / 4 - 1) % 3}` as TextKey, { cost: money(UPGRADE_COST.crown) }));
  }

  const chips: string[] = [];
  if (log.proceeds > 0) chips.push(t("paper.chip.takings", { amount: money(log.proceeds) }));
  if (log.spent > 0) chips.push(t("paper.chip.spent", { amount: money(log.spent) }));
  if (log.jobPaid > 0) chips.push(t("paper.chip.job", { amount: money(log.jobPaid) }));
  if (log.pub > 0) chips.push(t("paper.chip.pub", { amount: money(log.pub) }));
  if (log.stops > 0) chips.push(t("paper.chip.stops", { n: log.stops }));
  if (log.seized > 0) chips.push(t("paper.chip.seized", { n: log.seized }));
  if (log.fine > 0) chips.push(t("paper.chip.fine", { amount: money(log.fine) }));
  chips.push(t("paper.chip.cash", { amount: money(p.cash) }));
  chips.push(t("paper.chip.heat", { word: heatText(p.heat) }));

  return { head, story, briefs: briefs.slice(0, 3), chips };
}

// ---- Cards ---------------------------------------------------------------------------

/** Both false trails share Lenny's text. */
const textId = (id: CardId): string => (id === "falseTrailInspector" ? "falseTrail" : id);

/** A card's text by its suffix, e.g. cardText("terry", "story"). */
export function cardText(id: CardId, suffix: string, values: Values = {}): string {
  const key = `card.${textId(id)}.${suffix}`;
  return hasText(key) ? t(key, values) : key;
}

/** The text keys every card needs, for the test that they all exist. */
export function cardKeys(id: CardId): string[] {
  const card = CARDS[id];
  const keys = [`card.${textId(id)}.${card.choices.length === 0 ? "report" : "story"}`];
  if (card.choices.length > 0) keys.push(`card.${textId(id)}.who`);
  for (const c of card.choices) {
    keys.push(`card.${textId(id)}.${c.id}`);
    if (c.chance) keys.push(`card.${textId(id)}.${c.id}.after`, `card.${textId(id)}.${c.id}.won`, `card.${textId(id)}.${c.id}.lost`);
    else keys.push(`card.${textId(id)}.${c.id}.done`);
  }
  return keys;
}

/** The values a card's story needs: for the false trail, where and what. */
export function cardValues(s: GameState, id: CardId): Values {
  const c = s.detective.case;
  const values: Values = c ? caseValues(c) : {};
  const cost = CARDS[id].choices.flatMap((ch) => ch.effects).find((e) => e.kind === "cash" && e.amount < 0);
  if (cost?.kind === "cash") values.cost = money(-cost.amount);
  return values;
}

export interface ChipView {
  text: string;
  kind: "certain" | "chance";
  warn: boolean;
}

function effectChips(s: GameState, effects: readonly Effect[], kind: ChipView["kind"]): ChipView[] {
  const out: ChipView[] = [];
  const chip = (text: string, warn = false) => out.push({ text, kind, warn });
  for (const e of effects) {
    switch (e.kind) {
      case "cash":
        if (e.amount < 0) chip(t("chip.cost", { amount: money(-e.amount) }), true);
        else chip(t("chip.gain", { amount: money(e.amount) }));
        break;
      case "heat":
        chip(e.amount >= 0 ? t("chip.heat", { heat: e.amount }) : t("chip.cool", { heat: -e.amount }), e.amount > 0);
        break;
      case "gain": {
        const g = gainOf(s, e);
        if (g.units > 0) {
          chip(t("chip.cost", { amount: money(g.cost) }), true);
          chip(t("chip.add", { goods: goodCount(e.good, g.units) }));
        }
        break;
      }
      case "sell":
        chip(t("chip.gain", { amount: money(cardSale(s, e)) }));
        break;
      case "lose": {
        const good = GOODS.reduce((a, b) => (s.held[b] > s.held[a] ? b : a));
        chip(t("chip.lose", goodValues(good)), true);
        break;
      }
      case "xp":
        chip(t("chip.xp", { skill: skillName(e.skill), n: e.amount }));
        break;
      case "hours":
        chip(t("hours", { n: e.hours }));
        break;
      case "tip":
        chip(t("chip.tip"));
        break;
      case "moveOperation":
        chip(t("chip.move"));
        break;
      case "flag":
        break;
    }
  }
  return out;
}

/** A choice's chips: certain effects solid; a chance's odds and outcomes dashed with a die. */
export function choiceChips(s: GameState, choice: Choice, odds: number | null): ChipView[] {
  const chips = effectChips(s, choice.effects, "certain");
  if (choice.chance) {
    chips.push({ text: oddsText(odds ?? chanceOdds(s, choice.chance)), kind: "chance", warn: false });
    chips.push(...effectChips(s, [...choice.chance.win, ...choice.chance.lose], "chance"));
  }
  return chips;
}

/** The line a card's choice leaves on Street. */
export function cardResult(e: Extract<DomainEvent, { type: "cardResolved" }>, s: GameState): string {
  const gained = perGoodAbs(e.goods);
  const values: Values = {
    goods: goodsList(gained),
    cost: money(Math.max(0, -e.cash)),
    amount: money(Math.abs(e.cash)),
    ...(s.detective.case ? caseValues(s.detective.case) : {}),
  };
  if (e.choice === null) return cardText(e.card, "report", values);
  const suffix = e.won === null ? "done" : e.won ? "won" : "lost";
  return cardText(e.card, `${e.choice}.${suffix}`, values);
}

const perGoodAbs = (goods: PerGood<number>): PerGood<number> =>
  Object.fromEntries(GOODS.map((g) => [g, Math.abs(goods[g])])) as PerGood<number>;

// ---- People: Pinch's board -------------------------------------------------------------

export interface Exhibit {
  letter: string;
  what: string;
  reading: string;
}

/** Each milestone pinned as an exhibit, in the order they happened, with his reading of it. */
export function exhibits(s: GameState): Exhibit[] {
  const pinned: { day: number; what: string; reading: string }[] = [];
  for (const m of MILESTONES) {
    const day = s.milestones.firsts[m];
    if (day === undefined) continue;
    pinned.push({ day, what: t(`exhibit.${m}`, { day, amount: money(PINCH.grand) }), reading: t(`exhibit.${m}.reading`) });
  }
  const best = s.milestones.best;
  if (best) pinned.push({ day: best.day, what: t("exhibit.best", { day: best.day, amount: money(best.takings) }), reading: t("exhibit.best.reading") });
  return pinned
    .sort((a, b) => a.day - b.day)
    .map((x, i) => ({ letter: String.fromCharCode(65 + (i % 26)), what: x.what, reading: x.reading }));
}

/** His line on the board: the open case, his rest, or what he is doing. */
export function pinchLine(s: GameState): string {
  const c = s.detective.case;
  if (c) {
    const on = s.day >= operationStart(c);
    return t(on ? "people.case.on" : "people.case.announced", caseValues(c));
  }
  const last = s.milestones.cases.at(-1);
  if (last && s.day < s.detective.next) return t("people.pinch.resting", caseValues(last));
  return t(s.day >= PINCH.introDay || last ? "people.pinch.watching" : "people.pinch.unaware");
}

export const pastCaseLine = (c: PastCase): string => t("people.case.past", caseValues(c));

/** One current line per cast member; flags and milestones change them. */
export function castLines(s: GameState): { who: "lenny" | "mags" | "reg"; name: string; line: string }[] {
  const crown = has(s, "crown");
  const cells = s.news.at(-1)?.log.arrested === true;
  return [
    { who: "lenny", name: t("cast.lenny"), line: t(crown ? "cast.lenny.guvnor" : "cast.lenny.line") },
    { who: "mags", name: t("cast.mags"), line: t(cells ? "cast.mags.cells" : "cast.mags.line") },
    { who: "reg", name: t("cast.reg"), line: t(crown ? "cast.reg.gone" : "cast.reg.line", { cost: money(UPGRADE_COST.crown) }) },
  ];
}

/** How old a remembered price is, in words. */
export function seenText(s: GameState, day: number, hour: number): string {
  if (day === s.day && hour === s.hour) return t("city.seenNow");
  if (day === s.day) return t("city.seenToday", { time: clock(hour) });
  if (day === s.day - 1) return t("city.seenYesterday");
  return t("city.seenDay", { day });
}
