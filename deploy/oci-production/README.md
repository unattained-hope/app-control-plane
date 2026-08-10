# OCI production deployment

The deployer supports both production layouts without changing Compose project
names or volumes:

1. The existing run-book layout at `/opt/app-control-plane`, with the Git checkout
   nested at `/opt/app-control-plane/repo`. This is detected and updated in place.
2. A fresh repo-managed stack using this directory's `compose.yaml` and `.env`.

The fresh stack is deliberately separate from `control-plane-staging`:

- Compose project: `control-plane-production`
- Dedicated PostgreSQL, Redis, and badge-graphics volumes
- Unique edge-network alias: `cp-prod-web`
- Backups: `/opt/control-plane-backups`

## One-time setup

### Existing run-book installation

No files should be moved. Keep `/opt/app-control-plane/.env`, `compose.yaml`, and
the existing volumes where they are. The deployer adds only the operations-only
`compose.legacy-overlay.yaml` so schema sync and seed use the checked-out code.

Required legacy `.env` inputs include:

- `CONTROL_PLANE_DOMAIN`
- `CP_POSTGRES_USER`, `CP_POSTGRES_PASSWORD`, `CP_POSTGRES_DB`
- `SALESWITCH_GCP_TAILSCALE_IP`
- `SALESWITCH_CP_DB_USER`, `SALESWITCH_CP_DB_PASSWORD`
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`

The replica DSN is derived from those SaleSwitch connection components; do not
duplicate it as a manually assembled `SALESWITCH_REPLICA_URL`.

### Fresh installation

```bash
cd /opt/app-control-plane
cp deploy/oci-production/.env.example deploy/oci-production/.env
chmod 600 deploy/oci-production/.env
```

Fill every production secret in `.env`. Confirm `EDGE_DOCKER_NETWORK` names the
network used by the existing OCI edge Caddy.

Merge `Caddyfile.fragment` into that Caddy configuration and reload Caddy. Do
not route `admin.saleswitch.cc` to both `cp-web` (staging) and `cp-prod-web`
(production), or requests may reach the wrong database-backed application.

## Every deployment

Existing run-book installation:

```bash
cd /opt/app-control-plane/repo
git pull --ff-only
bash deploy/oci-production/deploy.sh
```

Fresh repo-managed installation:

```bash
bash /opt/app-control-plane/deploy/oci-production/deploy.sh
```

The command refuses a dirty checkout, fast-forwards from the configured Git
upstream, starts dependencies, takes and validates a pre-schema backup, builds
the exact commit, synchronizes the schema, runs the idempotent seed, recreates
the app, and verifies readiness, authenticated SSR, Socket.IO, and public HTTPS.

The repository currently has no Prisma migration history, so the schema image
uses `prisma db push`. Replace that with `prisma migrate deploy` once migrations
are introduced.
