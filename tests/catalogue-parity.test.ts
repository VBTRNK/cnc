import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareCatalogue } from "../scripts/catalogue-parity.ts";

describe("catalogue parity", () => {
  let root: string;
  let source: string;
  let catalogue: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cnc-parity-"));
    source = path.join(root, "source");
    catalogue = path.join(root, "catalogue");
    mkdirSync(source);
    mkdirSync(catalogue);
  });
  afterEach(() => rmSync(root, { recursive: true }));

  it("passes when every migration has a byte-identical catalogue copy", () => {
    writeFileSync(path.join(source, "1_a.sql"), "select 1;\n");
    writeFileSync(path.join(catalogue, "1_a.sql"), "select 1;\n");
    writeFileSync(path.join(catalogue, "2_other_tool.sql"), "select 2;\n");
    writeFileSync(path.join(source, "notes.txt"), "not a migration");
    const r = compareCatalogue(source, catalogue);
    expect(r.problems).toEqual([]);
    expect(r.count).toBe(1);
    expect(r.aggregate).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a migration missing from the catalogue or changed in any byte", () => {
    writeFileSync(path.join(source, "1_a.sql"), "select 1;\n");
    writeFileSync(path.join(source, "2_b.sql"), "select 2;\n");
    writeFileSync(path.join(catalogue, "2_b.sql"), "select 2;\r\n");
    const r = compareCatalogue(source, catalogue);
    expect(r.problems).toEqual([
      "1_a.sql is not in the catalogue. Merge its VBTRNK/supabase PR first.",
      "2_b.sql differs from the catalogue copy. Migrations are copied unchanged.",
    ]);
  });
});
