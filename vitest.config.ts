import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // The control-plane Prisma client is generated to a custom output dir;
      // map the bare specifier so vitest resolves it like tsc + the runtime do.
      ".prisma/control-plane": fileURLToPath(
        new URL("./node_modules/.prisma/control-plane/index.js", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
