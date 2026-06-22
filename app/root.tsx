import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "~/lib/trpc.js";

/**
 * Root shell. Wires the tRPC + React Query providers. The top-bar app selector
 * (cp-app-registry-connector) lives in the layout; in MVP it lists SaleSwitch only.
 */
export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({ links: [httpBatchLink({ url: "/trpc" })] }),
  );

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <Outlet />
          </QueryClientProvider>
        </trpc.Provider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
