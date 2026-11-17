/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

type VercelConfig = {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

// `vite preview` serves the production build under the same headers Vercel
// sends, so the CSP is checked against the real bundle (the dev server injects
// styles at runtime and proves nothing about it).
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as VercelConfig;
const productionHeaders = Object.fromEntries(
  vercel.headers.flatMap((rule) => rule.headers).map((h) => [h.key, h.value]),
);

export default defineConfig({
  plugins: [react()],
  build: {
    // Inlined assets would need `data:` in more CSP directives; keep every
    // script, style and font a same-origin file.
    assetsInlineLimit: 0,
  },
  preview: {
    headers: productionHeaders,
  },
  test: {
    // The simulation is tested headlessly; tests/*.cjs belong to `node --test`.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // Tests use the globals and never import "vitest": on Windows a session
    // started in c:\ (VS Code) loads a second copy of vitest under that
    // casing, and describe() then fails with "reading 'config'".
    globals: true,
  },
});
