import { availableParallelism } from "node:os";
import { Worker, parentPort, workerData } from "node:worker_threads";
import { cardRuns, positiveInteger, strategyRuns, type Selection } from "./strategy-runner.ts";

const runBatch = { cards: cardRuns, strategies: strategyRuns };
type Mode = keyof typeof runBatch;
type Batch<M extends Mode> = ReturnType<(typeof runBatch)[M]>;
const seedJobKind = "cnc:strategy-seed-batch";

interface SeedJob {
  kind: typeof seedJobKind;
  mode: Mode;
  selection: Selection;
}

export function selectWorkers(seeds: number, raw?: string): number {
  const requested = raw === undefined ? (seeds < 4 ? 1 : availableParallelism()) : positiveInteger(raw, "WORKERS");
  return Math.min(seeds, requested);
}

export async function runParallel<M extends Mode>(mode: M, selection: Selection, workers: number): Promise<Batch<M>[]> {
  const threads: Worker[] = [];
  const { seeds } = selection;
  try {
    // Promise.all preserves the order of the contiguous blocks, regardless of completion order.
    return await Promise.all(Array.from({ length: workers }, (_, i) => new Promise<Batch<M>>((resolve, reject) => {
      const first = Math.floor(i * seeds.length / workers);
      const end = Math.floor((i + 1) * seeds.length / workers);
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { kind: seedJobKind, mode, selection: { ...selection, seeds: seeds.slice(first, end) } } satisfies SeedJob,
      });
      threads.push(worker);
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(`Seed worker exited without a result (code ${code})`)));
    })));
  } catch (error) {
    await Promise.allSettled(threads.map((worker) => worker.terminate()));
    throw error;
  }
}

const job = workerData as SeedJob | null | undefined;
if (parentPort && job?.kind === seedJobKind) {
  parentPort.postMessage(runBatch[job.mode](job.selection));
}
