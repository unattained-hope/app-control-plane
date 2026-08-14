# SaleSwitch production deployment plan

Status: proposed lean launch architecture
Prepared: 2026-08-09
Scope: the public SaleSwitch Shopify app plus the private Apoaap control plane

## 1. Recommendation

Start with a deliberately small hybrid deployment:

```text
Shopify merchants
       |
       | HTTPS
       v
Cloudflare DNS/proxy (free plan)
       |
       v
GCP Compute Engine: saleswitch-app-1
  Caddy -> SaleSwitch Node web process
  SaleSwitch BullMQ workers (same VM initially)
  Redis 7 (local, persistent volume)
       |
       v
GCP Cloud SQL for PostgreSQL: saleswitch-prod
  single-zone, shared-core, automated backups + PITR

Internal staff
       |
       | Cloudflare Access or Tailscale
       v
Oracle Always Free VM: apoaap-control-plane
  Caddy -> control-plane Node/Socket.IO process
  control-plane BullMQ workers
  control-plane PostgreSQL (local)
  control-plane Redis (local)
       |
       | Cloud SQL Auth Proxy + read-only DB role
       v
SaleSwitch Cloud SQL (read-only control-plane access)
```

This keeps the public app and its database in the same GCP region, gives the most
important data a managed database and recovery path, and uses the existing Oracle
capacity for the low-traffic internal panel. It also matches both repositories' current
runtime model: persistent Node processes, BullMQ, Redis, and PostgreSQL.

Do **not** launch with GKE, Memorystore, Cloud SQL HA, a read replica, Cloud NAT, or a
Google external Application Load Balancer. Each is useful later, but none is justified
before real merchant load or revenue.

## 2. Initial service inventory

| Concern | Initial service | Initial size/configuration | Reason |
|---|---|---|---|
| SaleSwitch web + workers | GCE `e2-small` VM | 2 shared vCPU, 2 GB RAM, 30 GB balanced disk, Ubuntu LTS | Cheapest simple persistent runtime; web and workers can share one host at low load |
| Public ingress/TLS | Caddy on the VM + Cloudflare DNS/proxy free plan | Static GCP IPv4, ports 80/443 only | Avoids a paid GCP load balancer while providing automatic TLS |
| SaleSwitch database | Cloud SQL PostgreSQL, Enterprise, `db-f1-micro` | Single zone, 10 GB SSD, automatic storage increase, daily backups, PITR | Managed backups for irreplaceable app/session/campaign data; upgrade vertically when needed |
| SaleSwitch queues | Redis 7 on the SaleSwitch VM | 256-512 MB max memory, AOF enabled, `noeviction`, private/local bind | Avoids Memorystore's 1 GiB minimum; BullMQ's database-backed recovery poller reduces queue-loss risk |
| Container images | Artifact Registry | One regional Docker repository, retain latest 5-10 images | Reproducible deploys and easy rollback |
| Secrets | GCP Secret Manager | Shopify secrets, DB URL, encryption key, Redis URL, email/API keys | No secrets in images, Git, or deployment scripts |
| Static badge uploads | GCS bucket | Regional bucket, lifecycle old versions | VM disks and Cloud Run filesystems are not appropriate durable object storage |
| Logs/metrics | GCP Ops Agent + Cloud Monitoring | Short log retention; uptime check; budget alerts | Basic operational visibility without another paid stack |
| Admin/control plane | Existing Oracle VM | Docker Compose; cap services; reserve at least 2 GB RAM for OS | Makes productive use of Always Free capacity |
| Control-plane DB | PostgreSQL on Oracle VM | Dedicated database/volume; nightly encrypted dump | The control plane owns its DB and does not share SaleSwitch's schema |
| Control-plane queues/realtime | Redis 7 on Oracle VM | Local-only bind, AOF enabled | BullMQ and Socket.IO are low volume and stay close to the panel |
| Private admin access | Cloudflare Access free tier or Tailscale | No public database/Redis ports | The control plane is an internal tool, not a merchant-facing service |
| Backups | Cloud SQL backups + encrypted OCI dumps to GCS | Daily; 14-day operational retention, monthly copy for 3 months | Separates backups from the machine being backed up |

### Region choice

Put the GCP VM, Cloud SQL, Artifact Registry, and GCS bucket in one region. Prefer the
GCP region closest to the Oracle VM and the primary operators. If the Oracle VM is in
Mumbai, use `asia-south1`; otherwise compare it with `asia-south2` using a one-day
latency test. Do not choose a US region merely for a small free-tier saving if the
cross-cloud admin connection and operator experience become materially slower.

## 3. Process layout

### SaleSwitch GCP VM

Use Docker Compose with three logical units at launch:

1. `caddy` — public ports 80/443, reverse proxy to the web container.
2. `saleswitch-app` — web plus workers using the legacy code-level setting
   `BADGY_PROCESS_ROLE=all`; start campaign start/end concurrency at 2.
3. `redis` — no public port; named persistent volume; AOF enabled.

Run Prisma migrations as a one-shot deployment step before restarting the application,
not from every web-container start. Keep one known-good image tag for immediate rollback.

The VM should have a small (1-2 GB) swap file as an emergency buffer, but alerts must fire
before sustained swapping. If normal memory exceeds 75%, move to `e2-medium`; do not treat
swap as capacity.

### Oracle control-plane VM

Use Docker Compose with:

1. `caddy` — TLS and reverse proxy.
2. `control-plane` — the existing persistent production image; it currently hosts HTTP,
   Socket.IO, and its workers together.
3. `postgres-control-plane` — its own database and volume.
4. `redis-control-plane` — local-only Redis.
5. `cloud-sql-auth-proxy` — authenticated encrypted connection to SaleSwitch Cloud SQL.

The current control plane expects replica-only merchant reads. At launch, create a
strictly read-only PostgreSQL role in the primary Cloud SQL instance and connect through
the Auth Proxy. This is a launch compromise, not a true replica. Add a Cloud SQL read
replica only when admin queries measurably affect merchant traffic or revenue supports it.

Do not put SaleSwitch's public web/worker workload on the same Oracle VM as the control plane.
The capacity is sufficient on paper, but one host failure or maintenance event would then
take out both merchant operations and the recovery console.

## 4. Expected monthly cost after the $300 credit

These are planning ranges, not quotes; GCP region, taxes, IPv4, storage, backups, logs,
and outbound traffic change the invoice.

| Item | Lean monthly estimate (USD) |
|---|---:|
| GCE `e2-small` running continuously | $13-18 |
| 30 GB VM disk + static public IPv4 | $5-9 |
| Cloud SQL `db-f1-micro` compute | about $8 in lower-cost US regions; allow $10-15 in Asia |
| Cloud SQL SSD, backups, and PITR logs | $3-8 at small data volumes |
| Artifact Registry, GCS, Secret Manager, monitoring | $0-5 at launch volumes |
| Oracle Always Free VM | $0, while tenancy remains eligible and within limits |
| Domain/email/Sentry or other third parties | separate |
| **Expected infrastructure total** | **roughly $31-55/month** |

The main optional saving is self-hosting PostgreSQL on the GCP VM, which can reduce the
bill by roughly $12-23/month. Do not do that for production launch: losing or corrupting
merchant sessions, campaign snapshots, or revert state costs more than the database.

Memorystore Basic currently has a 1 GiB minimum and is roughly $36/month in `us-central1`
before regional variation, so defer it. A Cloud SQL HA configuration roughly doubles the
database compute and storage footprint, so defer that too.

### Credit usage

Treat the $300 as runway, not permission to establish an expensive baseline:

- Month 1: build and validate the lean production stack; set budgets immediately.
- Months 2-3: run the exact post-credit shapes. Do not temporarily use HA or oversized
  instances unless performing a short, explicitly stopped load test.
- Set budget notifications at $25, $50, $75, and $100 monthly. Billing budgets alert;
  they do not automatically cap charges.
- Review cost by SKU weekly during the trial and once per month afterward.

## 5. Security baseline

- Keep PostgreSQL and Redis off the public internet. SaleSwitch Redis listens only on the
  Docker network. The control-plane PostgreSQL and Redis listen only on its Docker network.
- Use Cloud SQL Auth Proxy from both the GCP VM and Oracle VM. Give each a different
  identity/credential; the Oracle-side database user is `SELECT`-only.
- If an OCI service-account credential file is unavoidable, restrict it to Cloud SQL
  Client, store it root-readable only, and rotate it. Prefer workload identity federation
  later to eliminate long-lived GCP keys.
- Allow public ingress to SaleSwitch only on 80/443. Restrict SSH to Tailscale/IAP or a fixed
  operator IP; disable password login and root SSH.
- Put the control plane behind identity-aware access. Remove `/dev-login` and header-based
  identity seams from production use; do not rely on Caddy Basic Auth as the final control.
- Store `ENCRYPTION_KEY`, Shopify secrets, internal API tokens, database credentials, and
  backup encryption keys outside Git. Never reuse the control-plane DB password.
- Configure Shopify production URLs only after the stable HTTPS hostname is live. Verify
  OAuth callbacks, mandatory compliance webhooks, app-uninstalled handling, and HMAC checks.
- Use least-privilege GCP service accounts: deploy, runtime, and backup roles should be
  separate.

## 6. Backups and recovery

### SaleSwitch

- Enable Cloud SQL automated daily backups and PITR before installing the first real shop.
- Start with 7-14 days of PITR/backup retention; review storage cost monthly.
- Take an on-demand backup before every schema migration.
- Once a month, perform a restore into a temporary instance and run a read-only smoke test.
- Redis is not the source of truth. Enable AOF for short outages, but recovery must also be
  proven using the database-backed job poller and idempotent workers.

### Control plane

- Run `pg_dump` nightly, compress and encrypt it, then upload it to a private GCS bucket.
- Keep 14 daily and 3 monthly dumps initially.
- Back up badge graphics to GCS; do not rely on the Oracle boot volume alone.
- Document a fresh-VM restore and test it quarterly.

Initial recovery targets:

| Workload | RPO | RTO |
|---|---:|---:|
| SaleSwitch database | <= 15 minutes with PITR | <= 4 hours |
| SaleSwitch web/worker VM | database-safe; Redis jobs may be reconstructed | <= 2 hours |
| Control-plane database | <= 24 hours | <= 8 hours |

These are engineering targets, not customer SLAs.

## 7. Monitoring and alerts

Create only actionable alerts initially:

- Public HTTPS uptime check every 1-5 minutes.
- VM CPU > 80% for 15 minutes, memory > 80%, disk > 75%.
- Cloud SQL CPU > 70%, connections > 70% of limit, storage > 70%, backup failure.
- BullMQ failed/dead-letter jobs > 0 and oldest waiting job above its permitted delay.
- Campaign DB job overdue while still pending/running.
- OAuth/webhook 5xx rate and Shopify API error rate.
- Certificate expiry, even though Caddy renews automatically.
- Oracle VM/control-plane health checked externally.
- GCP monthly cost anomaly/budget thresholds.

Use structured application logs and redact shop access tokens and customer data. Keep GCP
log retention short at first; archive only audit/security logs that have a defined need.

## 8. Deployment sequence

### Phase 0 — decisions and accounts (day 1)

- Confirm the Oracle region, production domain, GCP project, and billing account.
- Create separate `production` and `staging` GCP projects if staging will remain running;
  otherwise use ephemeral staging resources with an expiry label.
- Enable MFA, remove shared owner accounts, create deployment/runtime service accounts.
- Create budgets before compute resources.

### Phase 1 — data foundation (days 1-2)

- Provision Cloud SQL single-zone PostgreSQL and enable backups/PITR.
- Create separate SaleSwitch runtime, migration, and control-plane read-only DB users.
- Validate Cloud SQL Auth Proxy from a temporary client.
- Create Secret Manager entries, Artifact Registry, and the backup/object bucket.

### Phase 2 — public SaleSwitch runtime (days 2-4)

- Build the SaleSwitch image in CI and push an immutable commit-SHA tag.
- Provision the `e2-small`, hardened firewall, static IP, Ops Agent, Docker, and Caddy.
- Deploy web, worker, and Redis containers; migrate once; run health checks.
- Set the legacy code-level variable `BADGY_PROCESS_ROLE=all` and begin with concurrency 2.
- Point the production hostname through Cloudflare and validate HTTPS without exposing the
  app's internal port.

### Phase 3 — Oracle control plane (days 3-5)

- Harden the VM, create separate data volumes/directories, and install Docker.
- Deploy its own PostgreSQL/Redis plus the existing persistent control-plane image.
- Connect its merchant connector via Auth Proxy and the read-only SaleSwitch database role.
- Replace dev authentication with the chosen identity-aware gate before adding staff.
- Upload existing badge graphics to GCS and configure durable URLs/storage.

### Phase 4 — Shopify production wiring (days 5-6)

- Configure the production app URL and allowed redirection URLs in the Shopify Partner
  Dashboard/app TOML.
- Deploy extensions/functions through Shopify CLI separately from the Node host deployment.
- Register and verify mandatory compliance/uninstall webhooks.
- Install on a development store, then a clean test store; exercise OAuth, billing,
  campaign schedule/start/end/revert, worker restart, webhook replay, and uninstall.

### Phase 5 — recovery and launch gate (days 6-7)

- Restore a Cloud SQL backup into a temporary instance.
- Stop Redis and prove overdue database jobs are safely re-enqueued after restart.
- Reboot each VM and prove all containers recover without manual intervention.
- Roll back one application release using the previous immutable image.
- Confirm alerts reach a human and publish a short incident/runbook contact path.

## 9. Scaling triggers

Scale only in response to a measured condition:

| Trigger | First action | Later action |
|---|---|---|
| SaleSwitch VM memory > 75% sustained or OOM | Resize to `e2-medium` | Split web and worker VMs |
| Worker queue delay breaches campaign timing objective | Raise concurrency carefully | Dedicated worker VM(s) |
| Redis memory > 65% or restarts affect jobs | Increase local limit/VM RAM | Memorystore Standard when revenue supports HA |
| Cloud SQL CPU/connections > 70% sustained | Tune Prisma pools and queries, then resize | HA instance; read replica for control plane |
| VM outage becomes commercially unacceptable | Managed instance group of 2 + GCP load balancer | Multi-zone web/worker layout |
| Control-plane reads burden primary DB | Reduce/paginate queries | Add a Cloud SQL read replica and point connector to it |
| Badge/object traffic becomes material | Cloudflare cache/GCS tuning | CDN with measured cache-hit benefit |

A sensible financial promotion rule is: add a managed/HA service when its monthly cost is
comfortably below 10-15% of recurring app revenue **and** it mitigates an observed risk.
Reliability needed to prevent destructive campaign outcomes is exempt from that rule.

## 10. Rejected launch alternatives

- **Everything on the Oracle VM:** cheapest, but a single maintenance or capacity event
  removes both the merchant app and its admin/recovery plane.
- **Cloud Run for everything:** attractive for HTTP scale-to-zero, but SaleSwitch has continuous
  BullMQ consumers and delayed jobs. A continuously running worker pool plus VPC access can
  erase the savings and adds operational paths before scale demands them.
- **GKE:** control-plane and operational complexity are unjustified for two small apps.
- **Memorystore at launch:** its minimum provisioned capacity costs more than the entire
  proposed small app VM in many regions.
- **Cloud SQL HA/read replica at launch:** good future reliability, poor pre-revenue unit
  economics. Begin with backups/PITR and a tested restore.
- **Control-plane DB inside SaleSwitch Cloud SQL:** violates the applications' ownership boundary
  and couples internal-tool availability/cost to the merchant system.

## 11. Sources and price checks

- GCP Cloud SQL pricing: https://cloud.google.com/sql/pricing
- Cloud SQL backup and PITR documentation:
  https://cloud.google.com/sql/docs/postgres/backup-recovery/backups and
  https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr
- Memorystore pricing and tier behavior:
  https://cloud.google.com/memorystore/docs/redis/pricing and
  https://cloud.google.com/memorystore/docs/redis/redis-tiers
- GCP Free Tier limits: https://cloud.google.com/free/docs/free-cloud-features
- Cloud Run pricing/runtime behavior: https://cloud.google.com/run/pricing and
  https://cloud.google.com/run/docs/overview/what-is-cloud-run

Recalculate the bill in the GCP Pricing Calculator for the chosen region immediately before
provisioning. Cloud pricing and free-tier eligibility can change.
