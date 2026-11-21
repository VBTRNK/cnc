// Run from one of the replay's rules worktrees.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fromWorktree = (path) => import(pathToFileURL(resolve(path)).href);
const { cardRuns, selectRun } = await fromWorktree("scripts/strategy-runner.ts");
const { Rng } = await fromWorktree("src/sim/rng.ts");
const selection = selectRun("30", "400", "1", "trader");
const { parents, samples } = cardRuns(selection);
const loans = samples.get("oldMate:lend") ?? [];
if (parents.some(({ outcome }) => outcome.end !== "endpoint") || loans.some(({ diff }) => diff === null)) {
  throw new Error("Incomplete card audit");
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
function describe(rows) {
  const values = rows.map(({ diff }) => diff).sort((a, b) => a - b);
  const { length: n } = values;
  const at = (q) => values[Math.floor(q * n)] ?? null;
  return { n, mean: n ? sum(values) / n : null, p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

const measured = loans.filter(({ status }) => status === "measured");
const bySeed = Map.groupBy(measured, ({ seed }) => seed);
const clusters = selection.seeds.map((seed) => {
  const rows = bySeed.get(seed) ?? [];
  return { n: rows.length, total: sum(rows.map(({ diff }) => diff)) };
});
// Keep forks from one parent together when resampling the mean.
const rng = new Rng(7919);
const resamples = Array.from({ length: 10_000 }, () => {
  let n = 0;
  let total = 0;
  for (const _ of clusters) {
    const cluster = rng.pick(clusters);
    n += cluster.n;
    total += cluster.total;
  }
  return total / n;
}).sort((a, b) => a - b);

const result = {
  ...selection,
  measured: describe(measured),
  measuredMean95: [resamples[250], resamples[9750]],
  outstanding: describe(loans.filter(({ status }) => status === "outstanding")),
  cutShort: describe(loans.filter(({ status }) => status === "cutShort")),
  atAvailableCloses: describe(loans),
};
writeFileSync(process.env.REPORT, JSON.stringify(result, null, 2) + "\n");
