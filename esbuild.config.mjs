import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("bundle", { recursive: true });

try {
  await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: "bundle/index.js",
    external: [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui"
    ],
    sourcemap: false,
    minify: false
  });
  console.log("✓ Bundle generated at bundle/index.js");
} catch (error) {
  console.error("Build failed:", error);
  process.exit(1);
}
