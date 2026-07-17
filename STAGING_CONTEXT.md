# Apoaap Control Plane Staging Environment Context

This document is the operational context for the control-plane staging
environment. It records architecture, deployment conventions, and safe
maintenance commands without containing credentials. Update it whenever staging
infrastructure or deployment behavior changes.

SaleSwitch and the control plane share the same OCI staging VM. The authoritative
SaleSwitch staging context is the sibling repo document:

[`../badgy/STAGING_CONTEXT.md`](../badgy/STAGING_CONTEXT.md)

Read that file first for VM identity, SaleSwitch Compose topology, Caddy ingress,
and SaleSwitch deploy behavior. This file covers only the control-plane side and
the integration seam between the two apps.

## Purpose and safety

- Staging is for internal-admin smoke tests, WorkOS SSO validation, connector and
  rollup checks, migrations, and release validation against the SaleSwitch staging
  stack.
- It is not production and must not be used for paying-merchant operations or
  production PII workflows beyond what staging data already contains.
- Never commit VM IPs, SSH private keys, database passwords, Shopify secrets,
  access tokens, WorkOS secrets, shared HMAC/bearer tokens, or metrics scrape
  tokens here.
- SaleSwitch setup procedure: `badgy/docs/oci-staging-runbook.html` (control plane
  is Phase B after SaleSwitch is live).
- SaleSwitch infrastructure definition: `badgy/deploy/oci-staging/`.
- This repo ships a production `Dockerfile` at the root; a committed
  `deploy/oci-staging/` topology for the control plane is not yet in Git. Live
  staging may use transitional Compose/Caddy entries on the VM — treat those as
  local until they are committed here and cross-linked from Badgy.

## Current known environment

Shared with SaleSwitch (see Badgy `STAGING_CONTEXT.md`):

- Cloud: Oracle Cloud Infrastructure (OCI)
- Compute: Ampere A1 Flex, Arm64, 2 OCPU, 12 GB RAM
- Boot volume: 100 GB
- Operating system: Ubuntu 24.04
- SaleSwitch URL: `https://staging.saleswitch.apoaap.shop`
- Public ingress: TCP 80 and 443 through Caddy; TCP 22 restricted to trusted
  administrator IPs

Control-plane specific (record operational identifiers outside Git):

- Control-plane public URL (DNS + Caddy host; must match SaleSwitch
  `CONTROL_PLANE_URL` when integration is enabled)
- VM application directory for this checkout (commonly `/opt/app-control-plane`
  or a sibling under `/opt/` — confirm on the VM)
- Compose / Caddy fragments used for the control-plane services
- Control-plane Postgres credentials and database name (separate from SaleSwitch)
- Redis URL used by the control plane (dedicated instance preferred; do not reuse
  SaleSwitch Redis without intentional isolation review)
- WorkOS organization, client, redirect URI, and cookie password for staging
- SaleSwitch staging replica DSN (read-only role) when live replica reads are
  enabled; otherwise fixture/stub mode remains in effect
- Shared integration secrets that must match Badgy staging
  (`BADGE_GRAPHIC_READ_TOKEN`, `FEATURE_FLAGS_READ_TOKEN`,
  `SALESWITCH_INTERNAL_API_SECRET` ↔ Badgy `BADGY_INTERNAL_API_SECRET`,
  `SHOPIFY_API_SECRET` for support-chat token verify)

## Relationship to SaleSwitch staging

From Badgy `STAGING_CONTEXT.md`:

- The repository-defined SaleSwitch stack is `caddy`, `app`, `postgres`, and
  `redis` under `/opt/saleswitch/deploy/oci-staging`.
- The app-control-plane deployment is **not** currently represented in Badgy’s
  committed `docker-compose.yml` or `Caddyfile` and may run separately on the VM.
- Routine SaleSwitch deployment does **not** remove orphan containers, so a
  separately managed control-plane deployment is left untouched.
- SaleSwitch deploy currently allows transitional local edits to Caddy/Compose via
  `--allow-local-config` until control-plane topology is committed upstream.

When integration is enabled, SaleSwitch staging `.env` uses:

- `CONTROL_PLANE_URL`
- `CONTROL_PLANE_APP_KEY` (typically `saleswitch`)
- `BADGE_GRAPHIC_READ_TOKEN`
- `BADGY_INTERNAL_API_SECRET` where the internal API integration is enabled

Those values must match the control-plane counterparts. Do not print environment
files in terminal transcripts, tickets, or chat.

## Runtime topology (control plane)

Expected composition on staging (persistent process — not serverless):

1. `control-plane` (or equivalent) — React Router 7 server (`build/server/prod.js`
   from `server/prod.ts`): HTTP/SSR, tRPC resource routes, Socket.IO chat gateway,
   and in-process BullMQ workers. **Do not use `react-router-serve`** — it never
   attaches Socket.IO and `/socket.io` will 404.
2. `postgres` — control-plane’s **own** PostgreSQL (users, conversations, audit,
   rollups, ops state). Never the SaleSwitch primary.
3. `redis` — BullMQ queues + Socket.IO adapter
4. Caddy route — TLS termination for the control-plane hostname to the app port
   (normally `3000` inside Compose)

Architecture invariants that staging must preserve:

- Merchant business data is read only through `getConnector(appKey)` against a
  read-replica (or the fixture stub until a staging replica DSN is provisioned).
- The control plane never writes to SaleSwitch production/staging app DBs.
- Mutating operator actions that require audit must write `AuditLog` in the same
  Prisma transaction as the effect.
- Badge graphic binaries live on a persistent volume (`BADGE_GRAPHIC_STORAGE_DIR`);
  leave that volume alone during routine Docker cleanup.

## Production start command (Socket.IO)

The control-plane container must run the bundled persistent entry:

```bash
node ./build/server/prod.js
# equivalent: npm run start
```

If Compose overrides the image `CMD` with `react-router-serve ./build/server/index.js`,
agent chat WebSockets fail with RR `No route matches URL "/socket.io"`. Change the
service command to the line above (keep any `prisma migrate deploy` / `db push`
prefix if you still run schema sync on start).

Pass/fail after redeploy:

```bash
curl -i -u 'USER:PASS' \
  "https://staging.admin.apoaap.shop/socket.io/?EIO=4&transport=polling"
# Expect HTTP 200 and a body starting with 0{"sid":...}
```

## Configuration and secrets

Create the live environment file on the VM from this repo’s `.env.example`; never
copy a laptop development `.env`. Required / commonly required values include:

- `CONTROL_PLANE_DATABASE_URL`
- `SALESWITCH_REPLICA_URL` (staging replica or intentional stub path)
- `REDIS_URL`
- `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`,
  `WORKOS_COOKIE_PASSWORD`
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (secret must match SaleSwitch staging
  when verifying support-chat tokens)
- `NODE_ENV=production`

Integration / feature seams (set when exercising those surfaces):

- `SALESWITCH_ADMIN_API_URL` / `SALESWITCH_ADMIN_API_TOKEN`
- `SALESWITCH_INTERNAL_API_URL` / `SALESWITCH_INTERNAL_API_SECRET`
- `FEATURE_FLAGS_READ_TOKEN`
- `BADGE_GRAPHIC_READ_TOKEN`, `BADGE_GRAPHIC_STORAGE_DIR`,
  `BADGE_GRAPHIC_PUBLIC_BASE_URL` (public staging URL, no trailing slash)
- `BADGE_GRAPHIC_FALLBACK_DIR` — leave empty on staging/production
- `METRICS_AUTH_TOKEN` if `/metrics` scraping is enabled
- `SENTRY_DSN` if observability is wired

Shared secrets must match SaleSwitch staging. Coordinate rotation with
`../badgy/STAGING_CONTEXT.md` operators.

## Normal deployment

Until a committed `deploy/oci-staging/deploy.sh` exists in this repository,
deploy from the VM checkout using the same discipline as SaleSwitch:

1. Confirm the SaleSwitch stack is healthy (see Badgy verification section).
2. Ensure the control-plane worktree is on the intended branch and matches its
   upstream (or follow the transitional local-config policy if Compose/Caddy
   fragments are still uncommitted).
3. Build and start the control-plane image from the repo-root `Dockerfile`.
4. Run `prisma migrate deploy` against the **control-plane** database before or as
   part of container start (idempotent; never edit an existing migration to repair
   staging — create a new one).
5. Seed the App registry if needed (`npm run seed` / equivalent in the image).
6. Verify HTTPS, `/healthz`, `/readyz`, and WorkOS login.

Do not run SaleSwitch `deploy.sh` expecting it to rebuild the control plane. Do
not use `docker compose down --remove-orphans` on the SaleSwitch project if that
would remove a separately named control-plane stack — prefer project-scoped
recreates.

If code is transferred with `rsync` rather than Git, exclude at least `.git`,
`node_modules`, `build`, `.react-router`, local `.env` files, `data/`, and test
output.

## Verification after deployment

```bash
# Paths/names depend on the live Compose project — adjust to the VM layout.
curl -I https://<CONTROL_PLANE_STAGING_HOST>
curl -fsS https://<CONTROL_PLANE_STAGING_HOST>/healthz
curl -fsS https://<CONTROL_PLANE_STAGING_HOST>/readyz
```

Expected results:

- Public URL presents a valid TLS certificate.
- `/healthz` returns 200 while the process is up.
- `/readyz` returns 200 only when control-plane Postgres and Redis are reachable.
- No Prisma migration or startup errors in app logs.
- WorkOS AuthKit sign-in completes for a staging operator and lands in the shell.
- Dev role paths (ADMIN / SUPPORT / VIEWER) behave per `app/server/rbac.ts`
  (server enforcement; UI gating is cosmetic only).
- With SaleSwitch integration enabled: badge-graphic catalog fetch and (if
  configured) internal usage ingest / feature-flag reads succeed with matching
  tokens.
- KPI/ops/growth tiles read rollup snapshots — not live production joins.

Also confirm SaleSwitch still passes its own checks in Badgy `STAGING_CONTEXT.md`
after any shared Caddy or secret change.

## Common operations

View logs (adjust service name to the live Compose service):

```bash
docker compose logs -f --tail=200 <control-plane-service>
```

Restart only the application after a safe config change:

```bash
docker compose restart <control-plane-service>
```

Recreate after changing `.env`:

```bash
docker compose up -d --force-recreate <control-plane-service>
```

Rebuild after source or dependency changes:

```bash
docker compose up -d --build <control-plane-service>
```

Inspect resource use on the shared VM:

```bash
docker stats
df -h
docker system df
```

Do not run destructive Docker cleanup without checking which images, containers,
and volumes would be removed. Never remove SaleSwitch `pgdata` / `redisdata` /
`caddy_data`, the control-plane Postgres volume, or badge-graphic asset volumes
as part of routine cleanup. The VM has only 2 OCPU — preserve container resource
limits.

## Backups

Stateful data owned by the control plane:

- Control-plane PostgreSQL (audit log, users, conversations, rollups, flags, …)
- Badge graphic storage directory/volume

Backups must be stored off the VM (preferably OCI Object Storage). Restores must
be tested. Example database dump shape (load credentials securely; do not print
`.env`):

```bash
mkdir -p /opt/app-control-plane/backups
docker compose exec -T <cp-postgres-service> pg_dump \
  -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "/opt/app-control-plane/backups/control-plane-$(date +%F).sql.gz"
```

Backing up to the same boot volume is only an intermediate step, not an off-host
backup. Coordinate with SaleSwitch backup timing so disk pressure on the shared
A1 VM stays acceptable.

## Troubleshooting order

1. Confirm DNS for the control-plane host resolves to the current VM public IP.
2. Confirm OCI ingress and UFW allow 22, 80, and 443 as intended.
3. Confirm SaleSwitch Caddy is up and the control-plane upstream is present in the
   live Caddyfile (transitional local topology may differ from Badgy’s committed
   file).
4. Run `docker compose ps` for both the SaleSwitch project and the control-plane
   project.
5. Inspect control-plane app, its Postgres, its Redis, then Caddy logs.
6. Confirm `.env` contains required values without printing their contents.
7. Confirm WorkOS redirect URI matches the public HTTPS callback URL.
8. Confirm shared tokens match SaleSwitch staging `.env`.
9. Confirm the VM has free disk space and is not under memory pressure.

Useful symptom mapping:

- TLS failure: DNS mismatch, blocked ports 80/443, or Caddy host mismatch
- WorkOS login failure: client ID/secret mismatch or redirect URI drift
- `/readyz` 503: control-plane Postgres or Redis not healthy
- App restart loop: missing configuration, failed migration, or DB connectivity
- Empty merchant directory / fixture-looking data: replica URL still on stub, or
  connector not pointed at the staging replica
- Badge images 401/blank: `BADGE_GRAPHIC_READ_TOKEN` or
  `BADGE_GRAPHIC_PUBLIC_BASE_URL` mismatch with SaleSwitch
- Usage ingest idle: `SALESWITCH_INTERNAL_API_URL` / secret empty or mismatched
- SaleSwitch deploy “ate” CP: unlikely if orphans are preserved — check whether a
  compose project name collision or manual `--remove-orphans` was used
- Agent chat `wss://…/socket.io` refused / RR HTML `No route matches URL "/socket.io"`:
  container is running `react-router-serve` instead of `node ./build/server/prod.js`
  (check `cat /proc/1/cmdline` inside the control-plane container)

## Change discipline

- Keep this file aligned with Badgy `STAGING_CONTEXT.md` whenever shared VM,
  Caddy, domain, or integration-secret conventions change.
- When control-plane Compose/Caddy topology is committed under `deploy/`, update
  this document, `.env.example`, and Badgy’s staging context/runbook together.
- Test Docker images on `linux/arm64`.
- Keep stateful services private; expose the app only through Caddy.
- Use development stores and staging WorkOS tenants only.
- Record the deployment commit SHA in the operations log or release record after
  each deploy.
