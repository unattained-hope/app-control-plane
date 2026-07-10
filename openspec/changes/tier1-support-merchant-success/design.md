## Context

Tier 0 ([tier0-app-store-gating](../tier0-app-store-gating/proposal.md)) cleared the
App-Store floor. Tier 1 is the "fast wins" tier: high value, low effort because the
data model and plumbing already exist. This change rides the following existing seams
(verified against the codebase):

- **Inbox data + transport.** `Conversation`/`Message` models
  ([schema.prisma](../../../prisma/schema.prisma)), a `ConversationService`
  (`getOrCreateForShop`, `persistMessage`, `history`, `listConversations`, `assign`,
  `markRead` — [conversationService.ts](../../../app/server/services/conversationService.ts)),
  the Socket.IO gateway with `merchant:*`/`agent:*` events + offline email fallback
  ([chatGateway.ts](../../../app/server/realtime/chatGateway.ts)), a `PresenceTracker`
  (`anyAgentOnline`, `onlineCount` — [presence.ts](../../../app/server/realtime/presence.ts)),
  the `chat` tRPC router (`conversations`, `history`, `assign`, `markRead` —
  [chat.ts](../../../app/server/trpc/routers/chat.ts)), and the inbox route
  ([inbox.tsx](../../../app/routes/inbox.tsx)). `SenderType` is `MERCHANT | AGENT | SYSTEM`;
  `Conversation.assignedTo` already exists.
- **Same-transaction append-only audit.** `AuditService.append(input, tx)` accepts a
  transaction client so the audit row commits atomically with its effect
  ([auditService.ts](../../../app/server/services/auditService.ts)); notes/tags/actions use it
  ([merchantActionService.ts](../../../app/server/services/merchantActionService.ts)). The
  viewer ([audit.tsx](../../../app/routes/audit.tsx)) + `audit` router already render/filter
  free-text `action` + `before`/`after`.
- **Repeatable BullMQ sweep.** `scheduleComplianceSweep()`/`startComplianceSweepWorker()`
  ([complianceSweep.ts](../../../app/server/workers/complianceSweep.ts)) and
  `scheduleKpiRollup()` ([kpiRollup.ts](../../../app/server/workers/kpiRollup.ts)) give the
  exact `repeat: { pattern }` + `jobId` + `attempts`/exponential-backoff + `captureError`
  pattern, started from [server/start.js](../../../server/start.js).
- **Merchant reads + composition.** `MerchantService.detail(appKey, shop)` already merges a
  connector replica read with CP-owned notes/tags into `MerchantDetailView`
  ([merchantService.ts](../../../app/server/services/merchantService.ts)); the connector
  interface ([types.ts](../../../app/server/connectors/types.ts)) exposes `getMerchant` /
  `getSubscription`. The merchant route ([merchant-detail.tsx](../../../app/routes/merchant-detail.tsx))
  already does the "as of" + audited `revealPii` treatment.
- **RBAC + context.** CASL `Action` union + `defineAbilityFor(role)` + `requireAbility(action)`
  ([rbac.ts](../../../app/server/rbac.ts)); the tRPC `Context` carries `identity`, `ip`,
  `userAgent`, `appKey` ([root.ts](../../../app/server/trpc/root.ts)).
- **Tests.** In-memory `FakeDb` with real `$transaction` rollback + a `failAudit` switch
  ([fakeDb.ts](../../../test/helpers/fakeDb.ts)); RBAC matrix tests
  ([rbac.test.ts](../../../test/rbac.test.ts)); Playwright e2e.

## Goals / Non-Goals

**Goals:**

- Priority-keyed, office-hours-aware SLA timers (first-reply + resolution) with a swept
  `breaching` state, surfaced as countdown chips in the inbox.
- Canned replies/macros (ADMIN-managed) + agent-only internal notes that the merchant
  never receives.
- Rule-based, presence-aware auto-assignment of new conversations + audited manual reassign.
- Post-close CSAT capture, CP-owned conversation tags, and server-side inbox search.
- A single Merchant 360 surface: connector reads + notes/tags + per-shop conversation
  history + per-shop audit trail + billing, read-only with "as of".
- A structured audit taxonomy (typed actions, actor identity/type, source) with diffs and
  structured-field filtering — backward compatible with existing rows.
- Preserve every invariant: replica-only reads, same-tx append-only audit, server-side
  CASL, no app-DB writes, `process.env` only in `config.ts`; **zero** connector-interface
  edits.

**Non-Goals:**

- Full helpdesk parity (teams, round-robin load-balancing, conversation merge, SLA holiday
  calendars, multi-channel) — roadmap v1 / Chatwoot adoption.
- Reporting/analytics dashboards on SLA attainment or CSAT trends (Tier 2/3); this change
  captures the data, it doesn't build the BI surface.
- Full-text search infrastructure (a search engine / Postgres FTS tuning); MVP search is a
  bounded indexed `ILIKE` over the existing tables.
- Changing the realtime transport, the connector contract, or onboarding app #2.

## Decisions

### D1 — SLA timers: priority policy + office-hours clock + breach sweep

Add `priority` (`Priority` enum: `URGENT | HIGH | NORMAL | LOW | NONE`, default `NONE`) and
nullable `firstReplyAt`, `firstResponseDueAt`, `resolutionDueAt`, plus an `slaState`
(`ON_TRACK | BREACHING | BREACHED | MET`, default `ON_TRACK`) to `Conversation`. A pure
`slaPolicy` module maps priority → first-response/resolution budgets and computes due-times
against a **configured business-hours window** (single timezone + daily open/close), so "8
calendar hrs = 1 business day". **"No priority ⇒ no SLA":** `NONE` leaves due-times null and
is never swept. Due-times are set when priority is assigned (by a routing rule or manually),
not at creation. The **first agent reply** stamps `firstReplyAt` exactly once (guarded in
`persistMessage`/the gateway `agent:reply` path). A repeatable BullMQ **`sla-sweep`** worker
(cloned from [complianceSweep.ts](../../../app/server/workers/complianceSweep.ts):
`repeat:{pattern}`, `jobId: sla-sweep-${appKey}`, attempts+backoff, `captureError`) flips
open conversations to `BREACHING`/`BREACHED` based on `dueAt` vs now and audits the
transition. **Alternative rejected:** computing breach state on-read in the inbox query —
rejected because it can't drive notifications/escalation and recomputes per request; a swept
materialized state matches the compliance-SLA pattern already in the repo.

### D2 — Internal notes: a server-enforced `internal` flag on `Message`

Internal notes are `Message` rows with `senderType = AGENT` and a new `internal Boolean
@default(false)`. **The server is the choke point:** the merchant-facing paths
(`chatGateway` merchant room broadcast + any merchant-scoped `history`) filter
`internal = true` out; only agent-scoped reads return them. **Alternatives considered:** (a)
a new `SenderType = INTERNAL_NOTE` — rejected because internal notes still attribute to an
agent (`senderId = AdminUser`) and we'd lose that; (b) a separate `InternalNote` table —
rejected because notes interleave chronologically with the conversation and reusing `Message`
keeps the single ordered timeline + existing indexes. The flag is additive and defaults
false, so every existing message stays merchant-visible.

### D3 — Canned replies: CP-owned table, ADMIN-managed, server-side substitution

A `CannedReply` model (`appKey`, `shortcut` unique-per-app, `title`, `body`, `createdBy`,
timestamps). Management (create/edit/delete) requires a new ADMIN-only ability
`canned:manage`; **using** a canned reply is just composing a normal agent reply, so it
reuses the existing `reply` ability — no new gate on send. Variable substitution
(`{{shop}}`, `{{merchant_name}}`, `{{agent_name}}`) is resolved **server-side** at fetch/apply
time from known context so the stored template never trusts client-rendered values.
**Alternative rejected:** client-only macros (localStorage) — rejected because they aren't
shared across the team, the whole point of macros.

### D4 — Routing: declarative `AssignmentRule`, evaluated on create, presence-aware

`AssignmentRule` (`appKey`, `order`, `matchField` ∈ {keyword, plan, priority, shop},
`matchValue`, `assignTo?`, `setPriority?`, `active`). On `getOrCreateForShop` (new
conversation only), `RoutingService.route()` evaluates active rules in `order`, first match
wins; it sets `assignedTo`/`priority` and — when assigning — **skips agents the
`PresenceTracker` reports offline**, falling back to unassigned (queued) so a rule never
parks a ticket on an absent agent. Assignment (rule-driven or manual) writes an
`AuditLog` row in the same transaction (`conversation.assigned`, with `before/after` =
`assignedTo`). **Alternative rejected:** an external rules engine — overkill for a handful of
attribute matches; a small ordered table is inspectable and CP-owned.

### D5 — CSAT + tags + search

CSAT: add `csatScore Int?` (1–5) + `csatComment String?` to `Conversation`; on close the
merchant widget shows a one-time prompt whose response persists through the existing widget
transport into a `csatService.record()` (idempotent per conversation). Tags: a
`ConversationTag` model mirroring [`MerchantTag`](../../../prisma/schema.prisma)
(`appKey`, `conversationId`, `label`, `@@unique([conversationId, label])`). Search: extend
the `chat.conversations`/a new `chat.search` procedure with a server-side bounded query over
shop, subject, tag label, and `Message.body` (`ILIKE`, capped + indexed), reusing the
manual server-driven TanStack-Table pattern from [merchants.tsx](../../../app/routes/merchants.tsx).
**Alternative rejected:** client-side filtering of a fully-loaded list — won't scale past the
first page and breaks the existing server-pagination convention.

### D6 — Merchant 360: a read-only composition, not new storage

Add `MerchantService.overview(appKey, shop)` (or extend `detail`) that fans out, in parallel,
to: the connector (`getMerchant` + `getSubscription`, replica-only), CP notes/tags, the
shop's conversations (`listConversations` filtered by shop + the per-shop audit trail
(`AuditService.query({ merchantShop })` — the `@@index([merchantShop])` already exists). It
returns one view object carrying a single `asOf` for the replica portion (existing lag
treatment). **No new tables** — 360 is pure read composition; every app-DB read stays on the
replica through the connector (no raw SQL). **Alternative rejected:** denormalizing a
per-merchant summary table — violates data-minimization and adds a sync problem for data we
can read live.

### D7 — Audit taxonomy: structured fields, additive + backward compatible

Add to `AuditLog`: `actorEmail String?`, `actorType` (`AuditActorType`:
`INTERNAL | SYSTEM`, default `INTERNAL`), and `source` (`AuditSource`: `UI | API | JOB`,
default `UI`). Introduce an `auditActions` constants module (typed union of the known action
strings — `merchant.note.add`, `conversation.assigned`, `compliance.completed`, …) so call
sites stop passing free-text; `action` stays a `String` column for forward-compat but is
fed from the typed set. `AuditService.append` gains the new fields as **optional** (default
`source: UI`, `actorType: INTERNAL`; worker call sites pass `JOB`/`SYSTEM`). The viewer adds
filters on `actorType`/`source`. **Alternative rejected:** converting `action` to a Postgres
enum — rejected because new audited actions would each need a migration and historical rows
predate the enum; a typed-in-code constant set gives the safety without the migration tax.

### D8 — One additive migration; existing rows preserved

All schema changes are additive: three new models, new nullable columns on
`Conversation`/`Message`/`AuditLog`, and new enums. Defaults (`priority NONE`,
`internal false`, `slaState ON_TRACK`, `source UI`, `actorType INTERNAL`) backfill existing
rows correctly, so no data rewrite and no break to the append-only audit invariant. The
`scripts/check-no-app-db-writes.mjs` guard stays green because every new model is
control-plane-owned.

## Risks / Trade-offs

- **Office-hours SLA correctness (timezones/holidays)** → Scope MVP to a single configured
  business timezone + daily open/close, no holiday calendar; document the limitation and put
  the policy behind one `slaPolicy` module so a holiday calendar is a later drop-in.
- **Internal-note leakage to a merchant** → Enforce the `internal` filter **server-side** in
  the merchant broadcast + merchant history path (the only ways a merchant receives
  messages); never rely on the widget to hide them. Covered by a test asserting a merchant
  stream omits internal rows.
- **Message-body search performance at scale** → MVP uses a bounded `ILIKE` with a result cap
  + a supporting index; flagged as "graduate to Postgres FTS / a search service" if volume
  grows (Tier 2). `log` the cap so truncation isn't silent.
- **Routing rule parks a ticket on an offline/disabled agent** → Presence check + fallback to
  unassigned (queued); manual reassign always available; every assignment audited so
  misroutes are traceable.
- **CSAT prompt spam / double submission** → One prompt per conversation close;
  `csatService.record()` is idempotent (no overwrite once scored), audited.
- **Audit `append` signature growth** → New fields are optional with safe defaults, so every
  existing call site compiles unchanged; only worker/job call sites opt into
  `source: JOB`/`actorType: SYSTEM`.
- **Scope creep toward a full helpdesk** → Hard non-goals above; each capability is the
  minimal "fast win" on an existing seam, not the Chatwoot feature set.

## Migration Plan

1. Land the single additive Prisma migration (3 models + columns + enums) via
   `migrate-dev`; regenerate the client; confirm `check-no-app-db-writes.mjs` green.
2. Ship services + the `sla-sweep` worker; start + schedule it in
   [server/start.js](../../../server/start.js) beside the KPI/compliance sweeps
   (`scheduleSlaSweep("saleswitch")`).
3. Ship tRPC procedures + UI (inbox chips/picker/search/CSAT, merchant 360, audit filters)
   behind the existing RBAC gates.
4. **Rollback:** code revert is safe — all columns are nullable with defaults and all models
   are new/unreferenced by app data, so a revert leaves no broken reads and no data loss; the
   sweep simply stops scheduling.

## Open Questions

1. **Business-hours value** — confirm the single business timezone + open/close window (and
   whether weekends count) for `slaPolicy` before coding; holidays explicitly deferred.
2. **SLA budgets per priority** — confirm the first-response/resolution minutes for
   `URGENT/HIGH/NORMAL/LOW` (defaults proposed in the spec; product to confirm).
3. **CSAT delivery UX** — confirm the prompt is in-widget on close (assumed) vs a follow-up
   email, and the scale (1–5 assumed).
4. **Canned-reply variables** — confirm the supported variable set (`{{shop}}`,
   `{{merchant_name}}`, `{{agent_name}}` proposed).
5. **Routing conflict resolution** — confirm "first match by `order` wins" vs accumulate
   (e.g. one rule sets priority, another assigns); first-match assumed.
