// Catalogue parity (ADR-010, after VBTRNK/kut ADR-144): every migration in this repo
// must exist, byte-identical, in the `VBTRNK/supabase` catalogue, the only place hosted
// migrations are applied from. CI checks out the catalogue's main; locally, pass a
// sibling checkout: `node scripts/catalogue-parity.ts --catalogue ..\supabase`.
// A new migration is red here until its catalogue PR is merged (AGENTS.md "Database").
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

export interface Parity {
  problems: string[];
  count: number;
  /** One hash over every file name and hash, to compare runs at a glance. */
  aggregate: string;
}

/** Compares this repo's migrations with the catalogue's copies. */
export function compareCatalogue(sourceDir: string, catalogueDir: string): Parity {
  const problems: string[] = [];
  const records: string[] = [];
  const names = readdirSync(sourceDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const central = path.join(catalogueDir, name);
    if (!existsSync(central)) {
      problems.push(`${name} is not in the catalogue. Merge its VBTRNK/supabase PR first.`);
      continue;
    }
    const sourceHash = sha256(readFileSync(path.join(sourceDir, name)));
    if (sha256(readFileSync(central)) !== sourceHash) {
      problems.push(`${name} differs from the catalogue copy. Migrations are copied unchanged.`);
      continue;
    }
    records.push(`${name}:${sourceHash}`);
  }
  return { problems, count: names.length, aggregate: sha256(records.join("\n")) };
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const flag = process.argv.indexOf("--catalogue");
  const checkout = flag === -1 ? undefined : process.argv[flag + 1];
  if (!checkout) {
    console.error("Usage: node scripts/catalogue-parity.ts --catalogue <VBTRNK/supabase checkout>");
    process.exit(2);
  }
  const catalogueDir = path.resolve(checkout, "supabase", "migrations");
  if (!existsSync(catalogueDir)) {
    console.error(`No supabase/migrations directory under ${checkout}.`);
    process.exit(2);
  }
  const { problems, count, aggregate } = compareCatalogue(path.join(root, "supabase", "migrations"), catalogueDir);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log(`Catalogue parity passed: ${count} migrations, aggregate sha256 ${aggregate}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
