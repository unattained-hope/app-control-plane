# OCI production deployment

This stack is deliberately separate from `control-plane-staging`:

- Compose project: `control-plane-production`
- Dedicated PostgreSQL, Redis, and badge-graphics volumes
- Unique edge-network alias: `cp-prod-web`
- Backups: `/opt/control-plane-backups`

## One-time setup

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
