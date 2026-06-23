import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
  type LinksFunction,
} from "react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "~/lib/trpc.js";
import appStylesHref from "~/styles/app.css?url";

/** Load the single global stylesheet on every page (cp-visual-design). */
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: appStylesHref },
];

/** Document shell (RR7 Layout). Wraps every route, including the error boundary. */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Apoaap Control Plane</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** App root — wires the tRPC + React Query providers around the route tree. */
export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({ links: [httpBatchLink({ url: "/trpc" })] }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

/** Surfaces loader/render errors (e.g. a FORBIDDEN audit page) instead of a blank screen. */
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return (
      <main className="apoaap-error" role="alert">
        <h1>
          {error.status} {error.statusText}
        </h1>
        <p>{typeof error.data === "string" ? error.data : "Request failed."}</p>
      </main>
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return (
    <main className="apoaap-error" role="alert">
      <h1>Something went wrong</h1>
      <p>{message}</p>
    </main>
  );
}
