## 1. Schema & migration (CP-owned, additive)

- [x] 1.1 Add `Priority` enum (`URGENT HIGH NORMAL LOW NONE`), `SlaState` enum (`ON_TRACK BREACHING BREACHED MET`), `AuditActorType` enum (`INTERNAL SYSTEM`), and `AuditSource` enum (`UI API JOB`) to `prisma/schema.prisma`
- [x] 1.2 Extend `Conversation` with `priority Priority @default(NONE)`, `slaState SlaState @default(ON_TRACK)`, nullable `firstReplyAt`, `firstResponseDueAt`, `resolutionDueAt`, `csatScore Int?`, `csatComment String?`; add `@@index([appKey, slaState, firstResponseDueAt])`
- [x] 1.3 Extend `Message` with `internal Boolean @default(false)`
- [x] 1.4 Extend `AuditLog` with `actorEmail String?`, `actorType AuditActorType @default(INTERNAL)`, `source AuditSource @default(UI)`
- [x] 1.5 Add `CannedReply` model (CP-owned: `appKey`, `shortcut`, `title`, `body`, `createdBy`, timestamps; `@@unique([appKey, shortcut])`)
- [x] 1.6 Add `AssignmentRule` model (CP-owned: `appKey`, `order`, `matchField`, `matchValue`, `assignTo String?`, `setPriority Priority?`, `active Boolean @default(true)`; `@@index([appKey, active, order])`)
- [x] 1.7 Add `ConversationTag` model mirroring `MerchantTag` (`appKey`, `conversationId`, `label`; `@@unique([conversationId, label])`)
- [x] 1.8 Run the migration (`mcp__plugin_prisma_Prisma-Local__migrate-dev`), regenerate the client, and confirm `scripts/check-no-app-db-writes.mjs` stays green (all new models are control-plane-owned)

## 2. Audit taxonomy (cp-audit-taxonomy)

- [x] 2.1 Add an `auditActions` constants module exporting the typed action taxonomy (existing strings + new `conversation.*`, `canned.*`, `routing.*` actions) and a `KnownAuditAction` union type
- [x] 2.2 Extend `AuditInput` + `AuditService.append` with optional `actorEmail`, `actorType` (default `INTERNAL`), `source` (default `UI`); keep the signature backward compatible so existing call sites compile unchanged
- [x] 2.3 Populate `actorEmail` from `ctx.identity` at the tRPC call sites that build `ActionContext`/audit input; have worker-originated audit writes pass `actorType: SYSTEM`, `source: JOB`
- [x] 2.4 Extend `AuditService.query` + the `audit` tRPC router with `actorType`/`source` filters; add the corresponding filter controls + columns in `app/routes/audit.tsx`
- [x] 2.5 Migrate existing audit call sites (merchant actions, compliance, roles, pii reveal) to reference `auditActions` constants instead of free-text strings

## 3. SLA timers + priority (cp-inbox-sla)

- [x] 3.1 Add an `slaPolicy` module: priority → first-response/resolution budgets + a pure office-hours due-time calculator (single business timezone + daily open/close from config); `NONE` ⇒ null due-times
- [x] 3.2 Add SLA methods to `conversationService` (or a `slaService`): `setPriority(conversationId, priority, actor)` computes due-times and audits `conversation.priority.set` in the same transaction
- [x] 3.3 Stamp `firstReplyAt` exactly once on the first non-internal agent reply (guard in `persistMessage` / the gateway `agent:reply` path); set first-response `slaState` to `MET` when replied before due
- [x] 3.4 Add `app/server/workers/slaSweep.ts` cloned from `complianceSweep.ts` (`repeat:{pattern}`, `jobId: sla-sweep-${appKey}`, attempts + exponential backoff, `captureError`) that flips open prioritized conversations to `BREACHING`/`BREACHED` and audits `conversation.sla.breached` with `source: JOB`
- [x] 3.5 Start + schedule the sweep in `server/start.js` beside the KPI/compliance sweeps (`startSlaWorker()` + `scheduleSlaSweep("saleswitch")`)
- [x] 3.6 Add a tRPC `chat.setPriority` mutation (`requireAbility("reply")`); surface priority + an SLA countdown/overdue chip per row and a breached indicator in `app/routes/inbox.tsx`

## 4. Canned replies + internal notes (cp-canned-replies)

- [x] 4.1 Add a `canned:manage` ability (ADMIN-only) to the CASL `Action` union + grants in `app/server/rbac.ts`
- [x] 4.2 Add a `cannedReplyService` (`list`, `create`, `update`, `delete`) enforcing app-scoped unique `shortcut`; add a server-side `render(reply, context)` that substitutes `{{shop}}`/`{{merchant_name}}`/`{{agent_name}}` and preserves unknown placeholders
- [x] 4.3 Add tRPC procedures: `canned.list` (`requireAbility("reply")`), `canned.create`/`update`/`delete` (`requireAbility("canned:manage")`); register in `trpc/root.ts` if a new router
- [x] 4.4 Add internal-note support: a `conversationService.postInternalNote(conversationId, agentId, body)` persisting `Message{ senderType: AGENT, internal: true }`; expose via a `chat.postInternalNote` mutation (`requireAbility("reply")`)
- [x] 4.5 Filter `internal` messages out of every merchant-facing path: the `chatGateway` merchant-room broadcast and the merchant-scoped history read (server is the choke point — never rely on the widget)
- [x] 4.6 Add the canned-reply picker (shortcut search + insert) and an internal-note toggle/composer to `app/routes/inbox.tsx`; render internal notes distinctly in the agent timeline

## 5. Assignment & routing rules (cp-conversation-routing)

- [x] 5.1 Add a `routingService.route(conversation)` that loads active `AssignmentRule`s ordered by `order`, applies first-match-wins, and returns the chosen `assignTo`/`setPriority`
- [x] 5.2 Make assignment presence-aware: when a rule targets an agent, assign only if `PresenceTracker` reports them online, else leave unassigned (queued)
- [x] 5.3 Invoke routing on new-conversation creation in `conversationService.getOrCreateForShop`; apply priority via the SLA path so due-times are computed
- [x] 5.4 Write a same-transaction audit row (`conversation.assigned`, before/after `assignedTo`) for both rule-driven and manual (re)assignment; reuse/extend the existing `chat.assign` mutation
- [x] 5.5 Add tRPC procedures to manage rules (`requireAbility("roles:manage")`) and a minimal ADMIN rules editor (list/create/toggle) — reuse the existing TanStack-Table conventions

## 6. CSAT + tags + search (cp-conversation-csat)

- [x] 6.1 Add a `csatService.record(conversationId, score, comment)` that validates score 1–5 and is idempotent (no overwrite once scored)
- [x] 6.2 Wire the merchant-facing CSAT prompt on conversation close through the existing widget transport into `csatService.record`; show captured CSAT in the agent conversation view
- [x] 6.3 Add conversation-tag methods (`addTag`/`removeTag`) honoring `@@unique([conversationId, label])`, gated by `requireAbility("reply")`, exposed via tRPC
- [x] 6.4 Add a `chat.search` procedure: server-side bounded query over shop, subject, tag label, and `Message.body` (`ILIKE`, capped + supporting index), server-paginated like the merchants grid; `log` when the cap truncates
- [x] 6.5 Add the search box + tag filter/chips to `app/routes/inbox.tsx` using the server-driven query (no client-side filtering of a full list)

## 7. Merchant 360 (cp-merchant-360)

- [x] 7.1 Add `merchantService.overview(appKey, shop)` composing (in parallel) the connector `getMerchant` + `getSubscription` (replica-only), CP notes/tags, the shop's conversations, and the per-shop audit trail (`AuditService.query({ merchantShop })`); carry one `asOf` for the connector portion
- [x] 7.2 Expose the overview via the `directory` tRPC router; keep PII masking + the audited `revealPii` reveal intact
- [x] 7.3 Rebuild `app/routes/merchant-detail.tsx` as the 360 panel: shop/plan/status (with `asOf`), billing, notes/tags, per-shop conversation history (link into the inbox), and the per-shop audit trail (newest first)
- [x] 7.4 Confirm no raw SQL / no primary access is introduced (all app reads via the connector replica path); `check-no-app-db-writes.mjs` stays green

## 8. Tests & verification

- [x] 8.1 SLA tests (FakeDb): due-times computed only within office hours; `NONE` priority never swept; `firstReplyAt` stamped once and not by an internal note; sweep marks overdue→`BREACHED`, near-due→`BREACHING`, replied-before-due→`MET`
- [x] 8.2 Internal-note test: a merchant-facing stream/history omits `internal` messages while the agent timeline includes them; an internal-note-only conversation counts as not-yet-replied
- [x] 8.3 Canned-reply tests: app-scoped unique shortcut enforced; SUPPORT can list/use but not manage (`FORBIDDEN`); variable substitution replaces known vars and preserves unknown placeholders
- [x] 8.4 Routing tests: first-match-wins by `order`; offline target ⇒ queued (unassigned); no match ⇒ unassigned; assignment audited in-tx and rolled back when the audit insert throws (`failAudit`)
- [x] 8.5 CSAT/tag/search tests: score validated 1–5 + idempotent; duplicate tag is a no-op; search matches by body and by tag and returns a bounded page
- [x] 8.6 Audit taxonomy tests: worker-originated rows carry `actorType: SYSTEM`/`source: JOB`; UI rows carry `INTERNAL`/`UI` + `actorEmail`; viewer filter by `source`; append-only preserved (no update/delete path)
- [x] 8.7 RBAC tests extended in `test/rbac.test.ts`: `canned:manage` is ADMIN-only; `reply`-gated procedures (priority, tags, internal note, canned use) reject VIEWER
- [x] 8.8 E2E (Playwright, mirroring the existing suite): inbox shows a priority + countdown chip for a seeded prioritized conversation; canned-reply insert works; merchant 360 renders conversation history + audit trail; internal note is hidden from the merchant view
- [x] 8.9 Run typecheck + unit tests + the lint guard (`check-no-app-db-writes.mjs`) green before declaring done

## 9. Configuration & dependencies

- [x] 9.1 Add the office-hours/SLA policy values (business timezone, daily open/close, per-priority budgets, breach warning window) via the validated `config.ts` module — no `process.env` access outside `config.ts`
- [x] 9.2 Confirm the open questions from `design.md` (business-hours window, per-priority budgets, CSAT UX/scale, canned variables, routing conflict resolution) with product before implementing the affected tasks
