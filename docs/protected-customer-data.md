# Protected-Customer-Data (PCD) governance — Level 2 controls

> Shopify's Protected Customer Data requirements (Level 2) for any app/tool that can
> read customer name/address/phone/email. This control plane reads merchant PII from
> the SaleSwitch replica, so the Level-2 set applies. Status of each control below.
>
> Re-verify the current Level 1/2 control list on shopify.dev before each App Store
> submission — Shopify changes it.

| Level-2 control | Status | Where / evidence |
|---|---|---|
| **Limit staff access to PII** | ✅ Code | `pii:view` ability in [app/server/rbac.ts](../app/server/rbac.ts); merchant email is **masked by default** in the read path ([app/server/services/merchantService.ts](../app/server/services/merchantService.ts) via [app/lib/pii.ts](../app/lib/pii.ts)). |
| **Keep an access log to PII** | ✅ Code | Every reveal goes through the audited `revealPii` mutation, which writes a `merchant.pii.view` row (actor + shop + **typed reason**) to the append-only [AuditLog](../app/server/services/auditService.ts). No code path returns raw PII without that log. |
| **Encrypt data backups** | ⛏️ Ops | The control-plane Postgres **and** the SaleSwitch replica must have encryption-at-rest enabled on their managed backups. Confirm with the hosting provider (Fly.io/Hetzner/ECS + RDS/managed PG). Encryption keys are never co-located with the read-only replica role (config invariant, AC9.4). |
| **Keep test and production data separate** | ⛏️ Ops + ✅ Partial | The control plane owns its **own** Postgres (separate from any app DB) and reads app data **only** through a read-only replica role — no test/prod commingling in the control plane. Document the boundary in the deploy runbook; ensure non-prod environments point at non-prod databases. |
| **Security incident-response policy** | ⛏️ Doc | Maintain a written IR policy (detection → containment → eradication → recovery → post-mortem). The append-only audit trail (PII access, compliance fulfilment, role changes) is the evidentiary record for investigations. |

## Data minimization (supporting invariant)

- Reads of SaleSwitch data go **only** to the read replica through a read-only role.
- The control plane copies **no** merchant PII into its own DB (only KPI rollups,
  notes/tags authored by staff, and compliance/webhook metadata).
- Merchant email is masked at a single server-side choke point; the raw value is
  only ever returned through the audited reveal.

## Action items before submission

- [ ] Confirm encryption-at-rest on control-plane + replica backups (ops).
- [ ] Confirm non-prod environments use non-prod databases (ops).
- [ ] Publish the written incident-response policy and link it here (doc).
- [ ] Re-verify the current Shopify Level 1/2 control list on shopify.dev.
