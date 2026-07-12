import type { Server as NodeHttpServer } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

/** One Socket.IO gateway per dev HTTP server (configureServer can fire more than once). */
const attached = new WeakSet<object>();

async function attachOnce(server: ViteDevServer): Promise<void> {
  const httpServer = server.httpServer;
  if (!httpServer || attached.has(httpServer)) return;

  const mod = (await server.ssrLoadModule(
    "/app/server/realtime/chatGateway.ts",
  )) as { attachChatGateway: (http: NodeHttpServer) => unknown };

  if (attached.has(httpServer)) return;
  // Vite types httpServer as HTTP/1 | HTTP/2; Socket.IO only runs on the HTTP/1 dev server.
  mod.attachChatGateway(httpServer as NodeHttpServer);
  attached.add(httpServer);
  // eslint-disable-next-line no-console
  console.log("[apoaap] Socket.IO chat gateway attached (dev)");
}

/**
 * Attaches the Socket.IO chat gateway to the Vite dev server's HTTP server so
 * realtime chat works under `npm run dev` / `./scripts/dev-up.sh` — the same
 * transport production wires in `server/start.js`.
 */
export function chatGatewayPlugin(): Plugin {
  return {
    name: "apoaap-chat-gateway",
    configureServer(server) {
      void attachOnce(server).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[apoaap] Failed to attach chat gateway:", err);
      });
    },
  };
}
