import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { chatGatewayPlugin } from "./vite-plugin-chat-gateway";

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths(), chatGatewayPlugin()],
  // Dedupe React so the app and react-router share ONE React instance — otherwise
  // a second copy makes useContext null ("Application Error" in Scripts).
  resolve: {
    dedupe: ["react", "react-dom", "react-router"],
  },
  // Pre-bundle ALL heavy client deps up front so navigating to a route that first
  // imports Tremor / TanStack / tRPC doesn't trigger a mid-session re-optimization
  // (which reloads a second React copy and crashes useContext).
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router",
      "@tremor/react",
      "@tanstack/react-table",
      "@tanstack/react-query",
      "@trpc/client",
      "@trpc/react-query",
      "socket.io-client",
    ],
  },
  // Never bundle Prisma into the SSR graph — a bundled copy goes stale after
  // `prisma generate` until the whole dev process is killed (causes "Unknown argument").
  ssr: {
    external: ["@prisma/client", ".prisma/client"],
  },
});
