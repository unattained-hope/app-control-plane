## Why

With the App-Store-gating floor cleared (Tier 0: webhook ingestion, GDPR/DSR,
PCD governance, billing monitoring), the next highest-leverage work is the daily
payoff for the people who actually run the portfolio: the support and
merchant-success team. The control plane already ships the *plumbing* for this —
`Conversation`/`Message` + a Socket.IO chat gateway, `MerchantNote`/`MerchantTag`,
a same-transaction append-only `AuditLog`, CASL RBAC, BullMQ workers, the
replica-only connector — but the inbox is still a shared-inbox-grade loop: no SLA
timers, no priority, no canned replies, no internal notes, no rule-based
assignment, no CSAT, no cross-shop search. Merchant context is scattered across
three screens, and the audit log is free-text strings with no event taxonomy.
These are the roadmap's **Tier 1 "fast wins"** — high value, low effort because the
models and seams already exist; this change turns the existing primitives into a
real support desk and a single merchant-success surface, **without** greenfield
infrastructure and **without** touching any architecture invariant.

## What Changes

- **Inbox SLA timers + priority (roadmap §1.1)** — add `priority` and
  `firstReplyAt`/`firstResponseDueAt`/`resolutionDueAt` to `Conversation`; compute
  due-times against **office hours** on a priority policy ("no priority ⇒ no SLA");
  a repeatable BullMQ **SLA sweep** (mirroring the existing compliance sweep) flips
  conversations to a `breaching` state and the inbox surfaces countdown chips.
  First agent reply stamps `firstReplyAt` once.
- **Canned replies / macros + internal notes (roadmap §1.2)** — a new CP-owned
  `CannedReply` table (shortcut + body, ADMIN-managed, SUPPORT-usable) with variable
  substitution; **internal notes** are `Message` rows flagged `internal` (agent-only
  visibility) — the merchant widget never receives them; the chat gateway and history
  reads filter internal messages out of the merchant-facing stream.
- **Assignment & rule-based routing (roadmap §1.3)** — make `Conversation.assignedTo`
  rule-driven: a CP-owned `AssignmentRule` table (match on app/keyword/plan/priority →
  assign agent or set priority), evaluated on conversation creation; presence-aware
  (skip offline agents via the existing `PresenceTracker`); manual reassign stays.
  Every (re)assignment is audited.
- **CSAT + conversation tagging & search (roadmap §1.4)** — add `csatScore`/`csatComment`
  to `Conversation`, a merchant-facing CSAT prompt on close, a CP-owned
  `ConversationTag` table, and server-side inbox **search** (shop, subject, tag,
  message body) reusing the TanStack-Table manual-query pattern from the merchants grid.
- **Merchant 360 panel (roadmap §1.5)** — one detail surface joining replica reads
  (plan/install/status via the connector) + notes/tags + **conversation history for the
  shop** + the **per-shop audit trail** (the `AuditLog.merchantShop` index already
  exists) + billing — read-only w.r.t. the app DB, with the existing "as of" replica-lag
  treatment.
- **Structured audit taxonomy (roadmap §1.6)** — formalize audit events: a typed
  `action` taxonomy (enum/const, not free text), explicit `actorEmail` + `actorType`
  (internal/system) and a `source` field (UI/API/JOB) on `AuditLog`, with before/after
  diffs already captured; the audit viewer filters on the new structured fields. Existing
  rows remain valid (new columns nullable / backfilled with sensible defaults).
- **Schema** — add CP-owned models `CannedReply`, `AssignmentRule`, `ConversationTag`;
  extend `Conversation` (priority, SLA timestamps, CSAT) and `Message` (`internal`); extend
  `AuditLog` (actorEmail, actorType, source); add a `Priority`/`AuditSource` enum set — in
  one Prisma migration. All control-plane-owned; the `check-no-app-db-writes.mjs` guard
  stays green.

## Capabilities

### New Capabilities
- `cp-inbox-sla`: priority-keyed SLA timers (first-reply + resolution) measured against
  office hours, a `breaching` state driven by a repeatable BullMQ sweep, and countdown
  surfacing in the inbox.
- `cp-canned-replies`: ADMIN-managed canned replies/macros with variable substitution,
  plus agent-only **internal notes** that never reach the merchant widget.
- `cp-conversation-routing`: rule-based, presence-aware auto-assignment of new
  conversations (app/keyword/plan/priority → agent/priority) plus audited manual reassign.
- `cp-conversation-csat`: post-close CSAT capture (score + comment), CP-owned conversation
  tags, and server-side inbox search across shop/subject/tag/body.
- `cp-merchant-360`: a unified, read-only merchant detail surface joining connector reads,
  notes/tags, per-shop conversation history, per-shop audit trail, and billing with replica
  "as of" timestamps.
- `cp-audit-taxonomy`: a structured audit event taxonomy (typed action set, actor
  identity/type, source) with before/after diffs and structured-field filtering in the viewer.

### Modified Capabilities
<!-- No spec files exist under openspec/specs/ yet (the MVP chat/audit/merchant-detail
     surfaces were built without OpenSpec deltas), so these inbox/audit/merchant
     enhancements are captured as the new capabilities above rather than as deltas to a
     prior spec. The behavior they build on lives in code, referenced from design.md. -->

## Impact

- **New code**: `prisma` models `CannedReply`, `AssignmentRule`, `ConversationTag`;
  services `slaService.ts`, `cannedReplyService.ts`, `routingService.ts`,
  `csatService.ts` (or methods on `conversationService.ts`); a `sla-sweep` BullMQ
  worker (`app/server/workers/slaSweep.ts`) + scheduler; tRPC routers/procedures for
  canned replies, routing rules, CSAT, tags, and inbox search (extend
  `routers/chat.ts`, register any new router in `trpc/root.ts`); a `merchant-360`
  composition in `merchantService.ts` (+ merchant-detail route); office-hours/SLA-policy
  module.
- **Modified code**: `prisma/schema.prisma` (3 new models, `Conversation`/`Message`/
  `AuditLog` columns, `Priority`/`AuditSource` enums, 1 migration);
  `app/server/realtime/chatGateway.ts` + `conversationService.ts` (filter internal
  messages; stamp `firstReplyAt`; apply routing on create); `app/server/rbac.ts` (a
  `canned:manage` ability for ADMIN, reuse `reply` for usage); `app/server/services/
  auditService.ts` (structured fields + a typed action taxonomy module); `app/routes/
  inbox.tsx` (priority/SLA chips, canned-reply picker, internal-note toggle, search,
  CSAT), `app/routes/merchant-detail.tsx` (360 panel), `app/routes/audit.tsx`
  (structured filters); `server/start.js` (start + schedule the SLA sweep beside the
  KPI/compliance sweeps).
- **Invariants preserved**: replica-only reads (360 reads go through the connector;
  no raw SQL); same-transaction append-only audit (assignment/CSAT/canned-manage
  transitions audit in-tx); server-side CASL RBAC; control plane never writes the app DB
  (every new model is CP-owned); `process.env` only in `config.ts`. No connector
  interface change → app #2 stays one connector + one registry row.
- **Dependencies / assumptions**: office-hours window is a config/policy value (no new
  external dependency); CSAT is collected through the existing in-app widget transport;
  internal-notes visibility relies on the widget honoring the server-filtered stream
  (server is the choke point, not the client). No new third-party service.
