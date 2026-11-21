import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PINCH, PLACES, loadSave, newGame, step, toSave, type GameState } from "../src/sim/index.ts";
import { play } from "../src/sim/testing.ts";

// The `cnc.saves` migration in an in-process Postgres (PGlite), with the roles Supabase
// provides (`anon`, `authenticated`). Covers the write contract (docs/design.md, "Cloud
// saves") and the access rules: a save is reached only with its code, only the code's
// hash is stored, and nobody touches the table except through the two functions.
//
// PGlite has one connection, so overlapping transactions can't be run here. The write
// is one UPDATE guarded by the base revision (re-checked under the row lock) or an
// INSERT ... ON CONFLICT DO NOTHING, and new codes are admitted under an advisory lock.
// Revisions come from one sequence, so tests compare them rather than expect numbers.

const MIGRATION = readFileSync("supabase/migrations/20261118120000_cnc_saves.sql", "utf8");
const A = "7KQFM2XD9HPAT4WN";
const B = "0123456789ABCDEF";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "10000000-0000-4000-8000-000000000002";
const U3 = "10000000-0000-4000-8000-000000000003";

const save = (day: number, version: unknown = 2) =>
  JSON.stringify({ format: "crime-and-crown-save", version, state: { day } });

interface Put {
  outcome: "saved" | "conflict";
  revision: number | null;
  updated_at: string | null;
}
interface Got {
  revision: number;
  upload_id: string;
  save: { state: { day: number } };
  format_version: number;
  updated_at: string;
}

let db: PGlite;

/** Runs `sql` as the browser does (role anon), then returns to the superuser. */
async function asBrowser<T>(sql: string, params: unknown[] = [], role = "anon"): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

const put = async (code: string, base: number | null, upload: string, text: string): Promise<Put> => {
  const [row] = await asBrowser<{ r: Put }>("select cnc.put_save($1, $2, $3, $4::jsonb) as r", [code, base, upload, text]);
  return row!.r;
};
const get = async (code: string): Promise<Got | null> => {
  const [row] = await asBrowser<{ r: Got | null }>("select cnc.get_save($1) as r", [code]);
  return row!.r;
};
/** A deliberate refusal: SQLSTATE 22023 with this message. */
const refused = (p: Promise<unknown>, message: RegExp) => expect(p).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(message) });
const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied/);
const rows = async () => (await db.query<{ n: number }>("select count(*)::int as n from cnc.saves")).rows[0]!.n;
const uuid = (i: number) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;`);
  await db.exec(MIGRATION);
});

beforeEach(async () => {
  await db.exec("delete from cnc.saves");
});

afterAll(async () => {
  await db.close();
});

describe("cnc.put_save and cnc.get_save", () => {
  it("creates the first save, stamped by the server, and reads it back", async () => {
    const r = await put(A, null, U1, save(3));
    expect(r).toMatchObject({ outcome: "saved", revision: expect.any(Number) });
    expect(r.updated_at).not.toBeNull();
    const got = await get(A);
    expect(got).toMatchObject({ revision: r.revision, upload_id: U1, format_version: 2 });
    expect(got!.save.state.day).toBe(3);
  });

  it("reads nothing for a code without a save", async () => {
    await put(A, null, U1, save(3));
    expect(await get(B)).toBeNull();
  });

  it("never lets a first save overwrite an existing one", async () => {
    const first = await put(A, null, U1, save(3));
    expect(await put(A, null, U2, save(1))).toMatchObject({ outcome: "conflict", revision: first.revision });
    expect((await get(A))!.save.state.day).toBe(3);
  });

  it("advances the revision only from the current base", async () => {
    const first = await put(A, null, U1, save(3));
    const second = await put(A, first.revision, U2, save(4));
    expect(second).toMatchObject({ outcome: "saved" });
    expect(second.revision!).toBeGreaterThan(first.revision!);
    // A device still on the first revision is refused and changes nothing.
    expect(await put(A, first.revision, U3, save(9))).toMatchObject({ outcome: "conflict", revision: second.revision });
    const got = await get(A);
    expect(got).toMatchObject({ revision: second.revision, upload_id: U2 });
    expect(got!.save.state.day).toBe(4);
  });

  it("answers a retry of an accepted upload with the same revision, changing nothing", async () => {
    const first = await put(A, null, U1, save(3));
    expect(await put(A, null, U1, save(3))).toEqual(first);
    const second = await put(A, first.revision, U2, save(4));
    expect(await put(A, first.revision, U2, save(4))).toEqual(second);
    expect(await get(A)).toMatchObject({ revision: second.revision, upload_id: U2, updated_at: second.updated_at });
    // An older upload, after a newer one landed, is a conflict.
    expect(await put(A, null, U1, save(3))).toMatchObject({ outcome: "conflict", revision: second.revision });
  });

  it("refuses an upload id reused for another save or another base, and never advances on it", async () => {
    const first = await put(A, null, U1, save(3));
    await refused(put(A, null, U1, save(8)), /upload id reused/);
    await refused(put(A, first.revision, U1, save(3)), /upload id reused/);
    const second = await put(A, first.revision, U2, save(4));
    await refused(put(A, first.revision, U2, save(8)), /upload id reused/);
    // Same id and save, but sent from another base: not the accepted upload.
    await refused(put(A, second.revision, U2, save(4)), /upload id reused/);
    await refused(put(A, null, U2, save(4)), /upload id reused/);
    expect(await get(A)).toMatchObject({ revision: second.revision, save: { state: { day: 4 } } });
  });

  it("never reuses a revision, so a base from a deleted save can't match one made again", async () => {
    const first = await put(A, null, U1, save(3));
    await db.exec("delete from cnc.saves");
    const again = await put(A, null, U2, save(5));
    expect(again).toMatchObject({ outcome: "saved" });
    expect(again.revision).not.toBe(first.revision);
    // A device that last saw the deleted save is refused, and its retry isn't taken as saved.
    expect(await put(A, first.revision, U3, save(9))).toMatchObject({ outcome: "conflict", revision: again.revision });
    expect(await put(A, null, U1, save(3))).toMatchObject({ outcome: "conflict", revision: again.revision });
    expect((await get(A))!.save.state.day).toBe(5);
  });

  it("reports a conflict with no revision when a base is given but there is no save", async () => {
    expect(await put(A, 4, U1, save(3))).toMatchObject({ outcome: "conflict", revision: null });
    expect(await get(A)).toBeNull();
  });

  it("keeps saves under different codes apart", async () => {
    const a = await put(A, null, U1, save(3));
    expect(await put(B, a.revision, U2, save(9))).toMatchObject({ outcome: "conflict", revision: null });
    expect(await put(B, null, U2, save(9))).toMatchObject({ outcome: "saved" });
    expect((await get(A))!.save.state.day).toBe(3);
    expect((await get(B))!.save.state.day).toBe(9);
  });

  it("refuses a malformed code, what isn't a save, a bad version, and a save over the size cap", async () => {
    for (const code of ["", "7kqfm2xd9hpat4wn", "7KQF-M2XD-9HPA-T4WN", "OOOOOOOOOOOOOOOO", "7KQFM2XD9HPAT4W"]) {
      await refused(put(code, null, U1, save(1)), /not a cloud code/);
      await refused(get(code), /not a cloud code/);
    }
    await refused(put(A, null, U1, JSON.stringify({ hello: 1 })), /not a Crime & Crown save/);
    await refused(put(A, null, U1, JSON.stringify([1])), /not a Crime & Crown save/);
    for (const version of [0, -1, 1.5, 1e12, "2"]) {
      await refused(put(A, null, U1, save(1, version)), /not a Crime & Crown save/);
    }
    const big = JSON.stringify({ format: "crime-and-crown-save", version: 2, state: { pad: "x".repeat(70_000) } });
    await refused(put(A, null, U1, big), /save too big/);
    expect(await rows()).toBe(0);
  });
});

/**
 * A capacity fixture for the largest save play makes (CS4): a full news log of 30 papers, 100 past cases kept,
 * every dealt price remembered, and a stop waiting for the player's choice. It must validate,
 * and fit `cnc.put_save`'s cap of 65,536 bytes of `jsonb::text` with 15% to spare (49,277 bytes at 2026-11-21).
 */
function worstCase(): GameState {
  let s = newGame(3, "worst-case");
  for (let day = 1; day <= 40; day++) s = play(s, { type: "callItADay" }, { type: "startDay" }).state;
  s.upgrades = ["coat", "phone"];
  s.cash = 1_000_000;
  s = play(s, { type: "ringRound" }).state;
  s.milestones.cases = Array.from({ length: PINCH.casesKept }, (_, i) => ({
    n: i + 1,
    place: PLACES[i % PLACES.length]!,
    habit: "bingo",
    outcome: i % 2 ? "closed" : "cold",
    day: i + 1,
  }));
  s.milestones.older = { closed: 999, cold: 999 };
  // Every kept paper as full as play makes it: a best sale, an open case and one of Pinch's
  // items each night (a case is announced or closes; firsts happen once, so none here).
  for (const paper of s.news) {
    const open = { n: paper.day, place: "uptown" as const, habit: "bingo" as const, announced: paper.day, places: ["uptown", "strip"] as ("uptown" | "strip")[], caught: false };
    paper.log = { ...paper.log, sold: 40, proceeds: 4000, bought: 40, spent: 3000, stops: 2, seized: 3, fine: 500, best: { good: "bingo", units: 2, proceeds: 1000, place: "uptown" } };
    paper.pinch =
      paper.day % 2
        ? [{ kind: "announced", case: open }]
        : [{ kind: "closed", case: { n: paper.day, place: "strip", habit: "ebikes", outcome: "closed", day: paper.day } }];
    paper.case = open;
  }
  s.held = { ...s.held, smokes: 10, bingo: 10, ebikes: 15 };
  s.pending = {
    kind: "stop",
    quote: { type: "job", hours: 4, stopChance: 0.1, success: 60, pay: [175, 325], legIt: 50 },
    bribe: 1234,
    bribeOdds: 80,
    bribeRefusal: null,
  };
  return s;
}

describe("the largest save", () => {
  it("validates and round-trips through cnc.put_save, with 15% to spare under the cap", async () => {
    const s = worstCase();
    expect(s.news.length).toBe(30);
    const text = toSave(s);
    expect(loadSave(text)).toMatchObject({ ok: true });
    expect(await put(A, null, U1, text)).toMatchObject({ outcome: "saved" });
    const [row] = (await db.query<{ n: number }>("select octet_length(save::text)::int as n from cnc.saves")).rows;
    expect(row!.n, `${row!.n} bytes`).toBeLessThan(0.85 * 65_536);
    expect(loadSave(JSON.stringify((await get(A))!.save))).toMatchObject({ ok: true, state: s });
    expect(step(s, { type: "resolveStop", choice: "handOver" }).ok).toBe(true);
  });
});

describe("the caps on new codes", () => {
  const busy = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "22023", hint: "busy" });

  it("creates every save on one path, after the lock and the caps", () => {
    // Overlapping transactions can't run here, so this checks the shape that makes the
    // caps hold while other calls (or deletions) run: one insert, behind both.
    const body = MIGRATION.slice(MIGRATION.indexOf("create function cnc.put_save"));
    const inserts = [...body.matchAll(/insert into cnc\.saves/g)].map((m) => m.index!);
    expect(inserts).toHaveLength(1);
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(inserts[0]!);
    expect(body.indexOf("too many new cloud saves")).toBeLessThan(inserts[0]!);
    expect(body).not.toMatch(/on conflict/);
  });

  it("admits 60 an hour, while existing saves keep updating", async () => {
    const codes = Array.from({ length: 60 }, (_, i) => `A${String(i).padStart(15, "0")}`);
    const firsts = [];
    for (const [i, code] of codes.entries()) firsts.push(await put(code, null, uuid(i), save(1)));
    await busy(put(B, null, U2, save(1)));
    expect(await put(codes[0]!, firsts[0]!.revision, U3, save(2))).toMatchObject({ outcome: "saved" });
    // An hour later there is room again.
    await db.exec("update cnc.saves set created_at = now() - interval '2 hours'");
    expect(await put(B, null, U2, save(1))).toMatchObject({ outcome: "saved" });
  });

  it("admits 2000 in all, while existing saves keep updating", async () => {
    await db.exec(`insert into cnc.saves (code_hash, revision, format_version, upload_id, save, created_at)
      select sha256(convert_to('X' || lpad(i::text, 15, '0'), 'UTF8')), 1, 2, gen_random_uuid(), '{}'::jsonb,
             now() - interval '1 day'
      from generate_series(1, 1999) as i`);
    const first = await put(A, null, U1, save(1));
    expect(first).toMatchObject({ outcome: "saved" });
    await busy(put(B, null, U2, save(1)));
    const second = await put(A, first.revision, U3, save(2));
    expect(second).toMatchObject({ outcome: "saved" });
    // A retry of an existing code's first save is not a new code.
    expect(await put(A, null, U1, save(1))).toMatchObject({ outcome: "conflict", revision: second.revision });
  });
});

describe("access", () => {
  beforeEach(async () => {
    await put(A, null, U1, save(3));
  });

  it("stores the code's SHA-256, not the code", async () => {
    const [row] = (await db.query<{ hash: Uint8Array; dump: string }>(
      "select code_hash as hash, row_to_json(s)::text as dump from cnc.saves s",
    )).rows;
    expect(Buffer.from(row!.hash).toString("hex")).toBe(createHash("sha256").update(A).digest("hex"));
    expect(row!.dump).not.toContain(A);
  });

  it("has row-level security on, and no table privilege for a client role", async () => {
    const [rls] = (await db.query<{ on: boolean }>("select relrowsecurity as on from pg_class where oid = 'cnc.saves'::regclass")).rows;
    expect(rls!.on).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["select", "insert", "update", "delete"]) {
        const [r] = (await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'cnc.saves', $2) as ok`, [role, priv])).rows;
        expect(r!.ok, `${role} ${priv}`).toBe(false);
      }
    }
  });

  it("lets only anon call the two functions, and nobody call the hash helper", async () => {
    const can = async (role: string, fn: string) =>
      (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0]!.ok;
    expect(await can("anon", "cnc.get_save(text)")).toBe(true);
    expect(await can("anon", "cnc.put_save(text, bigint, uuid, jsonb)")).toBe(true);
    for (const role of ["anon", "authenticated"]) expect(await can(role, "cnc.code_hash(text)")).toBe(false);
    expect(await can("authenticated", "cnc.get_save(text)")).toBe(false);
    expect(await can("authenticated", "cnc.put_save(text, bigint, uuid, jsonb)")).toBe(false);
  });

  it("gives the browser no direct read or write", async () => {
    for (const role of ["anon", "authenticated"]) {
      await denied(asBrowser("select * from cnc.saves", [], role));
      await denied(asBrowser("update cnc.saves set revision = 99", [], role));
      await denied(asBrowser("delete from cnc.saves", [], role));
      await denied(asBrowser("select cnc.code_hash($1)", [A], role));
    }
    expect((await get(A))!.upload_id).toBe(U1);
  });
});
