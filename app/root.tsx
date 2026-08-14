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
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "~/lib/trpc.js";
import { AppProvider, useAppContext } from "~/lib/appContext.js";
import appStylesHref from "~/styles/app.css?url";
import { THEME_INIT_SCRIPT } from "~/lib/theme.js";

/** Load the single global stylesheet on every page (cp-visual-design). */
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: appStylesHref },
];

/** Document shell (RR7 Layout). Wraps every route, including the error boundary. */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Apoaap Control Plane</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
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

/** tRPC + React Query wired to the active `?app=` search param. */
function TrpcProviders({ children }: { children: React.ReactNode }) {
  const { appKey } = useAppContext();
  const [queryClient] = useState(() => new QueryClient());
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [httpBatchLink({ url: `/trpc?app=${encodeURIComponent(appKey)}` })],
      }),
    [appKey],
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

/** App root — wires the tRPC + React Query providers around the route tree. */
export default function Root() {
  return (
    <AppProvider>
      <TrpcProviders>
        <Outlet />
      </TrpcProviders>
    </AppProvider>
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
