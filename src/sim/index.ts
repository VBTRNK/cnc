// The simulation's public surface. No UI imports anywhere under src/sim.
export * from "./content.ts";
export * from "./state.ts";
export { heatWord, level, police, price, priceHint, riskWord, ringDistance, usualPrice } from "./market.ts";
export * from "./sim.ts";
export * from "./save.ts";
