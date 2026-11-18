import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Revision for the precached offline shell: changes on every commit.
// The build time is included so uncommitted local rebuilds also refresh the cached copies.
const revision = `${spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ?? ""}-${Date.now()}`;

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: [
    { url: "/~offline", revision },
    { url: "/workout", revision },
  ],
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
});
