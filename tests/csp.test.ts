import { readFileSync } from "node:fs";

// Guards the invariant in AGENTS.md: the CSP stays as strict as the app
// allows, loosened per origin and never with a wildcard.
type VercelConfig = {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as VercelConfig;
const csp = vercel.headers
  .flatMap((rule) => rule.headers)
  .find((h) => h.key === "Content-Security-Policy")?.value;

const directives = new Map(
  (csp ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((parts) => parts[0])
    .map(([name, ...sources]) => [name as string, sources]),
);

describe("Content-Security-Policy", () => {
  it("is set", () => {
    expect(csp).toBeDefined();
  });

  it("loads scripts and styles from this origin only", () => {
    expect(directives.get("script-src")).toEqual(["'self'"]);
    expect(directives.get("style-src")).toEqual(["'self'"]);
  });

  it("keeps the scaffold's other restrictions", () => {
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("has no unsafe keyword and no wildcard", () => {
    for (const sources of directives.values()) {
      for (const source of sources) {
        expect(source).not.toMatch(/^'unsafe-/);
        expect(source).not.toContain("*");
      }
    }
  });
});
