// What the game needs from the backend (docs/design.md, "Cloud saves"): read and write
// the save kept under a cloud code, through `cnc.get_save` and `cnc.put_save`
// (supabase/migrations/20261118120000_cnc_saves.sql). No accounts and no client
// library: two calls to the shared Supabase project's REST endpoint with the publishable
// key. Sync logic lives in sync.ts and talks only to this interface, so tests supply a fake.

export interface CloudRow {
  revision: number;
  uploadId: string;
  /** The save document's text. */
  text: string;
  formatVersion: number;
  updatedAt: string;
}

export type FetchResult = { ok: true; row: CloudRow | null } | { ok: false; reason: "network" };

export type PutResult =
  | { ok: true; outcome: "saved"; revision: number; updatedAt: string }
  /** Another base is current. `revision` is null when there is no cloud save. */
  | { ok: true; outcome: "conflict"; revision: number | null }
  /**
   * unclear: the write may or may not have landed. refused: it never will, as sent.
   * busy: too many new cloud saves just now; a new code can try again later.
   */
  | { ok: false; reason: "unclear" | "refused" | "busy" };

export interface CloudApi {
  /** The save kept under `code`, if any. */
  fetch(code: string): Promise<FetchResult>;
  put(code: string, base: number | null, uploadId: string, text: string): Promise<PutResult>;
}

/** How long a call may take before it counts as failed (a write: unclear). */
export const CALL_TIMEOUT = 15_000;

type Reply = { ok: true; data: unknown } | { ok: false; status: number; error: { code?: string; hint?: string } };
const NO_REPLY: Reply = { ok: false, status: 0, error: {} };

/** A JSON object that isn't an array. */
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Revisions and format versions are positive integers JavaScript holds exactly. */
const isPositive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** The backend, or null when this build has no Supabase settings (a guest-only build). */
export function configuredCloud(
  env: { url?: string | undefined; key?: string | undefined },
  fetcher: typeof fetch = (...args) => fetch(...args),
  timeout = CALL_TIMEOUT,
): CloudApi | null {
  const { url, key } = env;
  if (!url || !key) return null;
  // The build checks that the setting is a bare origin (scripts/public-env.ts); calls go
  // to that origin whatever else the string holds.
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }

  /**
   * Calls a `cnc` function. Resolves to its decoded JSON reply, or to how it failed: a
   * reply that isn't JSON fails with its status, and no whole reply in time (headers and
   * body) fails with 0.
   */
  const call = async (name: string, args: Record<string, unknown>): Promise<Reply> => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Reply>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve(NO_REPLY);
      }, timeout);
    });
    try {
      return await Promise.race([request(name, args, abort.signal).catch(() => NO_REPLY), late]);
    } finally {
      clearTimeout(timer);
    }
  };

  const request = async (name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Reply> => {
    const res = await fetcher(`${origin}/rest/v1/rpc/${name}`, {
      method: "POST",
      signal,
      headers: {
        apikey: key,
        // A new-format key (sb_publishable_…) is not a JWT and goes only in `apikey`;
        // a legacy anon key is also the bearer token, as supabase-js sends them.
        ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
        "Content-Type": "application/json",
        "Content-Profile": "cnc",
      },
      body: JSON.stringify(args),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch (e) {
      // A reply cut short by the timeout is no reply; one that isn't JSON is broken.
      if (signal.aborted) throw e;
      return { ok: false, status: res.ok ? 502 : res.status, error: {} };
    }
    if (res.ok) return { ok: true, data: body };
    return { ok: false, status: res.status, error: isRecord(body) ? (body as { code?: string; hint?: string }) : {} };
  };

  return {
    async fetch(code) {
      const r = await call("get_save", { p_code: code });
      if (!r.ok) return { ok: false, reason: "network" };
      // Only a decoded JSON null means "no save"; anything else must be a whole row.
      if (r.data === null) return { ok: true, row: null };
      const d = r.data;
      if (
        !isRecord(d) ||
        !isPositive(d.revision) ||
        typeof d.upload_id !== "string" ||
        d.upload_id === "" ||
        !isTime(d.updated_at) ||
        !isPositive(d.format_version) ||
        !isRecord(d.save)
      ) {
        return { ok: false, reason: "network" };
      }
      return {
        ok: true,
        row: {
          revision: d.revision,
          uploadId: d.upload_id,
          text: JSON.stringify(d.save),
          formatVersion: d.format_version,
          updatedAt: d.updated_at,
        },
      };
    },

    async put(code, base, uploadId, text) {
      let save: unknown;
      try {
        save = JSON.parse(text);
      } catch {
        return { ok: false, reason: "refused" };
      }
      const r = await call("put_save", { p_code: code, p_base: base, p_upload: uploadId, p_save: save });
      if (!r.ok) {
        // The database refuses on purpose with 22023; anything else may have landed.
        if (r.status >= 400 && r.status < 500 && r.error.code === "22023") {
          return { ok: false, reason: r.error.hint === "busy" ? "busy" : "refused" };
        }
        return { ok: false, reason: "unclear" };
      }
      // Anything but a well-formed answer is unclear: the write may have landed.
      const d = r.data;
      if (!isRecord(d)) return { ok: false, reason: "unclear" };
      if (d.outcome === "saved" && isPositive(d.revision) && isTime(d.updated_at)) {
        return { ok: true, outcome: "saved", revision: d.revision, updatedAt: d.updated_at };
      }
      // No save under the code (null) is a conflict only for an update; a first save
      // conflicts only with a save that exists.
      if (d.outcome === "conflict" && (d.revision === null ? base !== null : isPositive(d.revision))) {
        return { ok: true, outcome: "conflict", revision: d.revision as number | null };
      }
      return { ok: false, reason: "unclear" };
    },
  };
}
