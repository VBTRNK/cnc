// Strategy runs over the live simulation. See docs/design.md for coverage and report formulas.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cardReport, formatCards, formatStrategies, strategyReport } from "./strategy-report.ts";
import { openingSnapshot, selectRun } from "./strategy-runner.ts";

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

try {
  const [, , days, count, ...rest] = process.argv;
  if (rest.length > 0) throw new Error("usage: npm run strategies -- [days] [seeds]");
  const { CARDS, DETAIL, ONLY, OPENING, REPORT, SEED_START } = process.env;
  if (OPENING && CARDS) throw new Error("select one of OPENING and CARDS");
  const selection = selectRun(days, count, SEED_START, ONLY);
  const head = git("rev-parse", "HEAD");
  const status = head === null ? null : git("status", "--porcelain");
  const start = performance.now();
  const report = OPENING ? {
    version: 1, mode: "opening" as const, seed: selection.seeds[0]!, opening: openingSnapshot(selection.seeds[0]!),
  } : CARDS ? cardReport(selection) : strategyReport(selection);
  const ms = performance.now() - start;
  const json = JSON.stringify(report, null, 2) + "\n";
  if (REPORT) writeFileSync(REPORT, json, "utf8");
  if (report.mode === "opening") {
    process.stdout.write(json);
  } else if (report.mode === "cards") {
    console.log(formatCards(report));
    if (report.parents.completed !== report.parents.requested || report.comparisons.guard + report.comparisons.failed > 0) process.exitCode = 1;
  } else {
    console.log(formatStrategies(report, Boolean(DETAIL)));
    if (report.results.some((r) => r.samples.completed !== r.samples.requested)) process.exitCode = 1;
  }
  console.error(`strategies invocation: Node ${process.version}; Git ${head ?? "unavailable"} (${status === null ? "status unavailable" : status ? "dirty" : "clean"}); ${(ms / 1000).toFixed(2)} s`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
