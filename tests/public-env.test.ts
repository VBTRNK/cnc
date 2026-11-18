import { checkPublicEnv, localCloudAllowed } from "../scripts/public-env.ts";

const ORIGIN = "https://ref.supabase.co";
const jwt = (claims: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const check = (url: string | undefined, key: string | undefined, allowLocal = false) =>
  () => checkPublicEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key }, ["'self'", ORIGIN], { allowLocal });

describe("the Supabase settings built into the bundle", () => {
  it("allows none, a publishable key, or a legacy anon key", () => {
    expect(check(undefined, undefined)).not.toThrow();
    expect(check(ORIGIN, "sb_publishable_abc")).not.toThrow();
    expect(check(`${ORIGIN}/`, jwt({ role: "anon" }))).not.toThrow();
  });

  it("takes a local test server only when the build asks for a local setup", () => {
    for (const url of ["http://localhost:4175", "http://127.0.0.1:54321/"]) {
      expect(check(url, "sb_publishable_abc", true)).not.toThrow();
      expect(check(url, "sb_publishable_abc")).toThrow(/CNC_LOCAL_CLOUD/);
    }
  });

  it("takes only a bare origin, so every call goes where the CSP allows", () => {
    for (const url of [
      `${ORIGIN}/rest`,
      `${ORIGIN}?x=1`,
      `${ORIGIN}/?x=1`,
      `${ORIGIN}#frag`,
      "https://user:pw@ref.supabase.co",
      "https://REF.supabase.co",
      "https://ref.supabase.co:443",
      `${ORIGIN}//`,
    ]) {
      expect(check(url, "sb_publishable_abc"), url).toThrow(/bare origin/);
    }
    expect(check("http://localhost:4175/x", "sb_publishable_abc", true)).toThrow(/bare origin/);
  });

  it("refuses a secret or service-role key without showing it", () => {
    for (const key of ["sb_secret_TOPSECRET", jwt({ role: "service_role", tag: "TOPSECRET" }), "TOPSECRET", "a.b.c"]) {
      expect(check(ORIGIN, key)).toThrow(/publishable key/);
      try {
        check(ORIGIN, key)();
      } catch (e) {
        expect(String(e)).not.toContain("TOPSECRET");
      }
    }
  });

  it("refuses half the settings, and an origin the CSP doesn't allow", () => {
    expect(check(ORIGIN, undefined)).toThrow(/both/);
    expect(check(undefined, "sb_publishable_abc")).toThrow(/both/);
    expect(check("https://other.supabase.co", "sb_publishable_abc")).toThrow(/connect-src/);
    expect(check("not a url", "sb_publishable_abc")).toThrow(/not a URL/);
  });
});

describe("when a local cloud is acceptable (review 3, G3)", () => {
  it("only for the dev server, or with the explicit opt-in", () => {
    expect(localCloudAllowed({ command: "serve" }, undefined)).toBe(true);
    expect(localCloudAllowed({ command: "serve", isPreview: true }, undefined)).toBe(false);
    // `vite build --mode development` is still a build: it needs the opt-in.
    expect(localCloudAllowed({ command: "build" }, undefined)).toBe(false);
    expect(localCloudAllowed({ command: "build" }, "0")).toBe(false);
    expect(localCloudAllowed({ command: "build" }, "1")).toBe(true);
    expect(localCloudAllowed({ command: "serve", isPreview: true }, "1")).toBe(true);
  });
});
