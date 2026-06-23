import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "~/server/trpc/root.js";

/**
 * tRPC HTTP endpoint as an RR7 resource route. Both loaders (queries) and actions
 * (mutations) delegate to the tRPC fetch adapter so the client `trpc.*` hooks work
 * against the running RR7 server (dev and prod) without a separate Express entry.
 */
function handle(request: Request) {
  return fetchRequestHandler({
    endpoint: "/trpc",
    req: request,
    router: appRouter,
    createContext: ({ req }) => createContext(req),
  });
}

export function loader({ request }: LoaderFunctionArgs) {
  return handle(request);
}

export function action({ request }: ActionFunctionArgs) {
  return handle(request);
}
