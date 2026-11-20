import { TEST12 } from "../sim/goods12.ts";
import { GOODS } from "../sim/index.ts";
import { TEST12_NAMES } from "./goods12.ts";
import { GAME_GOOD_NAMES, goodName } from "./text.ts";

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
  it.each(Object.entries(GAME_GOOD_NAMES).map(([id, n]) => [id, n.name]))("the game's %s (%s) keeps to the rule", (_, name) => {
    expect(problems(name)).toEqual([]);
  });

  it.each(Object.entries(TEST12_NAMES).map(([id, n]) => [id, n.name]))("the test catalogue's %s (%s) keeps to the rule", (_, name) => {
    expect(problems(name)).toEqual([]);
  });

  it("names every good of both catalogues, each name once", () => {
    expect(Object.keys(TEST12_NAMES).sort()).toEqual(TEST12.map((g) => g.id).sort());
    const all = [...Object.values(GAME_GOOD_NAMES), ...Object.values(TEST12_NAMES)].map((n) => n.name);
    expect(new Set(all).size).toBe(all.length);
    expect(GOODS.map(goodName)).toEqual(GOODS.map((g) => GAME_GOOD_NAMES[g].name));
  });

  it("catches a name that breaks the rule", () => {
    expect(problems("Unlimited limited-edition trainers")).toEqual(["34 characters"]);
    expect(problems("Antiquities")).toEqual([]);
    expect(problems("Grandad's antiquities")).toEqual(["21 characters"]);
    expect(problems("Superconductors")).toEqual(['"Superconductors" has 15']);
  });
});
