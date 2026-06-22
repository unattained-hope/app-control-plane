import type { Config } from "@react-router/dev/config";

export default {
  // Persistent Node server (cp-platform-infrastructure AC9.1) — SSR on, not SPA.
  ssr: true,
} satisfies Config;
