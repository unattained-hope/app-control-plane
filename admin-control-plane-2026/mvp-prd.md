# PRD — Apoaap Control Plane (MVP)

> **Internal multi-app admin to manage the Apoaap Shopify-app portfolio.**
> MVP target: fully operational for **one tenant (SaleSwitch)**, with the multi-app seam built in so app #2 is a config change, not a rewrite.
>
> | | |
> |---|---|
> | **Status** | ✅ e2e verified — 23/23 Playwright tests passing (2026-06-28) |
> | **Author** | Engineering |
> | **Date** | 2026-06-22 |
> | **Derives from** | [`index.html`](./index.html) (stack & architecture research report; 24/25 claims verified) |
> | **Scope** | MVP only. v1 / Later items are explicitly out of scope (see §13). |

---

## 1. Overview & problem statement

Apoaap operates Shopify apps (SaleSwitch first; more to follow). Today there is **no unified place** for the team to see who the merchants are, handle their support questions, check their subscription state, or take safe administrative action. As the portfolio grows, per-app ad-hoc tooling won't scale.

**The MVP delivers one internal web app** where the support/admin/founder team can, for SaleSwitch:

1. **See and search merchants** (read from SaleSwitch's database).
2. **Take safe, audited actions** on a merchant.
3. **Handle support conversations** from an in-house chat widget embedded in the app.
4. **Read subscription/billing state** (sourced from Shopify).
5. **See per-app KPIs** on a dashboard.

…all behind **SSO + RBAC**, on a **zero-trust** network, with **every action audited**.

The control plane is treated as a **first-class application** (own SLA, auth, audit, tests) — not a throwaway dashboard. A top-bar **app-selector** exists from day one but only lists SaleSwitch in MVP.

---

## 2. Goals & non-goals

### 2.1 Goals (MVP)
- G1 — A support agent can find any SaleSwitch merchant in **< 5 seconds** and open a full detail view.
- G2 — A support agent can answer a merchant's chat message **end-to-end inside the admin app**.
- G3 — Every administrative action is **guarded** (confirmation) and **recorded** in an append-only audit log.
- G4 — The team authenticates via **company SSO**; access is **role-scoped** (admin / support / viewer).
- G5 — The architecture proves the **per-app connector seam**: SaleSwitch is wired through an `AppConnector`, and onboarding app #2 requires **no core changes**.
- G6 — The control plane **never writes to** and **never decrypts secrets in** an app's production database.

### 2.2 Non-goals (MVP — deferred)
- Multi-app live (only SaleSwitch connected).
- Full helpdesk feature set (routing, teams, CSAT, macros) — chat is a working loop, not a Chatwoot replica yet.
- Analytics-at-scale (ClickHouse/Tinybird), MRR forecasting, churn/health scoring.
- Feature-flag service, changelog/announcements, impersonation, on-call alerting.
- Self-serve onboarding of new apps via UI (registry edited by engineers in MVP).

---

## 3. Success metrics

| Metric | MVP target |
|---|---|
| Time-to-find a merchant | < 5 s (p95) |
| Chat first-response possible without leaving the app | 100% of conversations |
| Admin actions with a complete audit record | 100% |
| Unauthorized access attempts reaching the app | 0 (blocked at zero-trust gateway) |
| Reads hitting a SaleSwitch **primary** DB | 0 (all reads via read-replica) |
| Onboarding app #2: core files changed | 0 |

---

## 4. Personas & roles

| Persona | Uses it for | Role |
|---|---|---|
| **Support agent** | Find merchants, answer chats, add notes, run safe actions | `SUPPORT` |
| **Admin / founder** | Everything + dangerous actions + see audit log + manage roles | `ADMIN` |
| **Viewer / analyst** | Read dashboards & merchant data, no writes | `VIEWER` |
| **Merchant** (external) | Sends chat messages from inside the Shopify app | *(not an admin user; identified by `shop`)* |

**RBAC matrix (MVP):**

| Capability | ADMIN | SUPPORT | VIEWER |
|---|:--:|:--:|:--:|
| View merchants / dashboard | ✅ | ✅ | ✅ |
| Reply to chats, add notes/tags | ✅ | ✅ | ❌ |
| Run guarded merchant actions | ✅ | ✅* | ❌ |
| Run **dangerous** actions | ✅ | ❌ | ❌ |
| View audit log | ✅ | ❌ | ❌ |
| Manage roles / app registry | ✅ | ❌ | ❌ |

\* SUPPORT limited to the non-dangerous action set.

---

## 5. Locked reference stack (MVP)

| Layer | Choice | Notes |
|---|---|---|
| App framework | **React Router 7** (framework mode) | Persistent Node server (hosts WS + DB pools + workers) |
| API | **tRPC** | End-to-end types, single first-party client |
| ORM / control-plane DB | **Prisma 6 + PostgreSQL** | Control plane owns its **own** DB |
| Per-app reads | **Prisma client per app DB → read-replica** | via `@prisma/extension-read-replicas` — **verify Prisma 7 requirement** (see §14) |
| UI | **shadcn/ui** + Tailwind | + **TanStack Table/Query**, **Tremor** charts |
| Auth | **WorkOS AuthKit** | Google/Microsoft social login (free under scale) |
| RBAC | **CASL** + roles table | Owned policy layer |
| Realtime (chat) | **Socket.IO + Redis adapter** | Self-hosted |
| Jobs | **BullMQ + Redis** | KPI rollups, webhook ingestion |
| Inbox base | **Custom, modeled on Chatwoot** | Adopt Chatwoot fully in v1; MVP = minimal custom loop |
| Observability | **Sentry** | Errors + traces, app + workers |
| Hosting | **Containers** (Fly.io / Hetzner / ECS) | Co-located near SaleSwitch replica |
| Access | **Cloudflare Access / Tailscale** | Zero-trust in front of SSO |

> Rationale and alternatives for each are in the research report. This PRD treats them as decided.

---

## 6. System architecture (MVP)

```
Internal team
   │  (device + identity)
   ▼
[ Zero-trust gateway ]  Cloudflare Access / Tailscale
   │
   ▼
┌──────────────────────────────────────────────┐
│  CONTROL PLANE  (RR7 · tRPC · Prisma)         │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ App        │ │ RBAC +     │ │ Merchant   │ │
│  │ registry   │ │ Audit      │ │ mgmt       │ │
│  └────────────┘ └────────────┘ └────────────┘ │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ Billing    │ │ Dashboard  │ │ Support    │ │
│  │ (read)     │ │ (KPIs)     │ │ inbox      │ │
│  └────────────┘ └────────────┘ └────────────┘ │
│  ───── PER-APP CONNECTOR SEAM ─────            │
│        AppConnector(saleswitch)               │
└───────┬──────────────────┬───────────┬────────┘
        │ read-only        │ WS in     │ GraphQL
        ▼                  ▼           ▼
  SaleSwitch DB        Realtime     Shopify
  (READ REPLICA)       (Socket.IO)  (Billing API,
        ▲                  ▲         GDPR webhooks)
        │ control-plane    │ widget (embedded app,
        │ owns its OWN     │  CSP frame-ancestors,
        ▼ Postgres + Redis │  no blob: nav)
  [ Control-plane DB ]  [ Redis: BullMQ + Socket.IO adapter ]
```

**Hard rules (architecture invariants):**
- Reads of SaleSwitch data go **only** to its read-replica, through a **read-only DB role**.
- The control plane **never** writes to or decrypts secrets in an app DB. Raw SQL is avoided (it defaults to primary and bypasses replica routing).
- All admin **writes** land in the **control-plane's own DB** (notes, tags, conversations, audit) **or** go through a narrow, app-exposed admin API (see §9 E4).
- The app runs as a **persistent process** (not serverless).

---

## 7. Data model (MVP)

The control plane owns its **own Postgres**. Merchant business data is **read live** from the SaleSwitch replica via the connector — **not** copied here (except KPI rollups).

### 7.1 Control-plane tables

```prisma
// Mirrors WorkOS identity; role lives here.
model AdminUser {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  role      Role     @default(VIEWER)   // ADMIN | SUPPORT | VIEWER
  status    UserStatus @default(ACTIVE) // ACTIVE | DISABLED
  lastLogin DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// The tenant catalog / app registry.
model App {
  id            String   @id @default(cuid())
  key           String   @unique          // "saleswitch"
  name          String                     // "SaleSwitch"
  status        AppStatus @default(ACTIVE)
  themeTokens   Json?                      // accent/logo for per-app theming (v1)
  replicaRef    String                     // secrets-manager key, NOT a raw DSN
  enabledModules String[]                  // ["merchants","billing","chat","dashboard"]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// Append-only. Never updated or deleted.
model AuditLog {
  id          String   @id @default(cuid())
  actorUserId String
  appKey      String
  merchantShop String?                     // shop domain if action targets a merchant
  action      String                        // e.g. "merchant.note.add", "merchant.resync"
  target      String?
  before      Json?
  after       Json?
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())
  @@index([appKey, createdAt])
  @@index([merchantShop])
  @@index([actorUserId])
}

// Control-plane-owned annotations on a merchant (safe writes).
model MerchantNote {
  id        String   @id @default(cuid())
  appKey    String
  shop      String
  authorId  String
  body      String
  createdAt DateTime @default(now())
  @@index([appKey, shop])
}

model MerchantTag {
  id        String   @id @default(cuid())
  appKey    String
  shop      String
  label     String
  createdAt DateTime @default(now())
  @@unique([appKey, shop, label])
}

// Support inbox (in-house chat).
model Conversation {
  id          String   @id @default(cuid())
  appKey      String
  shop        String
  status      ConvStatus @default(OPEN)     // OPEN | SNOOZED | CLOSED
  assignedTo  String?                        // AdminUser id (manual assign in MVP)
  subject     String?
  unreadCount Int      @default(0)
  lastMessageAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([appKey, status, lastMessageAt])
  @@index([shop])
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  senderType     SenderType                 // MERCHANT | AGENT | SYSTEM
  senderId       String                      // shop or AdminUser id
  body           String
  createdAt      DateTime @default(now())
  @@index([conversationId, createdAt])
}

// Pre-aggregated KPIs (refreshed by BullMQ). Dashboard reads these, not live joins.
model KpiSnapshot {
  id        String   @id @default(cuid())
  appKey    String
  metric    String                          // "active_merchants", "mrr", ...
  value     Float
  asOf      DateTime
  createdAt DateTime @default(now())
  @@index([appKey, metric, asOf])
}
```

### 7.2 The connector contract (the multi-app seam)

```ts
interface AppConnector {
  key: string;                                   // "saleswitch"
  db: PrismaClient;                              // read-only role, replica URL
  listMerchants(q: MerchantQuery): Promise<MerchantRow[]>;
  getMerchant(shop: string): Promise<MerchantDetail>;
  getSubscription(shop: string): Promise<SubscriptionState>;  // reads Shopify state
  computeKpis(): Promise<Kpi[]>;                  // run by a BullMQ rollup job
  actions: GuardedAction[];                       // app-specific safe actions (§9 E4)
}
```

Each app maps **its own schema** → these common shapes. The core never sees raw app tables.

---

## 8. Functional requirements

Each epic has user stories and **testable acceptance criteria (AC)**.

### E1 — Authentication, SSO & RBAC
**Story:** As a team member, I sign in with my company Google/Microsoft account and only see what my role allows.
- AC1.1 — Unauthenticated requests are rejected at the zero-trust gateway **and** the app.
- AC1.2 — Sign-in uses WorkOS AuthKit (Google/Microsoft social login); first login provisions an `AdminUser` (default `VIEWER`).
- AC1.3 — Role is enforced server-side in **tRPC middleware via CASL** — not just hidden in the UI. A `VIEWER` calling a write procedure gets `FORBIDDEN`.
- AC1.4 — An `ADMIN` can change another user's role; the change is audited.
- AC1.5 — Sessions expire; re-auth required after expiry.

### E2 — App registry & SaleSwitch connector
**Story:** As the system, I load active apps and route data through the right connector.
- AC2.1 — `App` registry seeded with SaleSwitch; top-bar selector lists it (and only it).
- AC2.2 — The SaleSwitch connector holds **one long-lived** Prisma client, replica URL, **read-only** role, resolved from secrets manager (no raw DSN in code/env files).
- AC2.3 — All reads route to the **replica**; a smoke test asserts no statement runs against the primary.
- AC2.4 — Adding a hypothetical second app requires only a new connector module + registry row — **proven by a stub connector test**, no core file edits.

### E3 — Merchant listing & detail
**Story:** As support, I search/sort/filter merchants and open a full profile.
- AC3.1 — Paginated, virtualized table (TanStack Table) with server-side search by shop domain / name / email and sort by install date, plan, status.
- AC3.2 — p95 search-to-result < 5 s on the production dataset.
- AC3.3 — Detail view shows: shop info, install/status/lifecycle, plan/subscription (E6), recent activity, notes (E4), tags, and a deep-link to the merchant's Shopify/Partner context.
- AC3.4 — Every field is **read-only** w.r.t. the app DB; data shows an **"as of" timestamp** acknowledging replica lag.

### E4 — Merchant actions (guarded + audited)
**Story:** As support/admin, I take safe actions on a merchant without risking data corruption.
- AC4.1 — **Control-plane-owned writes** (add/edit note, add/remove tag) work and are audited.
- AC4.2 — **App-backed actions** (e.g. "resend onboarding email", "force re-sync") call a **narrow, authenticated admin API exposed by SaleSwitch** — the control plane never mutates the app DB directly. *(Dependency: SaleSwitch exposes ≥1 such endpoint — see §12.)*
- AC4.3 — Every action shows a **type-to-confirm guard**; **dangerous** actions are `ADMIN`-only.
- AC4.4 — Every action writes an `AuditLog` row with actor, target, before/after, IP, UA. **No action can succeed without an audit record** (same transaction / guaranteed write).

### E5 — Audit log
**Story:** As an admin, I can review who did what.
- AC5.1 — Append-only; no update/delete path exists in code.
- AC5.2 — `ADMIN`-viewable, filterable by user / app / merchant / action / date.
- AC5.3 — Captures all E1 role changes and all E4 actions.

### E6 — Subscription / billing (read-only)
**Story:** As the team, I see each merchant's plan and billing state.
- AC6.1 — Subscription state is **read from Shopify** (`currentAppInstallation.activeSubscriptions` via Admin API, per shop) — the control plane does **not** own a billing ledger.
- AC6.2 — Detail view shows plan, status (active/trial/cancelled), price, current period.
- AC6.3 — Reads are cached (short TTL) to respect Shopify rate limits; cache miss falls back gracefully.

### E7 — Support chat (in-house) — MVP loop
**Story (merchant):** From inside the SaleSwitch app, I open a chat widget and send a message.
**Story (agent):** That message appears in my admin inbox and I reply in real time.
- AC7.1 — **Widget** ships in SaleSwitch's embedded admin; it works **within** Shopify's per-shop CSP `frame-ancestors` (shop domain + `admin.shopify.com`); it does **not** open a separate top-level window.
- AC7.2 — Widget authenticates to the realtime backend with a **host-minted, shop-scoped session token** (cross-origin handshake, CORS explicit).
- AC7.3 — Transport is **Socket.IO + Redis adapter**; messages persist to `Conversation`/`Message`.
- AC7.4 — **Agent inbox** in the admin app: list of conversations (open/closed), real-time message stream, send reply, unread counts, manual assignment.
- AC7.5 — Attachments are **streamed from a real URL** (no `blob:` navigation in the iframe — Firefox blocks it).
- AC7.6 — When no agent is online, the merchant sees a graceful "we'll email you" fallback; the conversation is queued.

### E8 — Per-app KPI dashboard
**Story:** As the team, I see SaleSwitch's headline numbers.
- AC8.1 — Dashboard reads **pre-aggregated `KpiSnapshot`** rows (refreshed by a scheduled **BullMQ** rollup job against the replica) — **no live joins** on production data.
- AC8.2 — MVP KPIs: active merchants, new installs (7/30d), uninstalls, plan distribution, total MRR (from E6). Rendered with **Tremor** cards/charts.
- AC8.3 — Each KPI shows its `asOf` timestamp.

### E9 — Infrastructure, observability & access
- AC9.1 — App deployed as a **persistent container** co-located near the SaleSwitch replica; **not** serverless.
- AC9.2 — Fronted by **zero-trust** (Cloudflare Access / Tailscale); not reachable on the open internet.
- AC9.3 — **Sentry** captures errors + traces for both web requests and BullMQ workers; alerts to Slack.
- AC9.4 — Secrets (replica creds, WorkOS, Shopify) live in a **secrets manager**, injected at runtime; encryption keys are **never** co-located with the read-only role.
- AC9.5 — CI runs typecheck, unit tests, and the connector smoke/replica tests before deploy.

---

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | SSO + server-enforced RBAC; zero-trust network; least-privilege read-only DB role per app; append-only audit; no secret decryption in the admin plane; type-to-confirm + ADMIN-gate on dangerous actions. |
| **Privacy** | Read-only on merchant PII; access logged; honor the data-minimization principle (don't copy app data into the control plane beyond rollups). |
| **Performance** | Merchant search p95 < 5 s; dashboard from pre-aggregated rows; replica targeting keeps load off app primaries. |
| **Reliability** | Persistent process; BullMQ retries for rollups/webhooks; graceful degradation if Shopify/replica is slow (cached + "as of"). |
| **Maintainability** | Connector seam isolates app-specific code; contract tests per connector; consistent with the team's existing Prisma/BullMQ patterns. |
| **Observability** | Sentry errors + traces; structured logs; health endpoint; replica-lag visible in UI. |

---

## 10. Dependencies & assumptions
- **D1** — A **read-replica** of the SaleSwitch DB exists (or is provisioned) with a dedicated **read-only role**.
- **D2** — SaleSwitch exposes (or will expose) **≥1 narrow, authenticated admin API endpoint** for any mutating merchant action (E4.2). Without it, MVP actions are limited to control-plane-owned notes/tags.
- **D3** — WorkOS account + Google/Microsoft OAuth configured for the company domain.
- **D4** — Shopify app credentials/scopes permit reading `activeSubscriptions` for managed shops.
- **D5** — Decision on **adopt vs. fork Chatwoot** is deferred to v1; MVP builds the minimal custom loop on its data model.
- **D6** — `@prisma/extension-read-replicas` version compatibility with Prisma 6 confirmed, **or** an upgrade path agreed (see §14).

---

## 11. Milestones (maps to roadmap Phases 0–2)

| # | Milestone | Exit criteria | Indicative |
|---|---|---|---|
| **M0** | Foundations | RR7+tRPC+Prisma scaffold; WorkOS auth + CASL RBAC; zero-trust; Sentry; CI/CD; `AuditLog` + `AppConnector` interface committed | ~1–2 wks |
| **M1** | Merchant ops | SaleSwitch connector on replica; merchant list + detail; guarded+audited actions; subscription read | ~3–4 wks |
| **M2** | Support inbox | Embedded widget (CSP-safe); Socket.IO+Redis; persisted conversations; agent inbox | ~3–5 wks |
| **M3** | Dashboard + hardening | KPI rollup jobs + Tremor dashboard; replica-lag surfacing; security review; **MVP ship** | ~1–2 wks |

---

## 12. Out of scope (explicitly deferred)

| Deferred to | Items |
|---|---|
| **v1** | Module/plugin system + per-app theming; onboard app #2 for real; full helpdesk (routing/teams/notes/canned/CSAT via Chatwoot); feature flags; compliance-webhook monitor; MRR/churn/health dashboards; impersonation; connector contract-test suite. |
| **Later** | ClickHouse/Tinybird analytics; decouple hot apps to API/CDC; OpenTelemetry/Grafana; on-call alerting; two-person approval; OpenFGA/Oso; enterprise SSO connection. |

---

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `@prisma/extension-read-replicas` needs Prisma 7 (apps on 6) | Blocks replica routing | Verify in M0; isolate Prisma version in the control plane (own DB) or upgrade path |
| No app-exposed admin API for mutating actions | E4 actions limited | Ship MVP with control-plane-owned actions (notes/tags); track app API as a parallel dependency |
| Embedded-iframe CSP / cross-origin handshake friction | Chat widget fails in some browsers | Early spike against real embedded app + Firefox `blob:` rule; CSP handled by `shopify-app-react-router` |
| Schema coupling to SaleSwitch | Silent breakage on app schema change | Connector maps raw→common shape; add a smoke/contract test in M1 |
| Replica lag confuses agents | Trust issues | Show "as of" timestamps everywhere reads are displayed |

---

## 14. Open questions (decide before/at M0)

1. **Prisma 7 requirement** for the read-replicas extension — verify compatibility or commit to an upgrade for the control plane.
2. **UI library** — confirm **shadcn/ui** vs Mantine with a half-day spike on the real merchant grid (judgment call, not yet sourced).
3. **Realtime transport** — confirm **Socket.IO** vs managed (Ably) after testing the embedded cross-origin handshake.
4. **Hosting target** — pick **Fly.io vs Hetzner vs ECS** based on where the SaleSwitch replica physically lives (co-location wins).
5. **Mutating actions** — what is the first SaleSwitch admin-API endpoint (E4.2), and who owns building it?

---

## Appendix A — Environment / config (control plane)

| Var | Purpose |
|---|---|
| `CONTROL_PLANE_DATABASE_URL` | Control-plane's own Postgres |
| `SALESWITCH_REPLICA_URL` | Read-replica DSN (read-only role) — via secrets manager |
| `REDIS_URL` | BullMQ + Socket.IO adapter |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` | Auth |
| `SHOPIFY_*` | Admin API creds/scopes for subscription reads |
| `SENTRY_DSN` | Observability |

> Access `process.env` only through a single validated config module (zod), mirroring the SaleSwitch/Badgy convention.

## Appendix B — Acceptance test checklist (ship gate)
- [x] VIEWER cannot call any write procedure (server-enforced). *(audit-rbac + compliance + ops-tier2 e2e)*
- [ ] 0 statements hit the SaleSwitch primary (replica smoke test green). *(needs unit/integration test — not Playwright)*
- [x] Every E4 action produces an AuditLog row in the same transaction. *(merchant-detail add-note e2e)*
- [x] Dashboard renders from `KpiSnapshot`, not live joins. *(dashboard e2e — KPI tiles render)*
- [ ] Chat round-trip works in Chrome **and** Firefox inside the embedded app. *(Chrome verified; Firefox widget e2e deferred)*
- [ ] App is unreachable without passing the zero-trust gateway. *(infrastructure — not Playwright)*
- [ ] Stub second-app connector loads with no core file changes. *(unit test — not Playwright)*
