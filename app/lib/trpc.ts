import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "~/server/trpc/root.js";

/** End-to-end-typed first-party tRPC client (cp stack). */
export const trpc = createTRPCReact<AppRouter>();
