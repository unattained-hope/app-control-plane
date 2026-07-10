import { useMemo, useState } from "react";
import { Card, Text, Title, Badge, Button, TextInput } from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

/**
 * Feature-flag admin UI (cp-feature-flags). `flags:manage`-gated (ADMIN) server-side; a
 * non-ADMIN gets FORBIDDEN, surfaced here. Manage the boolean registry: create flags,
 * toggle the default, set a percentage rollout, and set/clear per-shop overrides. Rich
 * targeting is out of scope (roadmap "buy").
 */

type Flag = inferRouterOutputs<AppRouter>["flags"]["list"][number];

export default function FeatureFlags() {
  const listQuery = trpc.flags.list.useQuery(undefined, {
    retry: (failureCount: number, error: { data?: { code?: string } | null }) =>
      error.data?.code === "FORBIDDEN" ? false : failureCount < 1,
  });
  const utils = trpc.useUtils();
  const invalidate = () => utils.flags.list.invalidate();

  const create = trpc.flags.create.useMutation({ onSuccess: invalidate });
  const update = trpc.flags.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.flags.remove.useMutation({ onSuccess: invalidate });
  const setOverride = trpc.flags.setOverride.useMutation({ onSuccess: invalidate });

  const [newKey, setNewKey] = useState("");
  const [ovFlag, setOvFlag] = useState("");
  const [ovShop, setOvShop] = useState("");

  const isForbidden = listQuery.error?.data?.code === "FORBIDDEN";
  const flags: readonly Flag[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  if (isForbidden) {
    return (
      <main className="apoaap-flags p-6" aria-label="Feature flags">
        <Title>Feature flags</Title>
        <Card className="mt-4" role="alert" aria-label="Feature flags access denied">
          <Text className="font-medium">Admin access required</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            This view needs the <code>flags:manage</code> permission.
          </Text>
        </Card>
      </main>
    );
  }

  return (
    <main className="apoaap-flags p-6" aria-label="Feature flags">
      <Title>Feature flags</Title>

      <Card className="mt-4">
        <form
          aria-label="Create flag"
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newKey.trim() || create.isPending) return;
            create.mutate({ key: newKey.trim(), defaultEnabled: false });
            setNewKey("");
          }}
        >
          <div className="flex-1">
            <label htmlFor="flag-key" className="sr-only">
              Flag key
            </label>
            <TextInput
              id="flag-key"
              placeholder="new.flag.key"
              value={newKey}
              onValueChange={setNewKey}
              aria-label="New flag key"
            />
          </div>
          <Button type="submit" disabled={!newKey.trim()} loading={create.isPending}>
            Create flag
          </Button>
        </form>
        {create.isError ? (
          <Text className="mt-2 text-xs text-rose-600" role="alert">
            {create.error.message}
          </Text>
        ) : null}
      </Card>

      <Card className="mt-4">
        <table className="apoaap-audit-table" aria-label="Feature flags">
          <thead>
            <tr>
              <th scope="col" className="apoaap-audit-th">Key</th>
              <th scope="col" className="apoaap-audit-th">Default</th>
              <th scope="col" className="apoaap-audit-th">Rollout %</th>
              <th scope="col" className="apoaap-audit-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr>
                <td colSpan={4} className="apoaap-audit-td-state">
                  <Text role="status">Loading flags…</Text>
                </td>
              </tr>
            ) : flags.length === 0 ? (
              <tr>
                <td colSpan={4} className="apoaap-audit-td-state">
                  <Text role="status">No flags yet.</Text>
                </td>
              </tr>
            ) : (
              flags.map((f) => (
                <tr key={f.id} className="apoaap-audit-tr">
                  <td className="apoaap-audit-td"><code>{f.key}</code></td>
                  <td className="apoaap-audit-td">
                    <Badge color={f.defaultEnabled ? "emerald" : "gray"}>
                      {f.defaultEnabled ? "on" : "off"}
                    </Badge>
                  </td>
                  <td className="apoaap-audit-td">{f.rolloutPercentage ?? "—"}</td>
                  <td className="apoaap-audit-td">
                    <div className="flex gap-2">
                      <Button
                        size="xs"
                        variant="secondary"
                        aria-label={`Toggle default for ${f.key}`}
                        onClick={() =>
                          update.mutate({ key: f.key, defaultEnabled: !f.defaultEnabled })
                        }
                      >
                        Toggle default
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="rose"
                        aria-label={`Delete ${f.key}`}
                        onClick={() => remove.mutate({ key: f.key })}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="mt-4">
        <Title>Per-shop override</Title>
        <form
          aria-label="Set override"
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ovFlag.trim() || !ovShop.trim() || setOverride.isPending) return;
            setOverride.mutate({ flagKey: ovFlag.trim(), shop: ovShop.trim(), enabled: true });
          }}
        >
          <TextInput placeholder="flag.key" value={ovFlag} onValueChange={setOvFlag} aria-label="Override flag key" />
          <TextInput placeholder="shop.myshopify.com" value={ovShop} onValueChange={setOvShop} aria-label="Override shop" />
          <Button type="submit" disabled={!ovFlag.trim() || !ovShop.trim()} loading={setOverride.isPending}>
            Enable for shop
          </Button>
        </form>
      </Card>
    </main>
  );
}
