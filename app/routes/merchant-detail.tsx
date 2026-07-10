import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  Badge,
  Button,
  Card,
  Divider,
  Flex,
  Grid,
  List,
  ListItem,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

type MerchantOverview = NonNullable<inferRouterOutputs<AppRouter>["directory"]["overview"]>;
type ConversationSummary = MerchantOverview["conversations"][number];
type AuditEntry = MerchantOverview["audit"][number];

/**
 * Merchant detail (cp-merchant-directory + cp-billing-read + cp-merchant-actions).
 *
 * Reads the replica-sourced `trpc.directory.detail` (shop info, install/lifecycle,
 * notes, tags, Shopify deep-link, `asOf`) and the live-but-cached
 * `trpc.billing.subscription` (plan/status/price/period, with a graceful
 * "unavailable" note when the value is stale). The route owns no business logic;
 * note/tag writes go through `trpc.actions.addNote` / `trpc.actions.addTag`, each
 * guarded by a type-to-confirm input (the operator must type the exact shop domain
 * before submit is enabled). The not-found (null) case renders an explicit state.
 */

/** Render an ISO timestamp as a stable, locale-aware label (falls back to raw). */
function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

/** Render an ISO timestamp as a date-only label. */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleDateString();
}

function AsOf({ iso }: { readonly iso: string }) {
  return (
    <Text className="text-xs text-tremor-content-subtle">
      as of <time dateTime={iso}>{formatTimestamp(iso)}</time>
    </Text>
  );
}

type SubscriptionStatus = "active" | "trial" | "cancelled" | "none";

const SUBSCRIPTION_TONE: Readonly<
  Record<SubscriptionStatus, "emerald" | "amber" | "rose" | "gray">
> = {
  active: "emerald",
  trial: "amber",
  cancelled: "rose",
  none: "gray",
};

const SUBSCRIPTION_LABEL: Readonly<Record<SubscriptionStatus, string>> = {
  active: "Active",
  trial: "Trial",
  cancelled: "Cancelled",
  none: "No subscription",
};

/**
 * Email cell with an audited reveal (cp-pii-governance). The value arrives masked
 * from the server; revealing it requires a typed reason and writes a
 * `merchant.pii.view` audit row. Only roles with `pii:view` can reveal — others get
 * a FORBIDDEN error surfaced inline. The unmasked value is held in component state
 * only (never re-fetched into the directory).
 */
function RevealableEmail({
  shop,
  masked,
}: {
  readonly shop: string;
  readonly masked: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  const reveal = trpc.actions.revealPii.useMutation({
    onSuccess: (res) => {
      setRevealed(res.value ?? "—");
      setOpen(false);
      setReason("");
    },
  });

  if (revealed !== null) {
    return <Text aria-label="Revealed email">{revealed}</Text>;
  }

  if (!masked) return <Text>—</Text>;

  if (!open) {
    return (
      <div className="flex items-center justify-end gap-2">
        <Text aria-label="Masked email">{masked}</Text>
        <Button size="xs" variant="light" type="button" onClick={() => setOpen(true)}>
          Reveal
        </Button>
      </div>
    );
  }

  return (
    <form
      aria-label="Reveal email"
      className="flex flex-col items-end gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim() || reveal.isPending) return;
        reveal.mutate({ shop, reason: reason.trim() });
      }}
    >
      <TextInput
        placeholder="Reason (audited)"
        value={reason}
        onValueChange={setReason}
        aria-label="Reason for revealing PII"
      />
      <div className="flex gap-2">
        <Button size="xs" type="submit" disabled={!reason.trim() || reveal.isPending}>
          Confirm reveal
        </Button>
        <Button size="xs" variant="light" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {reveal.isError ? (
        <Text className="text-xs text-rose-600" role="alert">
          {reveal.error.message}
        </Text>
      ) : null}
    </form>
  );
}

const HEALTH_TONE: Readonly<Record<string, "emerald" | "amber" | "rose">> = {
  HEALTHY: "emerald",
  AT_RISK: "amber",
  CRITICAL: "rose",
};

const HEALTH_LABEL: Readonly<Record<string, string>> = {
  HEALTHY: "Healthy",
  AT_RISK: "At risk",
  CRITICAL: "Critical",
};

/**
 * Merchant health (cp-merchant-health). Reads the latest pre-aggregated
 * `MerchantHealthSnapshot` for the shop and shows its band + factor breakdown + the
 * `asOf` timestamp (acknowledging snapshot lag). Absent until the growth rollup has
 * scored the shop at least once.
 */
function HealthCard({ shop }: { readonly shop: string }) {
  const health = trpc.health.forShop.useQuery({ shop });

  if (health.isLoading) {
    return (
      <Card aria-label="Merchant health" aria-busy="true">
        <Title>Health</Title>
        <Text className="mt-2" role="status">
          Loading health…
        </Text>
      </Card>
    );
  }

  const row = health.data;
  if (!row) {
    return (
      <Card aria-label="Merchant health">
        <Title>Health</Title>
        <Text className="mt-2 text-tremor-content-subtle">
          Not yet scored — the growth rollup will populate this shortly.
        </Text>
      </Card>
    );
  }

  return (
    <Card aria-label="Merchant health">
      <Flex justifyContent="between" alignItems="start">
        <Title>Health</Title>
        <Badge color={HEALTH_TONE[row.band] ?? "gray"} aria-label={`Health ${HEALTH_LABEL[row.band] ?? row.band}`}>
          {HEALTH_LABEL[row.band] ?? row.band}
        </Badge>
      </Flex>
      <Text className="mt-1 text-xs text-tremor-content-subtle">Risk score {row.score}</Text>

      <Divider className="my-3" />

      {row.factors.length === 0 ? (
        <Text className="text-tremor-content-subtle">No risk factors. 🎉</Text>
      ) : (
        <List aria-label="Health factors">
          {row.factors.map((f) => (
            <ListItem key={f.key}>
              <Text>{f.key}</Text>
              <Text className="text-tremor-content-subtle">+{f.points}</Text>
            </ListItem>
          ))}
        </List>
      )}

      <Divider className="my-3" />
      <AsOf iso={row.asOf} />
    </Card>
  );
}

/** Field-value row used across the info / billing cards. */
function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <Text className="text-tremor-content-subtle">{label}</Text>
      <div className="text-right">{children}</div>
    </div>
  );
}

function ShopInfoCard({
  shop,
  detail,
}: {
  readonly shop: string;
  readonly detail: {
    readonly name: string | null;
    readonly email: string | null;
    readonly status: string;
    readonly lifecycle: string;
    readonly plan: string | null;
    readonly installedAt: string;
    readonly uninstalledAt: string | null;
    readonly shopifyAdminUrl: string;
  };
}) {
  return (
    <Card aria-label="Shop information">
      <Title>{detail.name ?? shop}</Title>
      <Text className="mt-1">{shop}</Text>

      <Divider className="my-3" />

      <DetailRow label="Email">
        <RevealableEmail shop={shop} masked={detail.email} />
      </DetailRow>
      <DetailRow label="Status">
        <Badge aria-label={`Status ${detail.status}`}>{detail.status}</Badge>
      </DetailRow>
      <DetailRow label="Lifecycle">
        <Badge aria-label={`Lifecycle ${detail.lifecycle}`} color="blue">
          {detail.lifecycle}
        </Badge>
      </DetailRow>
      <DetailRow label="Plan">
        <Text>{detail.plan ?? "—"}</Text>
      </DetailRow>
      <DetailRow label="Installed">
        <Text>{formatDate(detail.installedAt)}</Text>
      </DetailRow>
      <DetailRow label="Uninstalled">
        <Text>{detail.uninstalledAt ? formatDate(detail.uninstalledAt) : "—"}</Text>
      </DetailRow>

      <Divider className="my-3" />

      <a
        href={detail.shopifyAdminUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="text-tremor-brand hover:underline"
        aria-label="Open in Shopify admin (new tab)"
      >
        Open in Shopify admin ↗
      </a>
    </Card>
  );
}

function BillingCard({ shop }: { readonly shop: string }) {
  const subscription = trpc.billing.subscription.useQuery({ shop });

  if (subscription.isLoading) {
    return (
      <Card aria-label="Subscription" aria-busy="true">
        <Title>Subscription</Title>
        <Text className="mt-2" role="status">
          Loading subscription…
        </Text>
      </Card>
    );
  }

  if (subscription.isError || !subscription.data) {
    return (
      <Card aria-label="Subscription" role="alert">
        <Title>Subscription</Title>
        <Text className="mt-2 text-tremor-content-subtle">
          Subscription state is currently unavailable.
        </Text>
      </Card>
    );
  }

  const sub = subscription.data;
  const status = sub.status;

  return (
    <Card aria-label="Subscription">
      <Flex justifyContent="between" alignItems="start">
        <Title>Subscription</Title>
        <Badge
          color={SUBSCRIPTION_TONE[status]}
          aria-label={`Subscription status ${SUBSCRIPTION_LABEL[status]}`}
        >
          {SUBSCRIPTION_LABEL[status]}
        </Badge>
      </Flex>

      {sub.stale ? (
        <div
          role="status"
          aria-label="Subscription data is stale"
          className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1"
        >
          <Text className="text-xs text-amber-800">
            Live billing read failed — showing the last known value, which may be
            out of date.
          </Text>
        </div>
      ) : null}

      <Divider className="my-3" />

      <DetailRow label="Plan">
        <Text>{sub.planName ?? "—"}</Text>
      </DetailRow>
      <DetailRow label="Price">
        <Text>
          {sub.price
            ? `${sub.price.amount} ${sub.price.currencyCode}`
            : "—"}
        </Text>
      </DetailRow>
      <DetailRow label="Period start">
        <Text>{formatDate(sub.currentPeriodStart)}</Text>
      </DetailRow>
      <DetailRow label="Period end">
        <Text>{formatDate(sub.currentPeriodEnd)}</Text>
      </DetailRow>
    </Card>
  );
}

function TagsCard({
  shop,
  tags,
  onChanged,
}: {
  readonly shop: string;
  readonly tags: readonly string[];
  readonly onChanged: () => void;
}) {
  const [label, setLabel] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const addTag = trpc.actions.addTag.useMutation({
    onSuccess: () => {
      setLabel("");
      setConfirmText("");
      onChanged();
    },
  });

  const confirmed = confirmText === shop;
  const canSubmit = label.trim().length > 0 && confirmed && !addTag.isPending;

  return (
    <Card aria-label="Tags">
      <Title>Tags</Title>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Current tags">
        {tags.length === 0 ? (
          <Text className="text-tremor-content-subtle">No tags yet.</Text>
        ) : (
          tags.map((tag) => (
            <Badge key={tag} aria-label={`Tag ${tag}`}>
              {tag}
            </Badge>
          ))
        )}
      </div>

      <Divider className="my-3" />

      <form
        aria-label="Add tag"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          addTag.mutate({ shop, label: label.trim(), confirmText });
        }}
      >
        <label htmlFor="add-tag-label" className="sr-only">
          Tag label
        </label>
        <TextInput
          id="add-tag-label"
          placeholder="Tag label"
          value={label}
          onValueChange={setLabel}
          aria-label="Tag label"
        />
        <label htmlFor="add-tag-confirm" className="mt-2 block">
          <Text className="text-xs text-tremor-content-subtle">
            Type <code>{shop}</code> to confirm
          </Text>
        </label>
        <TextInput
          id="add-tag-confirm"
          className="mt-1"
          placeholder={shop}
          value={confirmText}
          onValueChange={setConfirmText}
          aria-label="Type the shop domain to confirm"
          error={confirmText.length > 0 && !confirmed}
          errorMessage={
            confirmText.length > 0 && !confirmed
              ? "Must match the shop domain exactly"
              : undefined
          }
        />
        <Button
          type="submit"
          className="mt-2"
          disabled={!canSubmit}
          loading={addTag.isPending}
        >
          Add tag
        </Button>
        {addTag.isError ? (
          <Text className="mt-2 text-xs text-rose-600" role="alert">
            {addTag.error.message}
          </Text>
        ) : null}
      </form>
    </Card>
  );
}

function NotesCard({
  shop,
  notes,
  onChanged,
}: {
  readonly shop: string;
  readonly notes: readonly {
    readonly id: string;
    readonly authorId: string;
    readonly body: string;
    readonly createdAt: string;
  }[];
  readonly onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const addNote = trpc.actions.addNote.useMutation({
    onSuccess: () => {
      setBody("");
      setConfirmText("");
      onChanged();
    },
  });

  const confirmed = confirmText === shop;
  const canSubmit = body.trim().length > 0 && confirmed && !addNote.isPending;

  return (
    <Card aria-label="Notes">
      <Title>Recent notes</Title>

      {notes.length === 0 ? (
        <Text className="mt-2 text-tremor-content-subtle">No notes yet.</Text>
      ) : (
        <List className="mt-2" aria-label="Recent notes">
          {notes.map((note) => (
            <ListItem key={note.id} className="flex-col items-start">
              <Text className="whitespace-pre-wrap">{note.body}</Text>
              <Text className="text-xs text-tremor-content-subtle">
                {note.authorId} · {formatTimestamp(note.createdAt)}
              </Text>
            </ListItem>
          ))}
        </List>
      )}

      <Divider className="my-3" />

      <form
        aria-label="Add note"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          addNote.mutate({ shop, body: body.trim(), confirmText });
        }}
      >
        <label htmlFor="add-note-body" className="sr-only">
          Note body
        </label>
        <Textarea
          id="add-note-body"
          placeholder="Write a note…"
          value={body}
          onValueChange={setBody}
          rows={3}
          aria-label="Note body"
        />
        <label htmlFor="add-note-confirm" className="mt-2 block">
          <Text className="text-xs text-tremor-content-subtle">
            Type <code>{shop}</code> to confirm
          </Text>
        </label>
        <TextInput
          id="add-note-confirm"
          className="mt-1"
          placeholder={shop}
          value={confirmText}
          onValueChange={setConfirmText}
          aria-label="Type the shop domain to confirm"
          error={confirmText.length > 0 && !confirmed}
          errorMessage={
            confirmText.length > 0 && !confirmed
              ? "Must match the shop domain exactly"
              : undefined
          }
        />
        <Button
          type="submit"
          className="mt-2"
          disabled={!canSubmit}
          loading={addNote.isPending}
        >
          Add note
        </Button>
        {addNote.isError ? (
          <Text className="mt-2 text-xs text-rose-600" role="alert">
            {addNote.error.message}
          </Text>
        ) : null}
      </form>
    </Card>
  );
}

const CONV_STATUS_TONE: Readonly<Record<string, "emerald" | "amber" | "gray">> = {
  OPEN: "emerald",
  SNOOZED: "amber",
  CLOSED: "gray",
};

/** Per-shop conversation history (cp-merchant-360), linking into the inbox. */
function ConversationHistoryCard({
  conversations,
}: {
  readonly conversations: readonly ConversationSummary[];
}) {
  return (
    <Card aria-label="Conversation history">
      <Flex justifyContent="between" alignItems="baseline">
        <Title>Conversations</Title>
        <Link to="/inbox" className="text-xs text-tremor-brand hover:underline">
          Open inbox →
        </Link>
      </Flex>
      {conversations.length === 0 ? (
        <Text className="mt-2 text-tremor-content-subtle">No conversations for this shop.</Text>
      ) : (
        <List className="mt-2" aria-label="Shop conversations">
          {conversations.map((c) => (
            <ListItem key={c.id}>
              <div className="flex flex-col">
                <Flex justifyContent="start" alignItems="center" className="gap-2">
                  <Badge color={CONV_STATUS_TONE[c.status] ?? "gray"}>{c.status}</Badge>
                  {c.priority !== "NONE" ? (
                    <Badge color="blue" aria-label={`Priority ${c.priority}`}>
                      {c.priority}
                    </Badge>
                  ) : null}
                  {c.csatScore != null ? (
                    <Text className="text-xs text-emerald-700">CSAT {c.csatScore}/5</Text>
                  ) : null}
                </Flex>
                <Text className="text-xs text-tremor-content-subtle">
                  Last activity: {formatTimestamp(c.lastMessageAt)}
                </Text>
              </div>
            </ListItem>
          ))}
        </List>
      )}
    </Card>
  );
}

/** Per-shop audit trail (cp-merchant-360), newest first. */
function AuditTrailCard({ audit }: { readonly audit: readonly AuditEntry[] }) {
  return (
    <Card aria-label="Audit trail">
      <Title>Audit trail</Title>
      {audit.length === 0 ? (
        <Text className="mt-2 text-tremor-content-subtle">No audit entries for this shop.</Text>
      ) : (
        <List className="mt-2" aria-label="Shop audit entries">
          {audit.map((a) => (
            <ListItem key={a.id} className="flex-col items-start">
              <Flex justifyContent="between" alignItems="baseline" className="w-full gap-2">
                <code className="text-xs">{a.action}</code>
                <Text className="text-xs text-tremor-content-subtle">
                  <time dateTime={a.createdAt}>{formatTimestamp(a.createdAt)}</time>
                </Text>
              </Flex>
              <Text className="text-xs text-tremor-content-subtle">
                {a.actorEmail ?? a.actorUserId} · {a.source}
              </Text>
            </ListItem>
          ))}
        </List>
      )}
    </Card>
  );
}

export default function MerchantDetail() {
  const params = useParams();
  const shop = params.shop ?? "";

  const detailQuery = trpc.directory.overview.useQuery(
    { shop },
    { enabled: shop.length > 0 },
  );

  if (!shop) {
    return (
      <main className="p-6">
        <Title>Merchant</Title>
        <Card className="mt-4" role="alert" aria-label="Missing shop parameter">
          <Text>No shop was specified.</Text>
        </Card>
      </main>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <main className="p-6" aria-busy="true">
        <Title>{shop}</Title>
        <Text className="mt-2" role="status">
          Loading merchant…
        </Text>
      </main>
    );
  }

  if (detailQuery.isError) {
    return (
      <main className="p-6">
        <Title>{shop}</Title>
        <Card className="mt-4" role="alert" aria-label="Merchant load error">
          <Text>Couldn't load this merchant.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            {detailQuery.error.message}
          </Text>
        </Card>
      </main>
    );
  }

  const detail = detailQuery.data;

  // Not-found: the replica has no such shop (connector returned null).
  if (detail === null || detail === undefined) {
    return (
      <main className="p-6">
        <Flex justifyContent="between" alignItems="baseline" className="mb-4">
          <Title>{shop}</Title>
          <Link to="/merchants" className="text-tremor-brand hover:underline">
            ← Back to merchants
          </Link>
        </Flex>
        <Card role="status" aria-label="Merchant not found">
          <Title>Merchant not found</Title>
          <Text className="mt-2 text-tremor-content-subtle">
            No merchant matching <code>{shop}</code> exists in the replica.
          </Text>
        </Card>
      </main>
    );
  }

  return (
    <main className="p-6" aria-label={`Merchant ${shop}`}>
      <Flex justifyContent="between" alignItems="baseline" className="mb-2">
        <Title>{detail.name ?? shop}</Title>
        <Link to="/merchants" className="text-tremor-brand hover:underline">
          ← Back to merchants
        </Link>
      </Flex>
      <div className="mb-4">
        <AsOf iso={detail.asOf} />
      </div>

      <Grid numItemsLg={2} className="gap-4">
        <ShopInfoCard shop={shop} detail={detail} />
        <HealthCard shop={shop} />
        <BillingCard shop={shop} />
        <TagsCard
          shop={shop}
          tags={detail.tags}
          onChanged={() => void detailQuery.refetch()}
        />
        <NotesCard
          shop={shop}
          notes={detail.notes}
          onChanged={() => void detailQuery.refetch()}
        />
        <ConversationHistoryCard conversations={detail.conversations} />
        <AuditTrailCard audit={detail.audit} />
      </Grid>
    </main>
  );
}
