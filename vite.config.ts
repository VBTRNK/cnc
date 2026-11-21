/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { checkPublicEnv, localCloudAllowed } from "./scripts/public-env.ts";

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
const connectSrc =
  (productionHeaders["Content-Security-Policy"] ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([name]) => name === "connect-src")
    ?.slice(1) ?? [];

export default defineConfig(({ mode, command, isPreview }) => {
  // Refuses a secret key or an unreachable origin before it can ship in the bundle. A
  // local cloud (a test server on loopback) only for the dev server or when asked for.
  checkPublicEnv(loadEnv(mode, process.cwd(), "VITE_"), connectSrc, {
    allowLocal: localCloudAllowed({ command, isPreview }, process.env.CNC_LOCAL_CLOUD),
  });
  return {
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
  };
});
