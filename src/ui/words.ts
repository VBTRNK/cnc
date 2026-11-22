// What the player reads, derived from the state and the last action's domain events.
// Pure functions, so they are tested without a browser.

import {
  CARDS,
  DOUGIE_LOAN,
  GOODS,
  MILESTONES,
  PINCH,
  RULES,
  TERRY_GAIN,
  TRAIL,
  UPGRADE_COST,
  cardSale,
  cardSeizure,
  chanceOdds,
  gainOf,
  has,
  heatWord,
  isSafeRepeat,
  type CardId,
  type Choice,
  type DomainEvent,
  type Effect,
  type GameState,
  type GoodId,
  type MilestoneId,
  type Paper,
  type PastCase,
  type PerGood,
  type PinchItem,
  type PlaceId,
  type Rumour,
  type Seen,
  type WorldEvent,
} from "../sim/index.ts";
import {
  clock,
  goodCount,
  goodValues,
  hasText,
  money,
  placeValues,
  skillName,
  t,
  upper,
  type TextKey,
  type Values,
} from "./text.ts";
import { caseArrest, caseAt, caseDates, caseResult, caseSites, eventNotice, localCase, observation, operationName, operationNotice, sitesChanged, trailLine, type Notice } from "./caseWords.ts";

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
export const displayChance = (chance: number): number => Number(chance.toFixed(1));
export const jobSuccessText = (chance: number): string => t("job.success", { chance: displayChance(chance) });

const at = (place: PlaceId, good?: GoodId) => ({ ...placeValues(place), ...(good ? goodValues(good) : {}) });

function priceTipLine(tip: { place: PlaceId; good: GoodId; price: number }, seen?: Seen): string {
  const quote = t("result.tipPrice", { ...at(tip.place, tip.good), price: money(tip.price) });
  return seen ? `${quote} ${t("result.tipTime", { day: seen.day, time: clock(seen.hour) })}` : quote;
}

export function dougieNotice(s: GameState): Notice | null {
  const loan = s.flags.loan;
  const repaid = s.cards.oldMatePays;
  const amount = money(DOUGIE_LOAN.repayment);
  if (loan !== undefined) {
    const due = loan + DOUGIE_LOAN.days;
    return {
      title: t("dougie.owed", { amount }),
      meta: t("dougie.lent", { amount: money(DOUGIE_LOAN.principal), day: loan }),
      body: s.day < due ? t("dougie.due", { day: due }) : t("dougie.overdue", { due, day: s.day + 1 }),
    };
  }
  if (repaid === undefined) return null;
  return {
    title: t("dougie.repaid", { amount, day: repaid }),
    body: s.dougieTip ? priceTipLine(s.dougieTip, s.dougieTip) : t("dougie.legacyQuote"),
  };
}

export function terryQuoteLine(quote: { units: number; cost: number }): string {
  return t(quote.units > 0 ? "terry.quote" : "terry.full", {
    until: clock(RULES.dayEnd),
    goods: goodCount(TERRY_GAIN.good, quote.units || TERRY_GAIN.units),
    cost: money(quote.units > 0 ? quote.cost : TERRY_GAIN.cost),
  });
}

/** "12 tapes, 3 watches": the goods in a seizure, in catalogue order. */
export function goodsList(goods: PerGood<number>): string {
  return GOODS.filter((g) => goods[g] > 0)
    .map((g) => goodCount(g, goods[g]))
    .join(", ");
}

export function rumourLine(r: Rumour, day: number): string {
  if (!r.claim) return t("result.rumourNone", { day });
  return t(r.claim.kind === "shortage" ? "result.rumourShortage" : "result.rumourGlut", { day, ...at(r.claim.place, r.claim.good) });
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
          // Both tip paths record a remote price before advancing the clock. The
          // post-action snapshot only revisits prices at the player's current place.
          const seen = state.memory[e.tip.place][e.tip.good];
          const line = priceTipLine(e.tip, seen);
          out.push(events.some((x) => x.type === "cardResolved") ? line : t("result.mags", { line }));
        } else if (e.tip.via === "ask") {
          out.push(t("result.mags", { line: rumourLine(e.tip, state.day + 1) }));
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
        out.push(e.operation === undefined ? t("result.pattedDown") : "Pinch patted you down. Your pockets were empty, so the job went ahead.");
        break;
      case "bribed":
        out.push(t("result.bribed", { amount: money(e.amount) }));
        break;
      case "bribeRefused": {
        const goods = goodsList(e.seized);
        out.push(t("result.bribeRefused"));
        if (goods) out.push(t("result.tookGoods", { goods }));
        if (e.saleOff) out.push(t("result.saleCancelled"));
        break;
      }
      case "rangRound":
        out.push(t("result.rangRound", { day: state.day, time: clock(state.hour), word: heatText(state.heat) }));
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
      case "handedOver": {
        const goods = goodsList(e.seized);
        const c = state.phase === "day" ? localCase(state, true) : null;
        out.push(goods
          ? `You handed over ${goods}. ${e.saleOff ? "The sale was cancelled." : "The job went ahead."}`
          : t(e.saleOff ? "result.handedOverSale" : "result.handedOver"));
        if (c) out.push(`${operationName(c)} closes tonight.`);
        break;
      }
      case "upgraded":
        out.push(t(`result.upgraded.${e.upgrade}`, {
          pockets: RULES.coatPockets,
          cost: money(e.cost),
          takings: money(PINCH.crownTakings),
        }));
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
  /** Who it comes from, set in bold before the line: "Mags:". */
  who: string;
  /** The same, for its dismiss button's name. */
  from: "mags" | "phone" | "news";
  line: string;
}

function eventLine(e: WorldEvent): string {
  if (e.kind === "harmless") return t(`brief.harmless.${e.line}`);
  const notice = eventNotice(e);
  return `${notice.title}. ${noticeStory(notice)}`;
}

/** Today's updates: opening advice, public events and the lead about tomorrow. */
export function briefs(s: GameState): Brief[] {
  if (s.phase !== "day") return [];
  const out: Brief[] = [];
  const mags = t("brief.who.mags");
  if (s.day === 1) out.push({ id: "d1-line", who: mags, from: "mags", line: t("brief.day1") });
  const today = s.events
    .filter((e) => e.activated && e.startDay === s.day)
    .sort((a, b) => b.startHour - a.startHour);
  for (const e of today) {
    if (e.kind === "sweep" && e.place === s.place) continue; // Already beside the place heading.
    const from = e.kind === "harmless" ? "mags" : "news";
    out.push({ id: e.id, who: t(`brief.who.${from}`), from, line: eventLine(e) });
  }
  if (s.rumour) {
    const from = s.rumour.via === "ask" ? "mags" : "phone";
    out.push({ id: `d${s.day}-rumour`, who: t(`brief.who.${from}`), from, line: rumourLine(s.rumour, s.day + 1) });
  }
  return out;
}

// ---- The newspaper -------------------------------------------------------------------

export interface PaperView {
  head: string;
  story: string;
  required: Notice[];
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

/** Front-page milestones, in the order they lead; a first case or promotion is Pinch's story. */
const FRONT = ["crown", "grand", "phone", "coat", "arrest", "escape", "job", "sale"] as const satisfies readonly MilestoneId[];
const PINCH_ORDER: readonly PinchItem["kind"][] = ["promoted", "closed", "cold", "announced", "intro"];

function pinchStory(item: Exclude<PinchItem, { kind: "credit" }>, day: number): Notice {
  switch (item.kind) {
    case "announced": {
      const c = item.case;
      const notice = operationNotice(c, day);
      const { head, body } = observation(c);
      return {
        title: head,
        body: `${body} ${notice.title} runs ${caseSites(c.places)} on ${caseDates(c)}. ${notice.body}${c.habit === "oddJob" && c.observed ? " Odd jobs still pay as usual." : ""}`,
      };
    }
    case "closed":
    case "cold":
      return { title: `${operationName(item.case)} ${item.kind === "closed" ? "closed" : "went cold"}`, body: caseResult(item.case) };
    case "intro":
    case "promoted":
      return { title: t(`paper.pinch.${item.kind}.head`), body: t(`paper.pinch.${item.kind}.story`) };
  }
}

const noticeStory = (n: Notice): string => [n.meta && `${n.meta}.`, n.body].filter(Boolean).join(" ");

function confirmedNotice(e: Exclude<WorldEvent, { kind: "harmless" }>): Notice {
  const notice = eventNotice(e);
  return { ...notice, meta: `Confirmed · ${notice.meta}` };
}

/** The evening paper: committed results and scheduled facts, so every line is true. */
export function paperView(p: Paper, cases: readonly PastCase[] = []): PaperView {
  const { log } = p;
  let head: string;
  let story: string;
  const used = new Set<string>();
  let usedPinch: PinchItem | null = null;

  const front = FRONT.find((m) => p.firsts.includes(m));
  const closure = p.pinch.find((item) => item.kind === "closed");
  const inCase = caseArrest(p);
  const arrested = (): [string, string] => closure?.kind === "closed" && inCase
    ? [`Nicked ${caseAt(inCase.place)}`, caseResult(closure.case)]
    : [
    t("paper.arrested.head"),
    t("paper.arrested.story", { fine: money(log.fine), day: p.day + 1, time: clock(RULES.arrestStart) }),
  ];
  const pinch = PINCH_ORDER.map((k) => p.pinch.find((i) =>
    i.kind === k && (i.kind !== "announced" || !isSafeRepeat(i.case, cases.find((c) => c.n === i.case.n - 1))),
  )).find((i) => i !== undefined);
  const freshMorning = p.tomorrow.find((e) => !e.activated && e.startDay === p.day + 1);
  if (front) {
    [head, story] = front === "arrest" ? arrested() : [
      t(`paper.first.${front}.head`),
      t(`paper.first.${front}.story`, {
        cost: money(UPGRADE_COST.crown),
        takings: money(PINCH.crownTakings),
        amount: money(PINCH.grand),
        pockets: RULES.coatPockets - RULES.pockets,
      }),
    ];
    if (front === "arrest" && inCase) usedPinch = closure ?? null;
  } else if (pinch && pinch.kind !== "credit") {
    const n = pinchStory(pinch, p.day);
    head = n.title;
    story = noticeStory(n);
    usedPinch = pinch;
  } else if (log.arrested) {
    [head, story] = arrested();
    if (inCase) usedPinch = closure ?? null;
  } else if (log.hurt) {
    head = t("paper.hurt.head");
    story = t("paper.hurt.story");
  } else if (p.unseenMidday) {
    const e = p.unseenMidday;
    head = middayHead(e);
    story = e.kind === "harmless" ? t("paper.harmless.story") : noticeStory(confirmedNotice(e));
    used.add(e.id);
  } else if (freshMorning && (freshMorning.kind === "shortage" || freshMorning.kind === "glut")) {
    head = t(freshMorning.kind === "shortage" ? "paper.tomorrowShortage.head" : "paper.tomorrowGlut.head", at(freshMorning.place, freshMorning.good));
    story = noticeStory(confirmedNotice(freshMorning));
    used.add(freshMorning.id);
  } else if (log.best) {
    const b = log.best;
    head = t("paper.best.head", at(b.place, b.good));
    story = t("paper.best.story", { count: upper(goodCount(b.good, b.units)), proceeds: money(b.proceeds) });
  } else {
    head = t("paper.quiet.head");
    story = t("paper.quiet.story");
  }

  const required: Notice[] = [];
  const colour: string[] = [];
  const midday = p.unseenMidday;
  if (midday && !used.has(midday.id) && midday.kind === "harmless") colour.push(eventLine(midday));
  for (const item of p.pinch) {
    if (item === usedPinch) continue;
    if (item.kind === "credit") colour.push(t("paper.brief.credit"));
    else if (item.kind === "announced") {
      const notice = operationNotice(item.case, p.day);
      required.push({
        ...notice,
        body: `${observation(item.case).body} ${notice.body}${item.case.habit === "oddJob" && item.case.observed ? " Odd jobs still pay as usual." : ""}`,
      });
    } else required.push(pinchStory(item, p.day));
  }
  if (log.arrested && !inCase && (front ? front !== "arrest" : usedPinch !== null)) {
    const [title, body] = arrested();
    required.push({ title, body });
  }
  const c = p.case;
  if (c && !p.pinch.some((i) => i.kind === "announced" && i.case.n === c.n)) {
    const notice = operationNotice(c, p.day);
    required.push({ ...notice, body: [trailLine(c), notice.body].filter(Boolean).join(" ") });
  }
  for (const e of [...p.tomorrow, ...(midday ? [midday] : [])]) {
    if (used.has(e.id) || e.kind === "harmless") continue;
    required.push(confirmedNotice(e));
    used.add(e.id);
  }
  // Old Reg's worries trail the pub's sale, every fourth day until it is sold.
  if (!p.crown && p.day % 4 === 0) {
    colour.push(t(`paper.brief.reg.${(p.day / 4 - 1) % 3}` as TextKey, { cost: money(UPGRADE_COST.crown) }));
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

  return { head, story, required, briefs: colour.slice(0, 3), chips };
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
  if (TRAIL.includes(id)) return ["card.falseTrail.who", "card.falseTrail.leave"];
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

/** The price in a card's choice label, when it has a cash cost. */
export function cardValues(id: CardId): Values {
  const cost = CARDS[id].choices.flatMap((ch) => ch.effects).find((e) => e.kind === "cash" && e.amount < 0);
  return cost?.kind === "cash" ? { cost: money(-cost.amount) } : {};
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
      case "sell": {
        const proceeds = cardSale(s, e);
        if (proceeds !== null) chip(t("chip.gain", { amount: money(proceeds) }));
        break;
      }
      case "lose": {
        const seizure = cardSeizure(s, e);
        if (seizure) chip(t("chip.lose", { goods: goodCount(seizure.good, seizure.units) }), true);
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
  const c = s.detective.case;
  if (TRAIL.includes(e.card)) {
    if (!c) return e.choice === "leave" ? "You kept your cash." : `You paid Lenny ${money(-e.cash)}. There was no warning to move.`;
    const name = operationName(c);
    const sites = caseSites(c.places);
    const dates = caseDates(c);
    if (e.choice === "leave") return `You kept your cash. ${name} stays ${sites} on ${dates}.`;
    const paid = `You paid Lenny ${money(-e.cash)}.`;
    if (!e.won) return `${paid} Pinch kept ${name} ${sites} on ${dates}.`;
    return c.trail
      ? `${paid} ${name} moved ${sitesChanged(c.trail.from, c.places)} It still runs on ${dates}.`
      : `${paid} ${name} stayed ${sites} on ${dates}.`;
  }
  const gained = perGoodAbs(e.goods);
  const goods = goodsList(gained);
  const values: Values = {
    goods,
    cost: money(Math.max(0, -e.cash)),
    amount: money(Math.abs(e.cash)),
  };
  if (e.choice === null) return cardText(e.card, "report", values);
  if (e.card === "tradingStandards" && e.won === false && !goods) return t("card.tradingStandards.brazen.empty");
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

/** Same-day prices only need their hour. Older quotes keep the day and hour. */
export function seenText(s: GameState, day: number, hour: number): string {
  if (day === s.day) return t("city.seenToday", { time: clock(hour) });
  return t("city.seenDay", { day, time: clock(hour) });
}
