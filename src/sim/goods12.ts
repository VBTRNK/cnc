// The test catalogue's eight extra goods (see catalogue.ts): plausible tiers so a run stays
// playable, not a balance proposal. The real catalogue and its numbers are #18's.

import type { Good, GoodId, PlaceId } from "./content.ts";

interface TestGood extends Good {
  /** Price factor per place; the lowest is the good's source. */
  factor: Record<PlaceId, number>;
}

// Typed as game goods so the sim's records take them; only this catalogue holds these IDs.
const as = (id: string) => id as GoodId;

export const TEST12: readonly (TestGood & { id: GoodId })[] = [
  { id: as("spirits"), base: 22, rate: 8, heat: 0.4, vol: 0.12, stockAtSource: 30, stockElsewhere: 8, factor: { docks: 0.85, oldtown: 1.0, uptown: 1.18, strip: 1.06 } },
  { id: as("scent"), base: 40, rate: 6, heat: 0.3, vol: 0.12, stockAtSource: 24, stockElsewhere: 6, factor: { docks: 1.0, oldtown: 0.85, uptown: 1.15, strip: 1.12 } },
  { id: as("handbags"), base: 140, rate: 3, heat: 0.6, vol: 0.14, stockAtSource: 10, stockElsewhere: 3, factor: { docks: 1.12, oldtown: 0.85, uptown: 1.06, strip: 1.0 } },
  { id: as("tools"), base: 270, rate: 2, heat: 0.8, vol: 0.14, stockAtSource: 6, stockElsewhere: 2, factor: { docks: 0.85, oldtown: 1.0, uptown: 1.12, strip: 1.06 } },
  { id: as("phones"), base: 240, rate: 2, heat: 1.2, vol: 0.16, stockAtSource: 8, stockElsewhere: 2, factor: { docks: 1.0, oldtown: 1.06, uptown: 1.18, strip: 0.85 } },
  { id: as("trainers"), base: 160, rate: 3, heat: 0.5, vol: 0.16, stockAtSource: 10, stockElsewhere: 3, factor: { docks: 1.06, oldtown: 0.85, uptown: 1.15, strip: 1.0 } },
  { id: as("earbuds"), base: 35, rate: 6, heat: 0.3, vol: 0.12, stockAtSource: 24, stockElsewhere: 6, factor: { docks: 1.12, oldtown: 1.0, uptown: 1.06, strip: 0.85 } },
  { id: as("holocards"), base: 22, rate: 8, heat: 0.2, vol: 0.12, stockAtSource: 30, stockElsewhere: 8, factor: { docks: 1.0, oldtown: 1.06, uptown: 0.85, strip: 1.12 } },
];
