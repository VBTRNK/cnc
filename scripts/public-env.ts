// Checks the Supabase settings Vite builds into the browser bundle (ADR-009). Everything
// under VITE_ ships to every player, so only a publishable key (sb_publishable_…) or a
// legacy anon JWT may be there, never a secret or service-role key. The URL must be a bare
// origin that the Content-Security-Policy lets the page reach; a local test server
// (http://localhost or 127.0.0.1) only when the build asks for one explicitly. Errors
// name the setting, never its value.

export interface PublicEnvOptions {
  /** A local test setup: a loopback origin is allowed although connect-src lacks it. */
  allowLocal?: boolean;
}

/**
 * Whether a loopback cloud is acceptable: the dev server (which sends no CSP), or a build
 * run with CNC_LOCAL_CLOUD=1. A build in any mode, and `vite preview`, need the opt-in.
 */
export function localCloudAllowed(vite: { command: "serve" | "build"; isPreview?: boolean | undefined }, optIn: string | undefined): boolean {
  return (vite.command === "serve" && vite.isPreview !== true) || optIn === "1";
}

export function checkPublicEnv(
  env: Record<string, string | undefined>,
  connectSrc: readonly string[],
  options: PublicEnvOptions = {},
): void {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url && !key) return;
  if (!url || !key) throw new Error("Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, or neither.");
  if (!isPublicKey(key)) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key (sb_publishable_...) or a legacy anon key. " +
        "It ships to every browser; never put a secret or service-role key there. (The value is not shown.)",
    );
  }
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error("VITE_SUPABASE_URL is not a URL.");
  }
  // Exactly an origin, optionally with a trailing slash: no credentials, path, query or fragment.
  if (url !== origin && url !== `${origin}/`) {
    throw new Error("VITE_SUPABASE_URL must be a bare origin such as https://<ref>.supabase.co, with nothing after it.");
  }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!connectSrc.includes(origin) && !(local && options.allowLocal)) {
    throw new Error(
      local
        ? "VITE_SUPABASE_URL is a local server: build with CNC_LOCAL_CLOUD=1 for a local test setup."
        : "VITE_SUPABASE_URL's origin is not in connect-src (vercel.json), so the page couldn't reach it.",
    );
  }
}

function isPublicKey(key: string): boolean {
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("sb_")) return false;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown };
    return claims.role === "anon";
  } catch {
    return false;
  }
}
