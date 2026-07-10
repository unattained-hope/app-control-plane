# Self-serve billing (cp-self-serve-billing)

A **merchant-facing** flow that lets a merchant change plan without opening a ticket.
The control plane holds **no per-shop Shopify token** and **never mutates billing or the
app DB** — it records the request and **dispatches** the mutation to the SaleSwitch app.

## Surface + auth

`/api/self-serve-billing` (RR7 resource route), authenticated by the **host-minted,
shop-scoped token** (the same mechanism as the chat widget — *not* CASL, because the
actor is a merchant). With explicit CORS (`isAllowedOrigin`).

- `GET` → `{ current: SubscriptionState, plans: string[] }` — current subscription read
  through `billingService.getSubscription` (TTL-cached, stale-while-error; a live-read
  failure degrades to a clearly-marked stale/unavailable state, never an error).
- `POST { toPlan }` → records a `PlanChangeRequest` and dispatches it.

## Dispatch contract (open question §5 / PRD D2 / §14.5)

When the narrow SaleSwitch admin API is configured (`SALESWITCH_ADMIN_API_URL` +
`SALESWITCH_ADMIN_API_TOKEN`), the change is POSTed to
`${SALESWITCH_ADMIN_API_URL}/admin/billing/plan-change` with
`{ shop, requestId, toPlan }` (the same pattern as the compliance dispatch). The app
performs the Shopify **managed-pricing** mutation and returns
`{ confirmationUrl?, jobId? }`; the control plane records `confirmationUrl` and audits
`billing.plan.change.dispatched` (or `.failed`). The merchant is directed to the
confirmation URL to approve on Shopify.

**Who owns the endpoint:** the SaleSwitch app team (PRD D2 / open question §14.5). This
change builds the control-plane seam + the merchant-facing surface that consume it. The
plan **catalog** is currently a placeholder (`DEFAULT_PLAN_CATALOG`) until the admin API
exposes the live managed-pricing catalog.

## Fallback (no admin API)

When the admin API is **not** configured, a request degrades to opening a **support
conversation** capturing the requested plan (`conversationId` recorded) — never a direct
billing mutation. The merchant is still served and the request is tracked; this is the
status quo (a ticket) with the request now first-class.

## Audit

Every transition is audited: `billing.plan.change.requested` → `.dispatched` /
`.failed`. The admin **Plan requests** route (`view`-gated) lists requests + status.
