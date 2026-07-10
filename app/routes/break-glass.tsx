import { useState } from "react";
import { Card, Text, Title, Flex, Badge, Button } from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

/**
 * Break-glass / justified-access console (cp-break-glass-rbac). Any authed user can
 * request a time-boxed grant (a typed reason is required); ADMINs approve/deny pending
 * (sensitive) requests and revoke active ones. Non-sensitive scopes self-activate.
 */

type Grant = inferRouterOutputs<AppRouter>["breakGlass"]["list"][number];

function statusColor(status: Grant["status"]): "emerald" | "amber" | "red" | "gray" {
  if (status === "ACTIVE") return "emerald";
  if (status === "REQUESTED") return "amber";
  if (status === "DENIED" || status === "REVOKED") return "red";
  return "gray";
}

function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleString();
}

export default function BreakGlass() {
  const [scope, setScope] = useState<Grant["scope"]>("PII_REVEAL");
  const [targetShop, setTargetShop] = useState("");
  const [reason, setReason] = useState("");

  const utils = trpc.useUtils();
  // No-input query: don't auto-retry (FORBIDDEN is a stable per-session outcome,
  // detected at render time below).
  const listQuery = trpc.breakGlass.list.useQuery(undefined, { retry: false });
  const refresh = () => utils.breakGlass.list.invalidate();

  const request = trpc.breakGlass.request.useMutation({
    onSuccess: () => {
      setReason("");
      setTargetShop("");
      void refresh();
    },
  });
  const approve = trpc.breakGlass.approve.useMutation({ onSuccess: refresh });
  const deny = trpc.breakGlass.deny.useMutation({ onSuccess: refresh });
  const revoke = trpc.breakGlass.revoke.useMutation({ onSuccess: refresh });

  const grants: readonly Grant[] = listQuery.data ?? [];
  const canSeeList = listQuery.error?.data?.code !== "FORBIDDEN";

  return (
    <main className="apoaap-break-glass p-6" aria-label="Break-glass access">
      <Title>Break-glass access</Title>
      <Text className="text-xs text-tremor-content-subtle">
        Elevated access is justified (a typed reason) and time-boxed. Sensitive scopes
        need ADMIN approval before they activate.
      </Text>

      <Card className="mt-4">
        <form
          aria-label="Request elevated access"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim() || request.isPending) return;
            request.mutate({
              scope,
              reason: reason.trim(),
              targetShop: targetShop.trim() || undefined,
            });
          }}
        >
          <Flex className="gap-3" alignItems="end">
            <label className="flex-1">
              <Text className="text-xs">Scope</Text>
              <select
                aria-label="Grant scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as Grant["scope"])}
              >
                <option value="PII_REVEAL">PII reveal</option>
                <option value="IMPERSONATION">Impersonation</option>
              </select>
            </label>
            <label className="flex-1">
              <Text className="text-xs">Target shop (optional)</Text>
              <input
                type="text"
                aria-label="Target shop"
                placeholder="shop.myshopify.com"
                value={targetShop}
                onChange={(e) => setTargetShop(e.target.value)}
              />
            </label>
          </Flex>
          <label className="block mt-3">
            <Text className="text-xs">Reason (required)</Text>
            <input
              type="text"
              aria-label="Reason for elevated access"
              placeholder="Why do you need this?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            size="xs"
            className="mt-3"
            disabled={!reason.trim() || request.isPending}
          >
            Request access
          </Button>
          {request.isError ? (
            <Text className="mt-2 text-xs" role="alert">
              {request.error.message}
            </Text>
          ) : null}
        </form>
      </Card>

      <Title className="mt-6 text-base">Grants</Title>
      {!canSeeList ? (
        <Card className="mt-2" role="alert">
          <Text>Listing grants needs the <code>ops:view</code> permission.</Text>
        </Card>
      ) : (
        <Card className="mt-2">
          <table className="apoaap-audit-table" aria-label="Break-glass grants">
            <thead>
              <tr>
                <th scope="col" className="apoaap-audit-th">Scope</th>
                <th scope="col" className="apoaap-audit-th">Actor</th>
                <th scope="col" className="apoaap-audit-th">Target</th>
                <th scope="col" className="apoaap-audit-th">Status</th>
                <th scope="col" className="apoaap-audit-th">Expires</th>
                <th scope="col" className="apoaap-audit-th">Reason</th>
                <th scope="col" className="apoaap-audit-th">Action</th>
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="apoaap-audit-td-state">
                    <Text role="status">No grants.</Text>
                  </td>
                </tr>
              ) : (
                grants.map((g) => (
                  <tr key={g.id} className="apoaap-audit-tr">
                    <td className="apoaap-audit-td">{g.scope}</td>
                    <td className="apoaap-audit-td">{g.actorUserId}</td>
                    <td className="apoaap-audit-td">{g.targetShop ?? "—"}</td>
                    <td className="apoaap-audit-td">
                      <Badge color={statusColor(g.status)}>{g.status}</Badge>
                    </td>
                    <td className="apoaap-audit-td">{formatTimestamp(g.expiresAt)}</td>
                    <td className="apoaap-audit-td" title={g.reason}>{g.reason}</td>
                    <td className="apoaap-audit-td">
                      {g.status === "REQUESTED" ? (
                        <Flex justifyContent="start" className="gap-2">
                          <Button size="xs" onClick={() => approve.mutate({ id: g.id })}>
                            Approve
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => deny.mutate({ id: g.id })}
                          >
                            Deny
                          </Button>
                        </Flex>
                      ) : g.status === "ACTIVE" ? (
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => revoke.mutate({ id: g.id })}
                        >
                          Revoke
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
