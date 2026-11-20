// Display names for the test catalogue's extra goods (src/sim/goods12.ts), mostly from #18's
// draft list; they keep to the good-names rule like the game's own (goodNames.test.ts).

import type { GoodNames } from "./text.ts";

export const TEST12_NAMES: Record<string, GoodNames> = {
  spirits: { name: "Bathtub spirits", one: "bottle of spirits", other: "bottles of spirits", kind: "spirits", Kind: "Spirits" },
  scent: { name: "Eau de Something", one: "bottle of scent", other: "bottles of scent", kind: "scent", Kind: "Scent" },
  handbags: { name: "Faux-lux handbags", one: "handbag", other: "handbags", kind: "handbags", Kind: "Handbags" },
  tools: { name: "Fell-off-a-van tools", one: "power tool", other: "power tools", kind: "tools", Kind: "Tools" },
  phones: { name: "Hot phones", one: "hot phone", other: "hot phones", kind: "phones", Kind: "Phones" },
  trainers: { name: "Limited trainers", one: "pair of trainers", other: "pairs of trainers", kind: "trainers", Kind: "Trainers" },
  earbuds: { name: "Nearly-buds", one: "pair of nearly-buds", other: "pairs of nearly-buds", kind: "nearly-buds", Kind: "Nearly-buds" },
  holocards: { name: "Shiny cards", one: "shiny card", other: "shiny cards", kind: "shiny cards", Kind: "Shiny cards" },
};
