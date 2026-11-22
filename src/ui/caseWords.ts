import { GOODS, PINCH, RULES, operationStart, type CaseArrest, type GameState, type OpenCase, type Paper, type PastCase, type Seizure, type WorldEvent } from "../sim/index.ts";
import { clock, codename, goodCount, goodKind, goodSales, goodValues, money, placeValues, placesText, upper } from "./text.ts";

export interface Notice {
  title: string;
  meta?: string;
  body: string;
  warning?: true;
}

export const operationName = (c: Pick<OpenCase, "n">): string => `Operation ${codename(c.n)}`;
export const caseAt = (place: OpenCase["place"]): string => place === "uptown" ? "in Uptown" : String(placeValues(place).at);
export const caseSites = (places: OpenCase["places"]): string => places.map(caseAt).join(" and ");

export function caseDates(c: OpenCase): string {
  const first = operationStart(c);
  return `days ${first}–${first + PINCH.operationDays - 1}`;
}

export function localCase(s: GameState, activeOnly = false): OpenCase | null {
  const c = s.detective.case;
  if (!c?.places.includes(s.place)) return null;
  const first = operationStart(c);
  return s.day < first + PINCH.operationDays && (!activeOnly || s.day >= first) ? c : null;
}

export const refusal = "Pinch refuses bribes.";

export function operationNotice(c: OpenCase, day: number): Notice {
  const underway = day >= operationStart(c);
  return {
    title: operationName(c),
    meta: `${underway ? "Underway" : "Scheduled"} ${caseSites(c.places)} · ${caseDates(c)}`,
    body: `Sales and risky jobs face higher stop risk. ${refusal}`,
    ...(underway ? { warning: true as const } : {}),
  };
}

export function sweepNotice(e: Extract<WorldEvent, { kind: "sweep" }>): Notice {
  return {
    title: "Police sweep",
    meta: `${upper(caseAt(e.place))} · through ${clock(RULES.dayEnd)} on day ${e.endDay}`,
    body: "Sales and risky jobs face higher stop risk. Ordinary bribe rules apply.",
    warning: true,
  };
}

type Theory = Pick<OpenCase, "place" | "habit" | "observed">;

export function observation(c: Theory): { head: string; body: string } {
  const { habit } = c;
  const at = caseAt(c.place);
  if (!c.observed) {
    const subject = GOODS.find((g) => g === habit);
    const topic = subject ? goodKind(subject) : {
      ask: "asking around", oddJob: "odd jobs", lieLow: "keeping a low profile", job: "risky jobs", drink: "the Crown & Anchor",
    }[habit as "ask" | "oddJob" | "lieLow" | "job" | "drink"];
    return { head: `Pinch opens a case ${at}`, body: `Pinch’s theory concerned ${topic} ${at}.` };
  }
  switch (habit) {
    case "oddJob":
      return {
        head: c.place === "docks" ? "Pinch investigates your dock shifts" : `Pinch investigates your shifts ${at}`,
        body: `You worked odd jobs ${at}. Pinch calls the regular hours suspicious.`,
      };
    case "ask":
      return { head: "Pinch investigates your questions", body: `You asked around ${at}. Pinch calls it intelligence gathering.` };
    case "lieLow":
      return { head: "Pinch investigates a quiet spell", body: `You kept your head down ${at}. Pinch calls the quiet suspicious.` };
    case "job":
      return { head: `Pinch looks into a risky job ${at}`, body: `You took on risky work ${at}. Pinch calls it a bigger scheme.` };
    case "drink":
      return { head: "Pinch sets his sights on the Crown", body: "You bought the Crown & Anchor. Pinch calls it a new headquarters." };
    default: {
      const good = goodKind(habit);
      return { head: `Pinch sees a plot in your ${goodSales(habit)} sales`, body: `You sold ${good} ${at}. Pinch calls it organised crime.` };
    }
  }
}

export function sitesChanged(from: OpenCase["places"], to: OpenCase["places"], retained = "stays"): string {
  const left = from.filter((p) => !to.includes(p));
  const added = to.filter((p) => !from.includes(p));
  const kept = to.filter((p) => from.includes(p));
  const move = `from ${placesText(left)} to ${placesText(added)}.`;
  return kept.length ? `${move} ${upper(placesText(kept))} ${retained} on the list.` : move;
}

export function trailLine(c: OpenCase | PastCase): string {
  if (!c.trail) return "";
  const change = "places" in c
    ? sitesChanged(c.trail.from, c.places)
    : sitesChanged(c.trail.from, c.trail.to, "stayed");
  return `Lenny’s story moved the operation ${change}`;
}

export function currentCaseNotice(s: GameState, c: OpenCase): Notice {
  const notice = operationNotice(c, s.day);
  const original = s.news.find((p) => p.day === c.announced)?.pinch.find((i) => i.kind === "announced" && i.case.n === c.n);
  const earlier = original?.kind === "announced" && original.case.places.some((p) => !c.places.includes(p))
    ? `Earlier warning covered ${placesText(original.case.places)}.`
    : "";
  const handed = c.evidence?.handover;
  const pendingClosure = handed
    ? `You handed over ${seizureText(handed.goods) || "your goods"} ${caseAt(handed.place)}. The case closes tonight.`
    : c.caught ? "The case closes tonight." : "";
  return { ...notice, body: [observation(c).body, trailLine(c) || earlier, pendingClosure, notice.body].filter(Boolean).join(" ") };
}

export const seizureText = (goods: Seizure): string => goods.map(([g, n]) => goodCount(g, n)).join(", ");

export function arrestCost(a: CaseArrest): string {
  const goods = seizureText(a.goods);
  return goods ? `The police took ${goods} and fined you ${money(a.fine)}.` : `The police fined you ${money(a.fine)}.`;
}

export function caseResult(c: PastCase): string {
  const status = c.outcome === "closed" ? "closed" : "went cold";
  return [`${operationName(c)} ${status} on day ${c.day}.`, ...caseOutcome(c)].join(" ");
}

export function resolvedCaseNotice(c: PastCase): Notice {
  const status = c.outcome === "closed" ? "Closed" : "Went cold";
  return {
    title: operationName(c),
    meta: `${status} · day ${c.day}`,
    body: [...caseOutcome(c), observation(c).body].join(" "),
  };
}

function caseOutcome(c: PastCase): string[] {
  const parts = c.trail ? [trailLine(c)] : [];
  if (c.outcome === "cold") return [...parts, "It ended without an arrest or seizure in the operation."];
  const { handover, arrest } = c.evidence ?? {};
  if (handover) {
    const goods = seizureText(handover.goods) || "your goods";
    const at = caseAt(handover.place);
    parts.push(`You handed over ${goods} ${at}.`);
    if (handover.action === "sell") parts.push("The sale was cancelled.");
    else if (handover.job?.outcome === "success") parts.push(`The job went ahead and paid ${money(handover.job.pay)}.`);
    else if (handover.job?.outcome === "nothing") parts.push("The job went ahead and came to nothing.");
    else if (handover.job?.outcome === "hurt") parts.push("You were hurt on the job.");
  }
  if (arrest) {
    const at = caseAt(arrest.place);
    if (arrest.cause === "escape") {
      parts.push(handover
        ? `Pinch stopped you again ${at}. You tried to run and were arrested.`
        : `Pinch stopped you ${at}. You tried to run and were arrested.`);
    } else {
      parts.push(handover?.job?.outcome === "arrested"
        ? "The job went ahead and ended in arrest."
        : `${handover ? "A later risky job" : "The risky job"} ${at} ended in arrest.`);
    }
    parts.push(arrestCost(arrest));
  }
  return parts;
}

export function archivedCase(s: GameState, c: PastCase): PastCase {
  if (c.evidence || c.trail) return c;
  const edition = s.news.find((p) => p.day === c.day);
  const item = edition?.pinch.find((i) =>
    (i.kind === "closed" || i.kind === "cold") && i.kind === c.outcome && i.case.n === c.n && i.case.day === c.day,
  );
  return item?.kind === "closed" || item?.kind === "cold" ? item.case : c;
}

export function caseArrest(p: Paper): CaseArrest | undefined {
  const closed = p.pinch.find((i) => i.kind === "closed");
  return closed?.kind === "closed" ? closed.case.evidence?.arrest : undefined;
}

export function eventNotice(e: Exclude<WorldEvent, { kind: "harmless" }>): Notice {
  if (e.kind === "sweep") return sweepNotice(e);
  return {
    title: `${goodValues(e.good).Kind} ${e.kind} ${caseAt(e.place)}`,
    meta: `From ${clock(e.startHour)} on day ${e.startDay} through day ${e.endDay}`,
    body: e.kind === "shortage" ? "Prices are higher and stock is tighter." : "Prices are lower and stock is more plentiful.",
  };
}
