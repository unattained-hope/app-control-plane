import { useMemo, useState } from "react";
import { Card, Text, Title, Flex, Badge, Button, TextInput, Textarea } from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

/**
 * Announcements admin UI (cp-announcements-nps). `announcements:manage`-gated (ADMIN)
 * server-side; a non-ADMIN gets FORBIDDEN, surfaced here. Publish an in-app
 * announcement (broadcast over the chat gateway to connected widgets) and review the
 * publish history + the current NPS aggregate.
 */

type Announcement = inferRouterOutputs<AppRouter>["announcements"]["list"][number];

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleString();
}

export default function Announcements() {
  const listQuery = trpc.announcements.list.useQuery(undefined, {
    retry: (failureCount: number, error: { data?: { code?: string } | null }) =>
      error.data?.code === "FORBIDDEN" ? false : failureCount < 1,
  });
  const npsQuery = trpc.announcements.nps.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const publish = trpc.announcements.publish.useMutation({
    onSuccess: () => {
      setTitle("");
      setBody("");
      void utils.announcements.list.invalidate();
    },
  });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const isForbidden = listQuery.error?.data?.code === "FORBIDDEN";
  const rows: readonly Announcement[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  if (isForbidden) {
    return (
      <main className="apoaap-announcements p-6" aria-label="Announcements">
        <Title>Announcements</Title>
        <Card className="mt-4" role="alert" aria-label="Announcements access denied">
          <Text className="font-medium">Admin access required</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            This view needs the <code>announcements:manage</code> permission.
          </Text>
        </Card>
      </main>
    );
  }

  return (
    <main className="apoaap-announcements p-6" aria-label="Announcements">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Announcements</Title>
        {npsQuery.data != null ? (
          <Badge color="blue" aria-label={`NPS ${npsQuery.data}`}>
            NPS {npsQuery.data}
          </Badge>
        ) : null}
      </Flex>

      <Card>
        <form
          aria-label="Publish announcement"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !body.trim() || publish.isPending) return;
            publish.mutate({ title: title.trim(), body: body.trim(), audience: "ALL" });
          }}
        >
          <label htmlFor="ann-title" className="sr-only">Title</label>
          <TextInput id="ann-title" placeholder="Title" value={title} onValueChange={setTitle} aria-label="Announcement title" />
          <label htmlFor="ann-body" className="mt-2 sr-only">Body</label>
          <Textarea id="ann-body" className="mt-2" placeholder="What's new…" value={body} onValueChange={setBody} rows={3} aria-label="Announcement body" />
          <Button type="submit" className="mt-2" disabled={!title.trim() || !body.trim()} loading={publish.isPending}>
            Publish to all merchants
          </Button>
          {publish.isError ? (
            <Text className="mt-2 text-xs text-rose-600" role="alert">
              {publish.error.message}
            </Text>
          ) : null}
        </form>
      </Card>

      <Card className="mt-4">
        <Title>History</Title>
        {listQuery.isLoading ? (
          <Text className="mt-2" role="status">Loading…</Text>
        ) : rows.length === 0 ? (
          <Text className="mt-2 text-tremor-content-subtle">No announcements yet.</Text>
        ) : (
          <table className="apoaap-audit-table mt-2" aria-label="Announcement history">
            <thead>
              <tr>
                <th scope="col" className="apoaap-audit-th">Title</th>
                <th scope="col" className="apoaap-audit-th">Audience</th>
                <th scope="col" className="apoaap-audit-th">Published</th>
                <th scope="col" className="apoaap-audit-th">Expires</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="apoaap-audit-tr">
                  <td className="apoaap-audit-td">{a.title}</td>
                  <td className="apoaap-audit-td">
                    <Badge>{a.audience}</Badge>
                  </td>
                  <td className="apoaap-audit-td">{formatTimestamp(a.publishedAt)}</td>
                  <td className="apoaap-audit-td">{formatTimestamp(a.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
