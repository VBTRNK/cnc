import { configuredCloud, type CloudApi } from "./cloud.ts";

// The two REST calls: what they send, and how replies and failures are read.

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function cloudWith(reply: (sent: Sent) => Response | Promise<Response>, key = "sb_publishable_test") {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const s = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    sent.push(s);
    return reply(s);
  }) as unknown as typeof fetch;
  const cloud = configuredCloud({ url: "https://ref.supabase.co", key }, fetcher) as CloudApi;
  return { cloud, sent };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const AT = "2026-11-18T12:00:00.123456+00:00";
const SAVE = JSON.stringify({ format: "crime-and-crown-save", version: 2, state: {} });

describe("the cloud API", () => {
  it("is absent without settings", () => {
    expect(configuredCloud({})).toBeNull();
    expect(configuredCloud({ url: "https://ref.supabase.co" })).toBeNull();
  });

  it("calls the cnc functions with the key in `apikey` only, for a new-format key", async () => {
    const { cloud, sent } = cloudWith(() => json(200, null));
    await cloud.fetch("CODE");
    expect(sent[0]!.url).toBe("https://ref.supabase.co/rest/v1/rpc/get_save");
    expect(sent[0]!.headers).toMatchObject({ apikey: "sb_publishable_test", "Content-Profile": "cnc" });
    expect(sent[0]!.headers.Authorization).toBeUndefined();
    expect(sent[0]!.body).toEqual({ p_code: "CODE" });
  });

  it("also sends a legacy key as the bearer token", async () => {
    const { cloud, sent } = cloudWith(() => json(200, null), "eyJhbGciOi.legacy.key");
    await cloud.fetch("CODE");
    expect(sent[0]!.headers.Authorization).toBe("Bearer eyJhbGciOi.legacy.key");
  });

  it("reads a save, or none", async () => {
    const row = { revision: 3, upload_id: "u", save: { a: 1 }, format_version: 2, updated_at: AT };
    expect(await cloudWith(() => json(200, row)).cloud.fetch("C")).toEqual({
      ok: true,
      row: { revision: 3, uploadId: "u", text: '{"a":1}', formatVersion: 2, updatedAt: AT },
    });
    expect(await cloudWith(() => json(200, null)).cloud.fetch("C")).toEqual({ ok: true, row: null });
    expect(await cloudWith(() => Promise.reject(new TypeError("offline"))).cloud.fetch("C")).toEqual({
      ok: false,
      reason: "network",
    });
  });

  it("takes only a decoded JSON null as no save, and only a whole row as a save", async () => {
    const broken = () => new Response("", { status: 200 });
    const html = () => new Response("<html>gateway</html>", { status: 200 });
    for (const reply of [broken, html, () => json(200, { revision: 1 }), () => json(200, [1]), () => json(200, "x")]) {
      expect(await cloudWith(reply).cloud.fetch("C")).toEqual({ ok: false, reason: "network" });
    }
    const good = { revision: 1, upload_id: "u", format_version: 2, updated_at: AT, save: {} };
    for (const bad of [
      { save: null },
      { save: [1] },
      { save: "x" },
      { revision: 0 },
      { revision: -2 },
      { revision: 1.5 },
      { revision: 2 ** 53 },
      { revision: "1" },
      { format_version: 0 },
      { upload_id: "" },
      { updated_at: "t" },
      { updated_at: 5 },
    ]) {
      expect(await cloudWith(() => json(200, { ...good, ...bad })).cloud.fetch("C"), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: "network",
      });
    }
    expect(await cloudWith(() => json(200, good)).cloud.fetch("C")).toMatchObject({ ok: true });
  });

  it("takes only a well-formed answer to a write; anything else is unclear", async () => {
    const put = (body: unknown, base: number | null = 1) => cloudWith(() => json(200, body)).cloud.put("C", base, "u", SAVE);
    for (const bad of [
      [1],
      { outcome: "saved", revision: 0, updated_at: AT },
      { outcome: "saved", revision: 1.5, updated_at: AT },
      { outcome: "saved", revision: 2 ** 53, updated_at: AT },
      { outcome: "saved", revision: 4, updated_at: "t" },
      { outcome: "saved", revision: 4 },
      { outcome: "conflict", revision: 0 },
      { outcome: "conflict", revision: "7" },
      { outcome: "conflict" },
      { outcome: "maybe", revision: 4, updated_at: AT },
    ]) {
      expect(await put(bad), JSON.stringify(bad)).toEqual({ ok: false, reason: "unclear" });
    }
    // No save under the code is a conflict for an update, never for a first save.
    expect(await put({ outcome: "conflict", revision: null })).toEqual({ ok: true, outcome: "conflict", revision: null });
    expect(await put({ outcome: "conflict", revision: null }, null)).toEqual({ ok: false, reason: "unclear" });
  });

  it("goes to the origin alone, whatever follows it in the setting", async () => {
    const sent: string[] = [];
    const fetcher = (async (url: string) => {
      sent.push(url);
      return json(200, null);
    }) as unknown as typeof fetch;
    for (const url of ["https://ref.supabase.co/", "https://ref.supabase.co/x?y=1#z"]) {
      await configuredCloud({ url, key: "sb_publishable_x" }, fetcher)!.fetch("C");
    }
    expect(sent).toEqual(["https://ref.supabase.co/rest/v1/rpc/get_save", "https://ref.supabase.co/rest/v1/rpc/get_save"]);
    expect(configuredCloud({ url: "not a url", key: "sb_publishable_x" })).toBeNull();
  });

  it("gives up on a call that takes too long: a read fails, a write is unclear", async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const cloud = configuredCloud({ url: "https://ref.supabase.co", key: "sb_publishable_x" }, hang as unknown as typeof fetch, 10)!;
    expect(await cloud.fetch("C")).toEqual({ ok: false, reason: "network" });
    expect(await cloud.put("C", 1, "u", SAVE)).toEqual({ ok: false, reason: "unclear" });
  });

  it("also gives up on a reply whose body stalls after the headers", async () => {
    const stalled = async () => new Response(new ReadableStream({ start() {} }), { status: 200 });
    const cloud = configuredCloud({ url: "https://ref.supabase.co", key: "sb_publishable_x" }, stalled as unknown as typeof fetch, 10)!;
    expect(await cloud.fetch("C")).toEqual({ ok: false, reason: "network" });
    expect(await cloud.put("C", 1, "u", SAVE)).toEqual({ ok: false, reason: "unclear" });
  });

  it("treats a broken reply to a write as unclear, never as refused", async () => {
    const put = (reply: () => Response) => cloudWith(reply).cloud.put("C", 1, "u", SAVE);
    expect(await put(() => new Response("", { status: 200 }))).toEqual({ ok: false, reason: "unclear" });
    expect(await put(() => new Response("bad gateway", { status: 400 }))).toEqual({ ok: false, reason: "unclear" });
  });

  it("sends a save as JSON with its base and upload id", async () => {
    const { cloud, sent } = cloudWith(() => json(200, { outcome: "saved", revision: 4, updated_at: AT }));
    expect(await cloud.put("C", 3, "u", SAVE)).toEqual({ ok: true, outcome: "saved", revision: 4, updatedAt: AT });
    expect(sent[0]!.url).toMatch(/\/rpc\/put_save$/);
    expect(sent[0]!.body).toEqual({ p_code: "C", p_base: 3, p_upload: "u", p_save: JSON.parse(SAVE) });
  });

  it("tells a refusal from a write that may have landed", async () => {
    const put = (reply: () => Response | Promise<Response>) => cloudWith(reply).cloud.put("C", null, "u", SAVE);
    expect(await put(() => json(200, { outcome: "conflict", revision: 7 }))).toEqual({
      ok: true,
      outcome: "conflict",
      revision: 7,
    });
    expect(await put(() => json(400, { code: "22023", message: "save too big" }))).toEqual({ ok: false, reason: "refused" });
    expect(await put(() => json(400, { code: "22023", hint: "busy" }))).toEqual({ ok: false, reason: "busy" });
    expect(await put(() => json(500, { code: "XX000" }))).toEqual({ ok: false, reason: "unclear" });
    expect(await put(() => json(504, null))).toEqual({ ok: false, reason: "unclear" });
    expect(await put(() => Promise.reject(new TypeError("offline")))).toEqual({ ok: false, reason: "unclear" });
  });
});
