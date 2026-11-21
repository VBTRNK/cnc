import { GOODS } from "../sim/index.ts";
import { GOOD_NAMES, caseLabel, goodName } from "./text.ts";

// The good-names rule (docs/design.md, "Look and feel"): a name fits two lines in City's goods
// column on a 390 px phone. The browser check measures the same on the page.
const MAX_NAME = 20;
const MAX_PART = 12;

const problems = (name: string): string[] => {
  const out: string[] = [];
  if (name.length > MAX_NAME) out.push(`${name.length} characters`);
  for (const part of name.split(/[ -]/)) if (part.length > MAX_PART) out.push(`"${part}" has ${part.length}`);
  return out;
};

describe("good names", () => {
  it.each(Object.entries(GOOD_NAMES).map(([id, n]) => [id, n.name]))("%s (%s) keeps to the rule", (_, name) => {
    expect(problems(name)).toEqual([]);
  });

  it("names every good once, with a tagline and a case label of its own", () => {
    expect(Object.keys(GOOD_NAMES).sort()).toEqual([...GOODS].sort());
    const names = GOODS.map(goodName);
    expect(new Set(names).size).toBe(names.length);
    for (const g of GOODS) expect(GOOD_NAMES[g].tagline.length).toBeGreaterThan(0);
    const labels = GOODS.map((g) => caseLabel("uptown", g));
    expect(new Set(labels).size).toBe(labels.length);
    expect(caseLabel("uptown", "bingo")).toBe("the Uptown Bingo Ball Syndicate");
  });

  it("catches a name that breaks the rule", () => {
    expect(problems("Unlimited limited-edition trainers")).toEqual(["34 characters"]);
    expect(problems("Antiquities")).toEqual([]);
    expect(problems("Grandad's antiquities")).toEqual(["21 characters"]);
    expect(problems("Superconductors")).toEqual(['"Superconductors" has 15']);
  });
});
