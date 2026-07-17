/**
 * Bundle `server/prod.ts` → `build/server/prod.js`.
 *
 * Uses `--packages=external` so node_modules stay as runtime imports.
 * Resolves the `~/` path alias to `app/`. The React Router server build
 * (`build/server/index.js`) is loaded at runtime via an absolute file URL
 * and is not inlined into this bundle.
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "server/prod.ts")],
  outfile: path.join(root, "build/server/prod.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
  alias: {
    "~": path.join(root, "app"),
  },
  // Keep `.js` import specifiers working against `.ts` sources during bundle.
  resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
});

console.log("[build-prod-server] wrote build/server/prod.js");
