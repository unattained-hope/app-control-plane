import { useEffect, useState } from "react";
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
  Metric,
  ProgressBar,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { Ban, Check, Circle, Eye, Flag, Store, Trash2, WandSparkles, X } from "lucide-react";
import { trpc } from "~/lib/trpc.js";
import { StoreAvatar } from "~/components/StoreAvatar.js";
import type { AppRouter } from "~/server/trpc/root.js";

type MerchantOverview = NonNullable<inferRouterOutputs<AppRouter>["directory"]["overview"]>;
type AuditEntry = MerchantOverview["audit"][number];
type ActivityEvent = inferRouterOutputs<AppRouter>["usage"]["activity"]["events"][number];
type CampaignMonitorResult = inferRouterOutputs<AppRouter>["directory"]["campaignMonitor"];
type CampaignMonitor = NonNullable<CampaignMonitorResult["monitor"]>;
type CampaignSummary = CampaignMonitor["active"][number];

type JourneyStep = { readonly event: ActivityEvent; readonly count: number };
type JourneySession = {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly steps: readonly JourneyStep[];
};

const ACTIVITY_SESSION_GAP_MS = 30 * 60 * 1_000;

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
        <Text className="text-xs text-cp-danger" role="alert">
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
      <Card className="p-4 sm:p-5" aria-label="Merchant health" aria-busy="true">
        <Title>Health</Title>
        <Text className="mt-2 text-xs" role="status">
          Loading health…
        </Text>
      </Card>
    );
  }

  const row = health.data;
  if (!row) {
    return (
      <Card className="p-4 sm:p-5" aria-label="Merchant health">
        <Title>Health</Title>
        <Text className="mt-2 text-xs text-tremor-content-subtle">
          Not yet scored — the growth rollup will populate this shortly.
        </Text>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5 flex flex-col justify-between" aria-label="Merchant health">
      <div>
        <Flex justifyContent="between" alignItems="start" className="gap-2">
          <div>
            <Title>Health</Title>
            <Text className="mt-0.5 text-xs text-tremor-content-subtle">Risk score {row.score}</Text>
          </div>
          <Badge
            size="xs"
            color={HEALTH_TONE[row.band] ?? "gray"}
            aria-label={`Health ${HEALTH_LABEL[row.band] ?? row.band}`}
          >
            {HEALTH_LABEL[row.band] ?? row.band}
          </Badge>
        </Flex>

        <Divider className="my-2.5" />

        {row.factors.length === 0 ? (
          <Text className="text-xs text-tremor-content-subtle py-1">No risk factors. 🎉</Text>
        ) : (
          <List aria-label="Health factors" className="divide-y-0">
            {row.factors.map((f) => (
              <ListItem key={f.key} className="py-1">
                <Text className="truncate text-xs">{f.key}</Text>
                <Text className="shrink-0 text-xs text-tremor-content-subtle font-mono">+{f.points}</Text>
              </ListItem>
            ))}
          </List>
        )}
      </div>

      <div>
        <Divider className="my-2.5" />
        <AsOf iso={row.asOf} />
      </div>
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
    <div className="flex items-center justify-between gap-2 py-0.5">
      <Text className="text-xs text-tremor-content-subtle shrink-0">{label}</Text>
      <div className="text-right min-w-0 text-xs">{children}</div>
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
    readonly avatarUrl?: string | null;
  };
}) {
  return (
    <Card className="p-4 sm:p-5 flex flex-col justify-between" aria-label="Shop information">
      <div>
        <div className="flex items-center gap-3">
          <StoreAvatar shop={shop} name={detail.name} avatarUrl={detail.avatarUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <Title className="truncate">{detail.name ?? shop}</Title>
            <Text className="mt-0.5 truncate text-xs text-tremor-content-subtle">{shop}</Text>
          </div>
        </div>

        <Divider className="my-2.5" />

        <div className="space-y-1">
          <DetailRow label="Email">
            <RevealableEmail shop={shop} masked={detail.email} />
          </DetailRow>
          <DetailRow label="Status">
            <Badge size="xs" aria-label={`Status ${detail.status}`}>{detail.status}</Badge>
          </DetailRow>
          <DetailRow label="Lifecycle">
            <Badge size="xs" aria-label={`Lifecycle ${detail.lifecycle}`} color="blue">
              {detail.lifecycle}
            </Badge>
          </DetailRow>
          <DetailRow label="Plan">
            <Text className="text-xs">{detail.plan ?? "—"}</Text>
          </DetailRow>
          <DetailRow label="Installed">
            <Text className="text-xs">{formatDate(detail.installedAt)}</Text>
          </DetailRow>
          <DetailRow label="Uninstalled">
            <Text className="text-xs">{detail.uninstalledAt ? formatDate(detail.uninstalledAt) : "—"}</Text>
          </DetailRow>
        </div>
      </div>

      <div>
        <Divider className="my-2.5" />
        <a
          href={detail.shopifyAdminUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs font-medium text-tremor-brand hover:underline"
          aria-label="Open in Shopify admin (new tab)"
        >
          Open in Shopify admin ↗
        </a>
      </div>
    </Card>
  );
}

function BillingCard({ shop }: { readonly shop: string }) {
  const subscription = trpc.billing.subscription.useQuery({ shop });

  if (subscription.isLoading) {
    return (
      <Card className="p-4 sm:p-5" aria-label="Subscription" aria-busy="true">
        <Title>Subscription</Title>
        <Text className="mt-2 text-xs" role="status">
          Loading subscription…
        </Text>
      </Card>
    );
  }

  if (subscription.isError || !subscription.data) {
    return (
      <Card className="p-4 sm:p-5" aria-label="Subscription" role="alert">
        <Title>Subscription</Title>
        <Text className="mt-2 text-xs text-tremor-content-subtle">
          Subscription state is currently unavailable.
        </Text>
      </Card>
    );
  }

  const sub = subscription.data;
  const status = sub.status;

  return (
    <Card className="p-4 sm:p-5 flex flex-col justify-between" aria-label="Subscription">
      <div>
        <Flex justifyContent="between" alignItems="start" className="gap-2">
          <Title>Subscription</Title>
          <Badge
            size="xs"
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
            className="mt-2 apoaap-callout-note px-2 py-1"
          >
            <Text className="text-xs text-cp-note-text">
              Live billing read failed — showing the last known value, which may be
              out of date.
            </Text>
          </div>
        ) : null}

        <Divider className="my-2.5" />

        <div className="space-y-1">
          <DetailRow label="Plan">
            <Text className="text-xs">{sub.planName ?? "—"}</Text>
          </DetailRow>
          <DetailRow label="Price">
            <Text className="text-xs">
              {sub.price
                ? `${sub.price.amount} ${sub.price.currencyCode}`
                : "—"}
            </Text>
          </DetailRow>
          <DetailRow label="Period start">
            <Text className="text-xs">{formatDate(sub.currentPeriodStart)}</Text>
          </DetailRow>
          <DetailRow label="Period end">
            <Text className="text-xs">{formatDate(sub.currentPeriodEnd)}</Text>
          </DetailRow>
        </div>
      </div>
    </Card>
  );
}

const CAMPAIGN_STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  REVERTED: "Reverted",
  EARLY_REVERTED: "Early reverted",
  UNINSTALL_ORPHANED: "Uninstall orphaned",
};

const ALLOWANCE_LABELS: Readonly<Record<string, string>> = {
  CAMPAIGN_LAUNCH: "Campaign launches",
  PRODUCT_VARIANT_UPDATE: "Product variant updates",
  AI_CREDIT: "AI credits",
};

function CampaignList({
  title,
  campaigns,
  total,
}: {
  readonly title: string;
  readonly campaigns: readonly CampaignSummary[];
  readonly total: number;
}) {
  return (
    <section aria-label={title}>
      <Flex justifyContent="between" alignItems="baseline">
        <Text className="font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">
          {title}
        </Text>
        {total > campaigns.length ? (
          <Text className="text-xs text-tremor-content-subtle">
            Showing {campaigns.length} of {total}
          </Text>
        ) : null}
      </Flex>
      {campaigns.length === 0 ? (
        <Text className="mt-2 text-sm text-tremor-content-subtle">None.</Text>
      ) : (
        <List className="mt-1">
          {campaigns.map((campaign) => (
            <ListItem key={campaign.id} className="items-start gap-3">
              <div className="min-w-0">
                <Text className="truncate font-medium">{campaign.name}</Text>
                <Text className="text-xs text-tremor-content-subtle">
                  {campaign.recurring ? "Recurring" : "One-time"}
                  {campaign.productCount !== null
                    ? ` · ${campaign.productCount.toLocaleString()} products`
                    : ""}
                </Text>
              </div>
              <div className="shrink-0 text-right">
                <Text className="text-xs">
                  {campaign.startAt ? formatTimestamp(campaign.startAt) : "No start time"}
                </Text>
                {campaign.endAt ? (
                  <Text className="text-xs text-tremor-content-subtle">
                    Ends {formatTimestamp(campaign.endAt)}
                  </Text>
                ) : null}
              </div>
            </ListItem>
          ))}
        </List>
      )}
    </section>
  );
}

function CampaignMonitorCard({ shop }: { readonly shop: string }) {
  const query = trpc.directory.campaignMonitor.useQuery(
    { shop },
    { enabled: shop.length > 0 },
  );

  if (query.isLoading) {
    return (
      <Card aria-label="Campaigns and allowances" aria-busy="true">
        <Title>Campaigns &amp; allowances</Title>
        <Text className="mt-2" role="status">Loading campaign state…</Text>
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Card aria-label="Campaigns and allowances" role="alert">
        <Title>Campaigns &amp; allowances</Title>
        <Text className="mt-2 text-cp-danger">Campaign state is currently unavailable.</Text>
        <Text className="mt-1 text-xs text-tremor-content-subtle">{query.error.message}</Text>
      </Card>
    );
  }
  if (!query.data?.supported) {
    return (
      <Card aria-label="Campaigns and allowances">
        <Title>Campaigns &amp; allowances</Title>
        <Text className="mt-2 text-tremor-content-subtle">
          This app connector does not provide campaign monitoring.
        </Text>
      </Card>
    );
  }
  const monitor = query.data.monitor;
  if (!monitor) {
    return (
      <Card aria-label="Campaigns and allowances">
        <Title>Campaigns &amp; allowances</Title>
        <Text className="mt-2 text-tremor-content-subtle">No campaign data exists for this shop.</Text>
      </Card>
    );
  }

  const headline = [
    ["Active", monitor.counts.ACTIVE],
    ["Scheduled", monitor.counts.SCHEDULED],
    ["Total", monitor.total],
    ["Paused", monitor.counts.PAUSED],
  ] as const;
  const secondaryStatuses = [
    "DRAFT",
    "COMPLETED",
    "REVERTED",
    "EARLY_REVERTED",
    "UNINSTALL_ORPHANED",
  ] as const;

  return (
    <Card aria-label="Campaigns and allowances">
      <Flex justifyContent="between" alignItems="start" className="gap-4">
        <div>
          <Title>Campaigns &amp; allowances</Title>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            {monitor.plan} plan · replica state
          </Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            Next scheduled start: {formatTimestamp(monitor.nextScheduledAt)}
          </Text>
        </div>
        <AsOf iso={monitor.asOf} />
      </Flex>

      {monitor.billingSuspended ? (
        <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 dark:bg-amber-950" role="status">
          <Text className="text-sm text-amber-800 dark:text-amber-200">
            Billing is suspended; SaleSwitch will block new campaign work until it is resolved.
          </Text>
        </div>
      ) : null}

      <Grid numItemsSm={2} numItemsLg={4} className="mt-4 gap-3">
        {headline.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-tremor-border p-3 dark:border-dark-tremor-border">
            <Text>{label}</Text>
            <Metric>{value.toLocaleString()}</Metric>
          </div>
        ))}
      </Grid>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Campaign status breakdown">
        {secondaryStatuses.map((status) => (
          <Badge key={status} color={monitor.counts[status] > 0 ? "blue" : "gray"}>
            {CAMPAIGN_STATUS_LABELS[status]} {monitor.counts[status]}
          </Badge>
        ))}
      </div>

      <Divider className="my-4" />
      <Title>Plan allowances</Title>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        {monitor.allowances.map((allowance) => {
          const exhausted = allowance.limit !== null && allowance.remaining === 0;
          const overLimit = allowance.limit !== null && allowance.used > allowance.limit;
          const percent = allowance.limit === null || allowance.limit === 0
            ? 0
            : Math.min(100, (allowance.used / allowance.limit) * 100);
          return (
            <div key={allowance.metric} className="rounded-lg border border-tremor-border p-3 dark:border-dark-tremor-border">
              <Flex justifyContent="between" alignItems="baseline" className="gap-2">
                <Text className="font-medium">{ALLOWANCE_LABELS[allowance.metric]}</Text>
                {allowance.limit === null ? <Badge color="emerald">Unlimited</Badge> : null}
              </Flex>
              {allowance.limit === null ? (
                <Text className="mt-2 text-sm text-tremor-content-subtle">
                  {allowance.used.toLocaleString()} used
                </Text>
              ) : (
                <>
                  <ProgressBar value={percent} color={exhausted ? "rose" : percent >= 80 ? "amber" : "blue"} className="mt-3" />
                  <Flex justifyContent="between" className="mt-2 gap-2">
                    <Text className="text-xs">{allowance.used.toLocaleString()} used</Text>
                    <Text className={`text-xs ${exhausted ? "text-cp-danger" : ""}`}>
                      {allowance.remaining?.toLocaleString()} remaining
                    </Text>
                  </Flex>
                  {overLimit ? (
                    <Text className="mt-1 text-xs text-cp-danger">
                      Usage is {(allowance.used - allowance.limit).toLocaleString()} over the current limit.
                    </Text>
                  ) : null}
                </>
              )}
              <Text className="mt-2 text-xs text-tremor-content-subtle">
                {allowance.window === "BILLING_PERIOD"
                  ? `Billing period${allowance.windowEndsAt ? ` · resets ${formatDate(allowance.windowEndsAt)}` : ""}`
                  : allowance.window === "LIFETIME" ? "Lifetime allowance" : "No plan limit"}
              </Text>
            </div>
          );
        })}
      </div>

      <Divider className="my-4" />
      <Grid numItemsLg={2} className="gap-5">
        <CampaignList title="Active campaigns" campaigns={monitor.active} total={monitor.counts.ACTIVE} />
        <CampaignList title="Upcoming campaigns" campaigns={monitor.scheduled} total={monitor.counts.SCHEDULED} />
      </Grid>
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

  const addTag = trpc.actions.addTag.useMutation({
    onSuccess: () => {
      setLabel("");
      onChanged();
    },
  });

  const removeTag = trpc.actions.removeTag.useMutation({
    onSuccess: () => {
      onChanged();
    },
  });

  const isMutating = addTag.isPending || removeTag.isPending;
  const canSubmit = label.trim().length > 0 && !isMutating;

  return (
    <Card className="p-4 sm:p-5 flex flex-col justify-between" aria-label="Tags">
      <div>
        <Flex justifyContent="between" alignItems="center">
          <Title>Tags</Title>
          {tags.length > 0 ? (
            <Badge size="xs" color="gray">
              {tags.length}
            </Badge>
          ) : null}
        </Flex>

        <Divider className="my-2.5" />

        <div className="flex flex-wrap gap-1.5 min-h-[3rem] items-start content-start" aria-label="Current tags">
          {tags.length === 0 ? (
            <Text className="text-xs text-tremor-content-subtle py-1">No tags yet.</Text>
          ) : (
            tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-tremor-brand-faint px-2 py-0.5 text-xs font-medium text-tremor-brand-emphasis border border-tremor-brand/20 dark:bg-dark-tremor-brand-faint dark:text-dark-tremor-brand-emphasis"
                aria-label={`Tag ${tag}`}
              >
                <span>{tag}</span>
                <button
                  type="button"
                  onClick={() => removeTag.mutate({ shop, label: tag })}
                  disabled={isMutating}
                  className="rounded hover:bg-rose-500/20 text-tremor-content-subtle hover:text-rose-500 focus:outline-none p-0.5"
                  title={`Remove ${tag}`}
                  aria-label={`Remove tag ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="mt-4">
        <Divider className="my-2.5" />
        <form
          aria-label="Add tag"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            addTag.mutate({ shop, label: label.trim() });
          }}
          className="flex gap-2"
        >
          <TextInput
            placeholder="New tag…"
            value={label}
            onValueChange={setLabel}
            aria-label="Tag label"
            className="text-xs"
          />
          <Button
            type="submit"
            size="xs"
            disabled={!canSubmit}
            loading={addTag.isPending}
          >
            Add
          </Button>
        </form>
        {addTag.isError ? (
          <Text className="mt-1.5 text-xs text-cp-danger" role="alert">
            {addTag.error.message}
          </Text>
        ) : null}
        {removeTag.isError ? (
          <Text className="mt-1.5 text-xs text-cp-danger" role="alert">
            {removeTag.error.message}
          </Text>
        ) : null}
      </div>
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

  const addNote = trpc.actions.addNote.useMutation({
    onSuccess: () => {
      setBody("");
      onChanged();
    },
  });

  const deleteNote = trpc.actions.deleteNote.useMutation({
    onSuccess: () => {
      onChanged();
    },
  });

  const isMutating = addNote.isPending || deleteNote.isPending;
  const canSubmit = body.trim().length > 0 && !isMutating;

  return (
    <Card className="p-4 sm:p-5 flex flex-col justify-between" aria-label="Notes">
      <div>
        <Flex justifyContent="between" alignItems="center">
          <Title>Recent notes</Title>
          {notes.length > 0 ? (
            <Badge size="xs" color="gray">
              {notes.length}
            </Badge>
          ) : null}
        </Flex>

        <Divider className="my-2.5" />

        {notes.length === 0 ? (
          <div className="min-h-[3rem] flex items-center">
            <Text className="text-xs text-tremor-content-subtle">No notes yet.</Text>
          </div>
        ) : (
          <div className="max-h-52 overflow-y-auto space-y-2 pr-1" aria-label="Recent notes list">
            {notes.map((note) => (
              <div
                key={note.id}
                className="group relative rounded-md border border-tremor-border/60 bg-tremor-background-muted/40 p-2 text-xs dark:border-dark-tremor-border/60 dark:bg-dark-tremor-background-muted/20"
              >
                <div className="flex justify-between items-start gap-2">
                  <Text className="text-xs whitespace-pre-wrap break-words flex-1 text-tremor-content-emphasis">
                    {note.body}
                  </Text>
                  <button
                    type="button"
                    onClick={() => deleteNote.mutate({ noteId: note.id })}
                    disabled={isMutating}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-tremor-content-subtle hover:text-rose-500 p-0.5"
                    title="Delete note"
                    aria-label="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Text className="mt-1.5 text-[11px] text-tremor-content-subtle truncate">
                  {note.authorId} · {formatTimestamp(note.createdAt)}
                </Text>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <Divider className="my-2.5" />
        <form
          aria-label="Add note"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            addNote.mutate({ shop, body: body.trim() });
          }}
        >
          <Textarea
            placeholder="Write a note…"
            value={body}
            onValueChange={setBody}
            rows={2}
            aria-label="Note body"
            className="text-xs"
          />
          <Flex justifyContent="end" className="mt-2">
            <Button
              type="submit"
              size="xs"
              disabled={!canSubmit}
              loading={addNote.isPending}
            >
              Add note
            </Button>
          </Flex>
          {addNote.isError ? (
            <Text className="mt-1 text-xs text-cp-danger" role="alert">
              {addNote.error.message}
            </Text>
          ) : null}
          {deleteNote.isError ? (
            <Text className="mt-1 text-xs text-cp-danger" role="alert">
              {deleteNote.error.message}
            </Text>
          ) : null}
        </form>
      </div>
    </Card>
  );
}

/** Per-shop audit trail (cp-merchant-360), newest first. */
function AuditTrailCard({ audit }: { readonly audit: readonly AuditEntry[] }) {
  return (
    <Card className="p-4 sm:p-5 flex flex-col justify-between" aria-label="Audit trail">
      <div>
        <Flex justifyContent="between" alignItems="center">
          <Title>Audit trail</Title>
          {audit.length > 0 ? (
            <Badge size="xs" color="gray">
              {audit.length}
            </Badge>
          ) : null}
        </Flex>

        <Divider className="my-2.5" />

        {audit.length === 0 ? (
          <div className="min-h-[3rem] flex items-center">
            <Text className="text-xs text-tremor-content-subtle">No audit entries for this shop.</Text>
          </div>
        ) : (
          <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1" aria-label="Shop audit entries">
            <List className="divide-y-0 space-y-1.5">
              {audit.map((a) => (
                <ListItem key={a.id} className="flex-col items-start py-1 px-0">
                  <Flex justifyContent="between" alignItems="baseline" className="w-full gap-2">
                    <code className="text-[11px] font-mono text-tremor-brand truncate">{a.action}</code>
                    <Text className="text-[11px] text-tremor-content-subtle shrink-0">
                      <time dateTime={a.createdAt}>{formatTimestamp(a.createdAt)}</time>
                    </Text>
                  </Flex>
                  <Text className="text-[11px] text-tremor-content-subtle mt-0.5 truncate">
                    {a.actorEmail ?? a.actorUserId} · {a.source}
                  </Text>
                </ListItem>
              ))}
            </List>
          </div>
        )}
      </div>

      <div>
        <Divider className="my-2.5" />
        <Text className="text-xs text-tremor-content-subtle">
          Latest {audit.length} actions
        </Text>
      </div>
    </Card>
  );
}

/**
 * Merchant Activity feed (usage-analytics Phase 4). The shop's recent usage events
 * (newest first), cursor-paginated with a hard page cap, read from the control plane's
 * OWN mirror via `trpc.usage.activity` — the ONE permitted raw-event read (documented in
 * the usage router). Impersonated events are visibly badged (support context). Pages
 * accumulate as the operator clicks "Load older"; a stable cursor (the source seq) walks
 * backwards so a mid-stream ingest can't skip or duplicate rows.
 */
function eventIdentity(event: ActivityEvent): string {
  return `${event.name}:${event.category}:${JSON.stringify(event.properties)}`;
}

/** Build approximate sessions from the newest-first bounded feed, then show each journey forward. */
function buildJourneySessions(events: readonly ActivityEvent[]): JourneySession[] {
  const groups: ActivityEvent[][] = [];
  let current: ActivityEvent[] = [];
  for (const event of events) {
    const previous = current[current.length - 1];
    const gap = previous ? Date.parse(previous.occurredAt) - Date.parse(event.occurredAt) : 0;
    if (previous && gap > ACTIVITY_SESSION_GAP_MS) {
      groups.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((newestFirst) => {
    const chronological = [...newestFirst].reverse();
    const steps: JourneyStep[] = [];
    for (const event of chronological) {
      const last = steps[steps.length - 1];
      if (last && eventIdentity(last.event) === eventIdentity(event)) {
        steps[steps.length - 1] = { event: last.event, count: last.count + 1 };
      } else {
        steps.push({ event, count: 1 });
      }
    }
    return {
      id: chronological[0]!.id,
      startedAt: chronological[0]!.occurredAt,
      endedAt: chronological[chronological.length - 1]!.occurredAt,
      steps,
    };
  });
}

function routeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = (value.split("?")[0] ?? value).split("/").filter(Boolean);
  const appIndex = parts.indexOf("app");
  const useful = appIndex >= 0 ? parts.slice(appIndex + 1) : parts;
  if (useful.length === 0) return "Home";
  return useful
    .filter((part) => !/^[a-z0-9]{16,}$/i.test(part))
    .map((part) => part.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()))
    .join(" › ") || "Campaign details";
}

function eventPresentation(event: ActivityEvent): {
  readonly label: string;
  readonly detail: string;
  readonly tone: "blue" | "emerald" | "amber" | "gray";
  readonly Icon: typeof Circle;
} {
  const props = event.properties;
  switch (event.name) {
    case "page_viewed":
      return { label: routeLabel(props?.route) ?? "Page viewed", detail: "Navigation", tone: "blue", Icon: Eye };
    case "wizard_completed":
      return { label: "Campaign wizard completed", detail: formatEventProps(props), tone: "emerald", Icon: WandSparkles };
    case "campaign_activated":
      return { label: "Campaign activated", detail: formatEventProps(props), tone: "emerald", Icon: Check };
    case "campaign_completed":
      return { label: "Campaign completed", detail: formatEventProps(props), tone: "emerald", Icon: Flag };
    case "entitlement_denied":
      return { label: "Pro feature blocked", detail: formatEventProps(props), tone: "amber", Icon: Ban };
    default:
      return {
        label: event.name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        detail: formatEventProps(props), tone: "gray", Icon: Circle,
      };
  }
}

function formatSessionRange(startedAt: string, endedAt: string): string {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const date = start.toLocaleDateString();
  const startTime = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return startTime === endTime ? `${date} · ${startTime}` : `${date} · ${startTime}–${endTime}`;
}

function ActivityTab({ shop }: { readonly shop: string }) {
  const [pages, setPages] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedInitial, setLoadedInitial] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  // `enabled: false` so we control fetching explicitly (initial load + each "load older").
  // The query key carries `before: cursor`, so a refetch always pulls the next older page.
  const q = trpc.usage.activity.useQuery(
    { shop, before: cursor },
    { enabled: false, retry: false },
  );

  // Initial page load, once per shop.
  useEffect(() => {
    let cancelled = false;
    void q.refetch().then((res) => {
      if (!cancelled && res.data) {
        setPages(res.data.events);
        setCursor(res.data.nextCursor);
        setLoadedInitial(true);
      } else if (!cancelled) {
        setLoadedInitial(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop]);

  const loadOlder = () => {
    void q.refetch().then((res) => {
      if (res.data) {
        setPages((prev) => [...prev, ...res.data!.events]);
        setCursor(res.data.nextCursor);
      }
    });
  };

  if (q.isError) {
    return (
      <Card role="alert" aria-label="Activity load error">
        <Title>Activity</Title>
        <Text className="mt-2">Couldn't load this shop's activity.</Text>
        <Text className="mt-1 text-xs text-tremor-content-subtle">{q.error.message}</Text>
      </Card>
    );
  }

  if (!loadedInitial || (q.isFetching && pages.length === 0)) {
    return (
      <Card aria-label="Activity" aria-busy="true">
        <Title>Activity</Title>
        <Text className="mt-2" role="status">
          Loading activity…
        </Text>
      </Card>
    );
  }

  if (pages.length === 0) {
    return (
      <Card aria-label="Activity">
        <Title>Activity</Title>
        <Text className="mt-2 text-tremor-content-subtle" role="status">
          No usage events recorded for this shop yet.
        </Text>
      </Card>
    );
  }

  const hasMore = cursor !== null;
  const sessions = buildJourneySessions(pages);
  return (
    <Card aria-label="Activity">
      <Flex justifyContent="between" alignItems="start" className="gap-4">
        <div>
          <Title>Activity journey</Title>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            Sessions are approximated from 30-minute inactivity gaps · newest session first
          </Text>
        </div>
        <Button size="xs" variant="secondary" type="button" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? "Show journey" : "Show raw events"}
        </Button>
      </Flex>
      {showRaw ? (
        <List className="mt-4" aria-label="Raw usage events">
          {pages.map((e) => (
            <ListItem key={e.id} className="flex-col items-start">
              <Flex justifyContent="between" alignItems="baseline" className="w-full gap-2">
                <div className="flex items-center gap-2">
                  <code className="text-xs">{e.name}</code>
                  {e.impersonated ? <Badge color="amber">Impersonated</Badge> : null}
                </div>
                <Text className="text-xs text-tremor-content-subtle"><time dateTime={e.occurredAt}>{formatTimestamp(e.occurredAt)}</time></Text>
              </Flex>
              <Text className="text-xs text-tremor-content-subtle">
                {e.category}{formatEventProps(e.properties) ? ` · ${formatEventProps(e.properties)}` : ""}
              </Text>
            </ListItem>
          ))}
        </List>
      ) : (
        <div className="mt-5 space-y-5" aria-label="Usage journey sessions">
          {sessions.map((session, sessionIndex) => (
            <section key={session.id} className="rounded-lg border border-tremor-border p-4 dark:border-dark-tremor-border">
              <Flex justifyContent="between" alignItems="baseline" className="gap-3">
                <Text className="font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">
                  {sessionIndex === 0 ? "Latest session" : "Earlier session"}
                </Text>
                <Text className="text-xs text-tremor-content-subtle">{formatSessionRange(session.startedAt, session.endedAt)}</Text>
              </Flex>
              <ol className="mt-4" aria-label={`Session starting ${formatTimestamp(session.startedAt)}`}>
                {session.steps.map(({ event, count }, index) => {
                  const presentation = eventPresentation(event);
                  const Icon = presentation.Icon;
                  const isLast = index === session.steps.length - 1;
                  const toneClasses = {
                    blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                    gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
                  }[presentation.tone];
                  return (
                    <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                      {!isLast ? <span className="absolute left-[13px] top-7 h-[calc(100%-1rem)] w-px bg-tremor-border dark:bg-dark-tremor-border" aria-hidden="true" /> : null}
                      <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${toneClasses}`}>
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <Flex justifyContent="between" alignItems="baseline" className="gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Text className="font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">{presentation.label}</Text>
                            {count > 1 ? <Badge color="gray">×{count}</Badge> : null}
                            {event.impersonated ? <Badge color="amber">Impersonated</Badge> : null}
                          </div>
                          <Text className="shrink-0 text-xs text-tremor-content-subtle">
                            <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                          </Text>
                        </Flex>
                        {presentation.detail ? <Text className="mt-0.5 text-xs text-tremor-content-subtle">{presentation.detail}</Text> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
      {hasMore ? (
        <div className="mt-3">
          <Button
            size="xs"
            variant="secondary"
            type="button"
            onClick={loadOlder}
            loading={q.isFetching}
            disabled={q.isFetching}
          >
            Load older
          </Button>
        </div>
      ) : (
        <Text className="mt-3 text-xs text-tremor-content-subtle">End of history.</Text>
      )}
    </Card>
  );
}

/** Render a couple of an event's key properties compactly (best-effort, PII-free keys). */
function formatEventProps(props: Record<string, unknown> | null): string {
  if (!props) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === null || typeof v === "object") continue;
    parts.push(`${k}: ${String(v)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(", ");
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
        <Title className="flex items-center gap-2">
          <Store className="h-5 w-5 text-tremor-brand" aria-hidden="true" />
          <span>Merchant</span>
        </Title>
        <Card className="mt-4" role="alert" aria-label="Missing shop parameter">
          <Text>No shop was specified.</Text>
        </Card>
      </main>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <main className="p-6" aria-busy="true">
        <Title className="flex items-center gap-2">
          <Store className="h-5 w-5 text-tremor-brand" aria-hidden="true" />
          <span>{shop}</span>
        </Title>
        <Text className="mt-2" role="status">
          Loading merchant…
        </Text>
      </main>
    );
  }

  if (detailQuery.isError) {
    return (
      <main className="p-6">
        <Title className="flex items-center gap-2">
          <Store className="h-5 w-5 text-tremor-brand" aria-hidden="true" />
          <span>{shop}</span>
        </Title>
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
          <Title className="flex items-center gap-2">
            <Store className="h-5 w-5 text-tremor-brand" aria-hidden="true" />
            <span>{shop}</span>
          </Title>
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
        <Title className="flex items-center gap-2">
          <Store className="h-5 w-5 text-tremor-brand" aria-hidden="true" />
          <span>{detail.name ?? shop}</span>
        </Title>
        <Link to="/merchants" className="text-tremor-brand hover:underline">
          ← Back to merchants
        </Link>
      </Flex>
      <div className="mb-4">
        <AsOf iso={detail.asOf} />
      </div>

      <TabGroup>
        <TabList aria-label="Merchant sections" className="overflow-visible">
          <Tab>Overview</Tab>
          <Tab>Activity</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <Grid numItemsLg={3} className="mt-4 gap-4">
              <ShopInfoCard shop={shop} detail={detail} />
              <HealthCard shop={shop} />
              <BillingCard shop={shop} />
            </Grid>
            <div className="mt-4">
              <CampaignMonitorCard shop={shop} />
            </div>
            <Grid numItemsLg={3} className="mt-4 gap-4">
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
              <AuditTrailCard audit={detail.audit} />
            </Grid>
          </TabPanel>
          <TabPanel>
            <div className="mt-4">
              <ActivityTab shop={shop} />
            </div>
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </main>
  );
}
