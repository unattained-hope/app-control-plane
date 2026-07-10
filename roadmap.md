# Apoaap Control Plane — Feature Roadmap

> Prioritized, tiered roadmap for evolving the Control Plane from its current MVP into a
> mature internal ops/admin console for the Apoaap Shopify-app portfolio (first tenant:
> **SaleSwitch / Badgy**, a timed discount-campaign app).
>
> Derived from a deep, multi-source, adversarially-verified research pass (2026-06-25),
> cross-referenced against the current codebase. Sources are listed at the bottom; each
> recommendation notes whether it rests on **verified primary sources** or general
> best practice.

## How to read this

Features are grouped into four tiers. Each carries **what / why / effort / which existing
seam it reuses / build-vs-buy**.

- 🔴 **table-stakes / mandatory** for Shopify App Store apps
- 🟢 **fast win** on a seam we already have
- 🔵 **scale-readiness** (build as merchant/app count grows)
- ⚪ **later / strategic**

**Current surface (MVP):** KPI dashboard, merchants directory + detail, support inbox with
realtime chat, append-only audit viewer, notes/tags, **stubbed** billing, app registry.

**Stack / seams to reuse:** React Router 7 · tRPC v11 · Prisma 6 (own Postgres) · CASL RBAC
· WorkOS AuthKit SSO · Socket.IO + Redis · BullMQ · Tremor · TanStack Table/Query · Sentry
· replica-only reads · same-transaction append-only audit log · multi-app connector seam ·
KpiSnapshot rollups.

---

## Tier 0 — Mandatory (Shopify App-Store-gating). Do these first.

These block App Store approval or impose controls **directly on a tool like this control
plane**. Since Badgy ships through the App Store, this is the floor.

### 0.1 🔴 GDPR / Data-Subject-Request (DSR) handling surface
- **What:** Ingest, HMAC-verify, and action the three mandatory compliance webhooks —
  `customers/data_request`, `customers/redact`, `shop/redact` — with a **30-day SLA timer**
  and an audit trail of every export/redaction.
- **Why:** *"Any app you distribute through the Shopify App Store must respond to data subject
  requests, regardless of whether the app collects personal data… If you don't provide URLs
  for the mandatory compliance webhooks… your app will be rejected."* Must subscribe + verify
  all three **before review**, respond `200`, complete within **30 days**.
  (Source: Shopify privacy-law-compliance — confidence: **high**)
- **Effort:** M. **Seam:** BullMQ (queue export/redaction jobs) + append-only `AuditLog`
  (record fulfilment) + connector (data lives in Badgy's DB). Add a `ComplianceRequest` model
  with a due-date to drive the SLA timer.
- **Build-vs-buy:** **Build** — thin webhook→job→audit flow on existing rails; must touch
  Badgy's own data.

### 0.2 🔴 Protected-Customer-Data (PCD) governance controls
- **What:** The Level 2 control set Shopify mandates for any tool that can read
  name/address/phone/email: **limit staff access** to PII, **log every access** to PII,
  **encrypted backups**, **test/prod separation**, **incident-response policy**.
- **Why:** Shopify's PCD doc is effectively a design spec for our RBAC + audit + PII-access
  modules: *"Limit staff access to protected customer data," "Keep an access log to protected
  customer data," "Encrypt your data backups," "Keep test and production data separate,"
  "Implement security incident response policy."*
  (Source: Shopify protected-customer-data — confidence: **high**)
- **Effort:** S–M (much is policy + small code). **Seam:** CASL RBAC (`app/server/rbac.ts`)
  for access-limiting; `AuditLog` for the PII-access log; the replica-only-read invariant
  already gives read minimization.
- **Note:** This is the verified anchor that turns the security/governance tier (§2.5) from
  optional into required.

### 0.3 🔴 Billing & subscription monitoring (un-stub `billingService`)
- **What:** Replace `StubShopifySubscriptionReader` with the real reader; subscribe to
  **`APP_SUBSCRIPTIONS_UPDATE`** (status/charge changes) and
  **`APP_SUBSCRIPTIONS_APPROACHING_CAPPED_AMOUNT`** (fires at ≥90% of cap); track usage
  against `cappedAmount`.
- **Why:** Documented signals for subscription lifecycle, revenue monitoring, and
  cap-exhaustion alerting — and the foundation for churn/uninstall handling.
  (Source: Shopify billing/webhook docs — confidence: **high**)
- **Caveat:** These are conditional "subscribe-to-receive" signals, **not** rejection-gating
  like the GDPR webhooks; `APP_SUBSCRIPTIONS_UPDATE` does **not** fire on every monthly
  auto-renewal — don't rely on it as a heartbeat.
- **Effort:** M. **Seam:** `app/server/services/billingService.ts` (seam already exists,
  stubbed) + BullMQ for webhook processing + `KpiSnapshot` for MRR/usage rollups. **Build.**

---

## Tier 1 — Fast wins on seams we already have

High value, low effort because the model + plumbing largely exist. Mostly **enhancements**,
not greenfield.

| # | Feature | Why it matters | Effort | Reuses |
|---|---------|----------------|--------|--------|
| 1.1 🟢 | **Support inbox: SLA timers + priority** | Mature inbox = first-reply / next-reply / resolution timers, **priority-keyed** ("no priority ⇒ no SLA"), measured against **office hours** (8 calendar hrs = 1 business day). Separates a real desk from a shared inbox. (Zendesk/Intercom, **high**) | S | Add `priority` + `firstReplyAt`/`dueAt` to `Conversation`; a BullMQ job flips "breaching" state |
| 1.2 🟢 | **Canned replies / macros + internal notes** | Biggest per-ticket time saver. Internal notes = agent/system-only visibility already modeled via `SenderType`. | S | `Message` (`senderType` already distinguishes); new `CannedReply` table |
| 1.3 🟢 | **Assignment & routing rules** | Auto-assign by app/keyword/plan; Intercom's pattern routes on attributes (e.g. faster SLA + team assign for high-spend customers). `assignedTo` exists — make it rule-driven. | S–M | `Conversation.assignedTo` + presence (`app/server/realtime/presence.ts`) |
| 1.4 🟢 | **CSAT + conversation tagging/search** | Closes the support loop; tags power triage + reporting. *(Standard desk feature; not independently verified in research.)* | S | `Conversation` + `csatScore` field; reuse TanStack Table for search |
| 1.5 🟢 | **Merchant 360 detail panel** | One screen joining replica reads (plan, install date, campaign counts) + notes/tags + conversation history + audit trail for that shop. Speeds support *and* success. | M | connector + `MerchantNote`/`MerchantTag` + `AuditLog` (`merchantShop` index exists) |
| 1.6 🟢 | **Audit log: structured events + before/after diffs + actor source** | Best practice: capture actor (id/email/internal-vs-customer), **structured event type** (not free-text), before/after diff, entity type+id, UTC-ms timestamp, **source** (UI/API/job). Schema already has `before`/`after` JSON + actor + `target` — formalize the event taxonomy. (blog-quality) | S | `AuditLog` (already append-only, same-transaction) |

---

## Tier 2 — Scale-readiness (ops resilience)

### 2.1 🔵 Portfolio health / monitoring dashboard
- **What:** Per-app tiles: BullMQ queue backlog & failure counts, webhook delivery failures,
  Sentry error rate, uptime. One pane across the portfolio.
- **Why:** BullMQ ships a **first-party** `exportPrometheusMetrics()` exposing
  `bullmq_job_count{queue,state}` (waiting/active/completed/failed) + completed/failed
  counters — **no third-party exporter needed**. (Source: BullMQ docs — **high**)
- **Effort:** M. **Seam:** BullMQ (we already run `app/server/workers/kpiRollup.ts`) +
  Tremor charts + `KpiSnapshot` rollups. **Build the queue/error instrumentation natively.**

### 2.2 🔵 SLO-based alerting & on-call policy
- **What:** Move from ad-hoc thresholds to **multiwindow multi-burn-rate** alerts. Google
  SRE's 99.9% baseline: **page** at 14.4× (1h/5m, 2% budget), **page** at 6× (6h/30m, 5%),
  **ticket** at 1× (3d/6h, 10%).
- **Why:** Fires only while error budget is *actively* burning → far fewer false pages.
  (Source: Google SRE Workbook — **high**)
- **Caveat:** MWMBR fits poorly at very low traffic — relevant while Badgy still has few
  merchants; start simpler and graduate.
- **Effort:** M. **Build-vs-buy:** **Buy the plumbing** (alerting/on-call via monitoring
  vendor); the *policy* is what we author.

### 2.3 🔵 Public status page + synthetic checks (merchant-facing)
- **What:** Branded status page on a subdomain + Playwright-based synthetic transaction
  checks (real Chrome, screenshots on failure).
- **Why:** First merchant-facing surface. Incident comms cadence: minor every 60 min,
  major/critical every 15–20 min. (Better Stack — **high**; incident.io — blog)
- **Effort:** S (buy). **Build-vs-buy:** **Buy** (Better Stack / Statuspage / Hyperping) —
  cheaper than building; Playwright is already in-repo for the synthetic scripts.

### 2.4 🔵 Webhook reliability layer
- **What:** Treat all Shopify webhooks (GDPR, billing, uninstall) as **at-least-once**:
  dedupe by delivery-id/content-hash, persist + retry with backoff, dead-letter queue, and a
  "failed deliveries" view.
- **Why:** *"Assume at-least-once delivery. Duplicates happen during network blips, deploys,
  and retries."* (integrate.io — blog)
- **Effort:** M. **Seam:** BullMQ (retries/DLQ) + `AuditLog`. **Build.**

### 2.5 🔵 Deeper RBAC + justified PII access ("break-glass")
- **What:** Go beyond ADMIN/SUPPORT/VIEWER toward resource-scoped grants; require a **typed
  reason** to view PII or impersonate, with manager approval for sensitive accounts, all
  logged.
- **Why:** Tiered RBAC prevents horizontal data exposure as we grow; impersonation should
  require explicit role + a required reason, manager approval for sensitive; break-glass is
  the documented pattern. Directly satisfies Shopify PCD §0.2.
  *(General best practice — blog-quality sources; not independently verified.)*
- **Effort:** M. **Seam:** CASL (`app/server/rbac.ts`) + `AuditLog`. **Build** (we own the
  RBAC layer via CASL).

---

## Tier 3 — Later / strategic (growth & retention)

| # | Feature | Notes | Effort | Build-vs-buy |
|---|---------|-------|--------|--------------|
| 3.1 ⚪ | **Merchant health scoring & churn signals** | Derive from billing webhooks + usage + last-active. Foundation exists once §0.3 lands. *(Not independently verified.)* | M | Build on `KpiSnapshot` |
| 3.2 ⚪ | **App-uninstall / churn flow** | Handle `app/uninstalled`; reconcile data-retention vs the 30-day redaction SLA + subscription cancel. *(Open question — re-verify exact flow.)* | M | BullMQ + `ComplianceRequest` |
| 3.3 ⚪ | **Feature flags / staged rollout** | Per-merchant flags to dark-launch Badgy features. | M | **Buy** for targeting/experiments (LaunchDarkly/Flagsmith/Unleash); **build** only a simple boolean registry — `App.enabledModules` is already a primitive version |
| 3.4 ⚪ | **In-app announcements / changelog + NPS** | Broadcast to merchants via the in-app support widget; collect NPS. | S–M | Reuse chat gateway (`app/server/realtime/chatGateway.ts`). **Build** small, or **buy** (Beamer/Canny) |
| 3.5 ⚪ | **Self-serve billing portal (merchant-facing)** | Lets merchants change plan without a ticket. Depends on §0.3. | L | Build on `billingService` |

---

## Build-vs-buy summary

| Area | Verdict | Why |
|------|---------|-----|
| GDPR/DSR, billing webhooks, webhook reliability, merchant 360, audit | **Build** | Thin flows on seams we own (BullMQ/audit/connector); must touch Badgy's data |
| Support inbox enhancements | **Build** | We already have `Conversation`/`Message` + chat gateway; past the buy-vs-build line |
| Queue/error instrumentation | **Build** | BullMQ's native Prometheus export makes it nearly free |
| Status page + synthetic monitoring | **Buy** | Mature hosted options cheaper than building; first merchant-facing surface |
| Alerting/on-call infra | **Buy infra, author policy** | Don't reinvent paging; the SLO policy is ours |
| Feature flags w/ targeting | **Buy** (or trivial build) | `enabledModules` already covers the trivial case |
| Error monitoring | **Already bought** (Sentry wired) | Surface its rates in §2.1 |

---

## Suggested first sprint

1. **§0.1 GDPR/DSR surface** + **§0.3 un-stub billing** — clears the Shopify-gating floor and
   lights up real revenue data.
2. **§1.1 + §1.2 inbox SLA/macros** — immediate daily payoff for the support team on a model
   that already exists.
3. **§2.1 monitoring tiles (BullMQ-native)** — cheap, and needed the moment app #2 onboards.

---

## Honest gaps (re-verify before building)

Research was **strongest on Shopify mandates + SLA/SLO/tooling** (all primary-sourced,
high-confidence). It **did not surface verified claims** for: RBAC least-privilege mechanics,
immutable/tamper-evident audit design, SOC 2 control mapping, churn scoring, feature-flag
tooling specifics, NPS. Those rest on **blog-quality best practice**, not verified primary
sources.

Shopify platform rules change often — **re-verify webhook topic names, the Level 1/2 PCD
control lists, and billing-webhook behavior on shopify.dev** before implementing (verified
against "latest" as of June 2026).

---

## Sources

**Primary (high-confidence):**
- Shopify — Privacy law compliance / mandatory webhooks: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- Shopify — Privacy requirements: https://shopify.dev/docs/apps/launch/privacy-requirements
- Shopify — Protected customer data (Level 1/2): https://shopify.dev/docs/apps/launch/protected-customer-data
- Shopify — Usage-based subscriptions / billing: https://shopify.dev/docs/apps/launch/billing/manual-pricing/subscription-billing/create-usage-based-subscriptions
- Shopify — WebhookSubscriptionTopic enum: https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic
- Zendesk — Defining and using SLA policies: https://support.zendesk.com/hc/en-us/articles/4408829459866-Defining-and-using-SLA-policies
- Intercom — Set SLAs for conversations and tickets: https://www.intercom.com/help/en/articles/6546152-set-slas-for-conversations-and-tickets
- Intercom — Best practices for inbox rules: https://www.intercom.com/help/en/articles/6559143-best-practices-for-inbox-rules
- Google SRE Workbook — Alerting on SLOs: https://sre.google/workbook/alerting-on-slos/
- BullMQ — Prometheus metrics: https://docs.bullmq.io/guide/metrics/prometheus
- Better Stack — Status page: https://betterstack.com/status-page · Playwright monitor: https://betterstack.com/docs/uptime/playwright-monitor

**Secondary / best-practice (blog-quality):**
- SaaS admin panel modules: https://www.sequenzy.com/blog/how-to-build-saas-admin-panel
- User-impersonation tooling: https://yaro-labs.com/blog/user-impersonation-tool-saas
- Audit logs for SaaS: https://yaro-labs.com/blog/audit-logs-for-saas
- Secure internal dashboards / tiered RBAC: https://blog.tooljet.com/build-secure-internal-dashboards-for-enterprises/
- Least privilege for PII: https://hoop.dev/blog/least-privilege-for-pii-why-strict-access-controls-matter
- Break-glass account management: https://www.britive.com/resource/blog/break-glass-account-management-best-practices
- SOC 2 database security: https://www.liquibase.com/resources/guides/soc-2-compliance-for-database-security-trust-services-criteria-best-practices
- Feature management build-or-buy: https://launchdarkly.com/blog/feature-management-platform-build-or-buy/
- Incident management best practices: https://incident.io/blog/incident-management-best-practices-2026
- Webhook best practices: https://www.integrate.io/blog/apply-webhook-best-practices/
- SaaS monitoring: https://uptimerobot.com/knowledge-hub/monitoring/saas-monitoring-how-to-monitor-saas-applications-effectively/
