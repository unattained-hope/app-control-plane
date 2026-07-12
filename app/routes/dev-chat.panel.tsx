import { useMemo, useState } from "react";
import { useSearchParams, type LoaderFunctionArgs } from "react-router";
import { getConfig } from "~/lib/config.js";
import { ChatWidget } from "~/components/ChatWidget.js";

/**
 * DEV-ONLY floating chat bubble + panel for exercising the merchant widget
 * contract against the local Socket.IO gateway. Not shipped to production.
 */
export function loader({ request }: LoaderFunctionArgs) {
  if (getConfig().NODE_ENV !== "development") {
    throw new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  if (!url.searchParams.get("token")) {
    throw new Response("Missing token — open via /dev-chat", { status: 400 });
  }
  return null;
}

export default function DevChatPanel() {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(true);
  const shop = params.get("shop") ?? "dev-shop.myshopify.com";
  const token = params.get("token") ?? "";
  const backendUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  if (!token) {
    return null;
  }

  return (
    <>
      <div
        style={{
          position: "fixed",
          bottom: "1.25rem",
          right: "1.25rem",
          zIndex: 9999,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {open ? (
          <div
            style={{
              width: "22rem",
              maxHeight: "28rem",
              marginBottom: "0.75rem",
              borderRadius: "0.75rem",
              border: "1px solid #d1d5db",
              background: "#fff",
              boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.75rem 1rem",
                borderBottom: "1px solid #e5e7eb",
                background: "#f9fafb",
              }}
            >
              <div>
                <strong style={{ fontSize: "0.875rem" }}>Support</strong>
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{shop}</div>
              </div>
              <button
                type="button"
                aria-label="Minimize chat"
                onClick={() => setOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "1.25rem",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </header>
            <div style={{ flex: 1, overflow: "auto", padding: "0.75rem" }}>
              <ChatWidget backendUrl={backendUrl} token={token} />
            </div>
          </div>
        ) : null}
        <button
          type="button"
          aria-label={open ? "Close support chat" : "Open support chat"}
          onClick={() => setOpen((v) => !v)}
          style={{
            marginLeft: "auto",
            display: "block",
            width: "3.5rem",
            height: "3.5rem",
            borderRadius: "9999px",
            border: "none",
            background: "#2563eb",
            color: "#fff",
            fontSize: "1.5rem",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(37,99,235,0.35)",
          }}
        >
          {open ? "↓" : "💬"}
        </button>
      </div>
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h1>Dev chat harness</h1>
        <p style={{ color: "#4b5563", maxWidth: "40rem" }}>
          This page simulates the merchant-side floating chat bubble. Messages go to the
          control-plane inbox for <code>{shop}</code>. Open{" "}
          <a href="/dev-login?role=SUPPORT&to=/inbox">/inbox</a> in another tab to reply.
        </p>
      </main>
    </>
  );
}
