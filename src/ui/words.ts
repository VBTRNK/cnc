// What the player reads, derived from the state and the last action's domain events.
// Pure functions, so they are tested without a browser.

import {
  RULES,
  heatWord,
  type DomainEvent,
  type GameState,
  type GoodId,
  type Paper,
  type PlaceId,
  type Rumour,
  type WorldEvent,
} from "../sim/index.ts";
import { clock, goodCount, goodValues, money, placeValues, t } from "./text.ts";

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
      case "sold":
        out.push(t("result.sold", { count: goodCount(e.good, e.units), proceeds: money(e.proceeds) }));
        if (state.phase === "day" && state.market[state.place][e.good].demand === 0) {
          out.push(t("result.soldOut", goodValues(e.good)));
        }
        break;
      case "travelled":
        out.push(t("result.travelled", { ...placeValues(e.to), hours: e.hours }));
        break;
      case "tip":
        if (e.tip.kind === "price") {
          out.push(t("result.tipPrice", { ...at(e.tip.place, e.tip.good), price: money(e.tip.price) }));
        } else if (e.tip.via === "ask") {
          out.push(rumourLine(e.tip));
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
        break;
      case "pattedDown":
        out.push(t("result.pattedDown"));
        break;
      case "bribed":
        out.push(t("result.bribed", { amount: money(e.amount) }));
        break;
      case "leggedIt":
        if (e.success) out.push(t("result.leggedIt"));
        break;
      case "handedOver":
        out.push(t(e.saleOff ? "result.handedOverSale" : "result.handedOver"));
        break;
      case "upgraded":
        out.push(t(`result.upgraded.${e.upgrade}`, { pockets: RULES.coatPockets }));
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

/** The evening paper: committed results and scheduled facts, so every line is true. */
export function paperView(p: Paper): PaperView {
  const { log } = p;
  const takings = log.proceeds + log.jobPaid;
  let head: string;
  let story: string;
  let used: WorldEvent | null = null;

  const freshMorning = p.tomorrow.find((e) => !e.activated && e.startDay === p.day + 1);
  if (log.arrested) {
    head = t("paper.arrested.head");
    story = t("paper.arrested.story");
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
  } else if (takings >= 200) {
    head = t("paper.earner.head");
    story = t("paper.earner.story", { total: money(takings) });
  } else {
    head = t("paper.quiet.head");
    story = t("paper.quiet.story");
  }

  const briefs = p.tomorrow
    .filter((e) => e.id !== used?.id)
    .map((e) => tomorrowBrief(e, p.day))
    .filter((line): line is string => line !== null);

  const chips: string[] = [];
  if (log.proceeds > 0) chips.push(t("paper.chip.takings", { amount: money(log.proceeds) }));
  if (log.spent > 0) chips.push(t("paper.chip.spent", { amount: money(log.spent) }));
  if (log.jobPaid > 0) chips.push(t("paper.chip.job", { amount: money(log.jobPaid) }));
  if (log.stops > 0) chips.push(t("paper.chip.stops", { n: log.stops }));
  chips.push(t("paper.chip.cash", { amount: money(p.cash) }));
  chips.push(t("paper.chip.heat", { word: heatText(p.heat) }));

  return { head, story, briefs, chips };
}

/** How old a remembered price is, in words. */
export function seenText(s: GameState, day: number, hour: number): string {
  if (day === s.day && hour === s.hour) return t("city.seenNow");
  if (day === s.day) return t("city.seenToday", { time: clock(hour) });
  if (day === s.day - 1) return t("city.seenYesterday");
  return t("city.seenDay", { day });
}
