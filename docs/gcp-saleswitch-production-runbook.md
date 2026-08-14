# GCP SaleSwitch production build runbook

Status: executable launch runbook
Region: `us-east1` (South Carolina)
Nearby OCI control plane: `us-ashburn-1`
Target: one small GCE VM + Cloud SQL PostgreSQL + VM-local Redis

This runbook deploys the merchant-facing SaleSwitch Shopify app. The internal
control plane remains on the existing OCI Ashburn VM and is connected later using a
separate read-only Cloud SQL identity and database role.

## 0. Final launch shape

| Resource | Launch setting |
|---|---|
| GCP region | `us-east1` |
| GCE zone | `us-east1-b` (another `us-east1` zone is fine) |
| VM | `e2-small`, Ubuntu 24.04 LTS x86_64, 30 GB `pd-balanced` |
| App process | One container, `BADGY_PROCESS_ROLE=all` |
| Redis | Redis 7.2 container, AOF, 384 MB limit, `noeviction` |
| PostgreSQL | Cloud SQL PostgreSQL 16, Enterprise, `db-f1-micro`, zonal, 10 GB SSD |
| Database recovery | Daily backup, 14 retained, 7 days PITR logs |
| TLS | Caddy on the VM |
| Images | Artifact Registry in `us-east1` |
| Public ports | 80 and 443 only |
| SSH | GCP OS Login; ideally IAP-only |

The `e2-small` is intentionally lean. Build the image in Cloud Build, not on the VM.
If runtime memory remains above 75%, resize to `e2-medium` rather than accepting OOMs.

> **Legacy technical identifiers:** the source repository is still located at
> `/home/dev/apoaap/badgy`, and the running code currently requires environment variables
> such as `BADGY_PROCESS_ROLE`, `BADGY_INTERNAL_API_SECRET`, and the Shopify-locked app
> proxy subpath `badgy`. These names are retained only where changing them would break the
> deployed application or Shopify registration. All new infrastructure and documentation
> use the SaleSwitch name.

## 1. Values to decide before starting

Replace these examples everywhere:

```bash
export SALESWITCH_PROJECT_ID="saleswitch-prod"
export SALESWITCH_REGION="us-east1"
export SALESWITCH_ZONE="us-east1-b"
export SALESWITCH_VM_NAME="saleswitch-prod-1"
export SALESWITCH_SQL_INSTANCE="saleswitch-prod-db"
export SALESWITCH_DATABASE="saleswitch"
export SALESWITCH_DB_USER="saleswitch_prod"
export SALESWITCH_REPOSITORY="saleswitch"
export SALESWITCH_DOMAIN="saleswitch.cc"
```

Use the final production hostname from the start. Shopify OAuth and App Bridge are
sensitive to hostname changes.

Prerequisites on the operator machine:

- A GCP billing account with the $300 trial attached.
- `gcloud` installed and authenticated.
- Access to `/home/dev/apoaap/badgy`.
- A production Shopify app registration and its client ID/secret.
- Control of the DNS zone for `SALESWITCH_DOMAIN`.
- A GitHub account or read-only deploy key that can clone the SaleSwitch repository.

Run:

  ```bash
  gcloud auth login
  gcloud config set project "$SALESWITCH_PROJECT_ID"
  gcloud config set compute/region "$SALESWITCH_REGION"
  gcloud config set compute/zone "$SALESWITCH_ZONE"
  gcloud auth application-default login
  ```

Confirm that the selected project is correct before creating anything:

```bash
gcloud config list
gcloud projects describe "$SALESWITCH_PROJECT_ID"
```

## 2. Protect the budget first

In GCP Console:

1. Go to **Billing → Budgets & alerts → Create budget**.
2. Scope it to the production project.
3. Set an initial monthly budget of `$60`.
4. Add thresholds at 50%, 80%, 100%, and forecasted 100%.
5. Send alerts to at least two monitored email addresses.
6. Create a second trial-credit budget/notification so the account is converted to paid
   billing before the trial expires.

Budgets notify; they do not stop resources or cap the invoice.

## 3. Enable required APIs

```bash
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  compute.googleapis.com \
  iam.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com
```

## 4. Create the runtime service account

```bash
gcloud iam service-accounts create saleswitch-prod-runtime \
  --display-name="SaleSwitch production runtime"

export SALESWITCH_RUNTIME_SA="saleswitch-prod-runtime@${SALESWITCH_PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$SALESWITCH_PROJECT_ID" \
  --member="serviceAccount:${SALESWITCH_RUNTIME_SA}" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding "$SALESWITCH_PROJECT_ID" \
  --member="serviceAccount:${SALESWITCH_RUNTIME_SA}" \
  --role="roles/artifactregistry.reader"

gcloud projects add-iam-policy-binding "$SALESWITCH_PROJECT_ID" \
  --member="serviceAccount:${SALESWITCH_RUNTIME_SA}" \
  --role="roles/logging.logWriter"
```

Do not grant Owner, Editor, Cloud SQL Admin, or Secret Manager Admin to the runtime VM.

## 5. Create Cloud SQL PostgreSQL

### 5.1 Create the instance

This creates the low-cost, non-HA launch database:

```bash
gcloud sql instances create "$SALESWITCH_SQL_INSTANCE" \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region="$SALESWITCH_REGION" \
  --availability-type=zonal \
  --storage-type=SSD \
  --storage-size=10 \
  --storage-auto-increase \
  --backup-start-time=07:00 \
  --retained-backups-count=14 \
  --enable-point-in-time-recovery \
  --retained-transaction-log-days=7 \
  --deletion-protection
```

`07:00` UTC is 02:00 in US Eastern Standard Time and 03:00 during daylight time. Change
it if that becomes a busy window.

Confirm the important settings:

```bash
gcloud sql instances describe "$SALESWITCH_SQL_INSTANCE" \
  --format="yaml(name,region,databaseVersion,settings.tier,settings.availabilityType,settings.backupConfiguration,settings.dataDiskSizeGb,settings.storageAutoResize,settings.deletionProtectionEnabled,connectionName)"
```

### 5.2 Create the database and user

Generate a URL-safe password locally. Hex avoids Prisma URL-encoding mistakes:

```bash
openssl rand -hex 24
```

Copy the output into a password manager as `SALESWITCH_DB_PASSWORD`. Do not export it into
shell history. Then create the user through **Cloud SQL → saleswitch-prod-db → Users → Add
user account**, selecting built-in authentication and entering that password.

Create the application database:

```bash
gcloud sql databases create "$SALESWITCH_DATABASE" \
  --instance="$SALESWITCH_SQL_INSTANCE" \
  --charset=UTF8
```

If using the CLI to create the user, be aware that a literal `--password` can be retained
in shell history and process listings; the Console flow is preferred for this one step.

Record the connection name:

```bash
export SALESWITCH_SQL_CONNECTION_NAME="$(gcloud sql instances describe "$SALESWITCH_SQL_INSTANCE" --format='value(connectionName)')"
echo "$SALESWITCH_SQL_CONNECTION_NAME"
```

It should look like `project-id:us-east1:saleswitch-prod-db`.

### 5.3 Validate a backup exists

The first scheduled backup may not exist immediately. Before launch, check:

```bash
gcloud sql backups list --instance="$SALESWITCH_SQL_INSTANCE"
```

Take an on-demand pre-launch backup:

```bash
gcloud sql backups create --instance="$SALESWITCH_SQL_INSTANCE" --description="pre-launch"
```

## 6. Create Artifact Registry

```bash
gcloud artifacts repositories create "$SALESWITCH_REPOSITORY" \
  --repository-format=docker \
  --location="$SALESWITCH_REGION" \
  --description="SaleSwitch production images" \
  --immutable-tags

gcloud auth configure-docker "${SALESWITCH_REGION}-docker.pkg.dev"
```

The repeatable deployment script builds each release in Cloud Build and tags it with the
Git commit SHA. Before the first deployment, verify the intended production branch on an
operator machine:

```bash
cd /home/dev/apoaap/badgy
npm ci
npm run lint
npm run typecheck
npx vitest run
```

`deploy/gcp-production/cloudbuild.yaml` deliberately builds with
`deploy/oci-staging/Dockerfile`, which is architecture-neutral despite its name and has the
correct multi-stage Prisma/build ordering. The production Compose command overrides the
image's default migration-on-start command: `deploy.sh` takes a backup and runs migrations
once before replacing the app container. Workers remain inside the app process with
`BADGY_PROCESS_ROLE=all`.

The human identity used to run deployments needs Cloud Build submission and Artifact
Registry read permissions. Cloud Build's build service account needs Artifact Registry
Writer. Keep build roles off the VM runtime service account. On the VM, authenticate the
deployment operator separately before running `deploy.sh`:

```bash
gcloud auth login --no-launch-browser
gcloud config set project "$SALESWITCH_PROJECT_ID"
```

## 7. Reserve the public IP and create firewall rules

```bash
gcloud compute addresses create saleswitch-prod-ip --region="$SALESWITCH_REGION"
export SALESWITCH_PUBLIC_IP="$(gcloud compute addresses describe saleswitch-prod-ip --region="$SALESWITCH_REGION" --format='value(address)')"
echo "$SALESWITCH_PUBLIC_IP"
```

Create narrowly targeted web firewall rules:

```bash
gcloud compute firewall-rules create saleswitch-allow-http \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:80 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=saleswitch-web

gcloud compute firewall-rules create saleswitch-allow-https \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=saleswitch-web
```

Do not create rules for PostgreSQL 5432, Redis 6379, or Node 3000.

For SSH, prefer IAP instead of opening port 22 globally:

```bash
gcloud compute firewall-rules create saleswitch-allow-iap-ssh \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges=35.235.240.0/20 \
  --target-tags=saleswitch-ssh
```

The operator needs `roles/iap.tunnelResourceAccessor` and an OS Login role. Grant those
to a specific operator identity, not `allUsers`.

## 8. Create the Compute Engine VM

Enable OS Login and create the VM with Shielded VM controls:

```bash
gcloud compute project-info add-metadata \
  --metadata=enable-oslogin=TRUE

gcloud compute instances create "$SALESWITCH_VM_NAME" \
  --zone="$SALESWITCH_ZONE" \
  --machine-type=e2-small \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-type=pd-balanced \
  --boot-disk-size=30GB \
  --address="$SALESWITCH_PUBLIC_IP" \
  --service-account="$SALESWITCH_RUNTIME_SA" \
  --scopes=cloud-platform \
  --tags=saleswitch-web,saleswitch-ssh \
  --labels=app=saleswitch,environment=production,owner=apoaap \
  --shielded-secure-boot \
  --shielded-vtpm \
  --shielded-integrity-monitoring \
  --deletion-protection
```

Connect through IAP:

```bash
gcloud compute ssh "$SALESWITCH_VM_NAME" --zone="$SALESWITCH_ZONE" --tunnel-through-iap
```

## 9. Bootstrap Ubuntu

Run these commands on the VM:

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git gnupg openssl unattended-upgrades

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and reconnect so Docker group membership applies. Confirm:

```bash
docker version
docker compose version
```

Create a 2 GB emergency swap file:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-saleswitch.conf
sudo sysctl --system
```

Swap is an emergency buffer, not usable steady-state memory.

Clone the production source checkout. Use an SSH deploy key or operator SSH identity with
read-only repository access; do not put a GitHub token in the remote URL:

```bash
sudo install -d -o "$USER" -g "$(id -gn)" /opt/saleswitch
git clone git@github.com:unattained-hope/badgy.git /opt/saleswitch
cd /opt/saleswitch
git switch main
git branch --set-upstream-to=origin/main main
```

If `/opt` should remain root-owned, create `/opt/saleswitch` as root, transfer only that
directory to the deployment user, and clone into it. Production deploys require a clean
worktree and use `git pull --ff-only`; changes are never edited directly on the VM.

## 10. Configure DNS before starting Caddy

At the DNS provider, create:

```text
Type: A
Name: the host portion of SALESWITCH_DOMAIN
Value: SALESWITCH_PUBLIC_IP
TTL: 300 during launch
```

If using Cloudflare, begin with the record **DNS only** (grey cloud). After Caddy has a
certificate and direct HTTPS works, enable the proxy and select SSL/TLS mode **Full
(strict)**.

Verify from the operator machine:

```bash
dig +short "$SALESWITCH_DOMAIN" A
```

It must return the reserved GCP IP. Do not add an AAAA record because this VM setup does
not configure public IPv6.

## 11. Use the versioned production deployment files

The repository contains the production Compose file, Caddy configuration, Cloud Build
configuration, environment template, and deployment script under
`deploy/gcp-production/`. Keeping these files in Git makes infrastructure changes reviewable
and ensures the VM uses the same revision as the application release.

Do not add a generic `X-Frame-Options: DENY`; SaleSwitch is an embedded Shopify app and must
render in Shopify Admin according to Shopify's framing/CSP behavior.

## 12. Create the environment file securely

Generate independent secrets on the operator machine, store them in a password manager,
and paste only the final values into the VM file:

```bash
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 32   # BADGY_INTERNAL_API_SECRET
openssl rand -hex 32   # BADGY_IMPERSONATION_SECRET
openssl rand -hex 32   # BADGY_IMPERSONATION_COOKIE_SECRET
```

Create the untracked production environment file beside the Compose file:

```bash
cd /opt/saleswitch
cp deploy/gcp-production/.env.example deploy/gcp-production/.env
chmod 600 deploy/gcp-production/.env
editor deploy/gcp-production/.env
```

Use the exact scopes from the production `shopify.app.toml`; the list above mirrors the
current staging registration and should be rechecked before launch.

The Compose file uses `${...}` substitutions, so `.env` is both the Compose interpolation
file and the application environment file. Passwords are generated as hex specifically
to avoid `$`, `#`, `@`, `:`, and URL-encoding problems.

For the first deployment, the deployment-user-readable VM file is the simplest reliable
secret delivery. Also store canonical values in GCP Secret Manager and move to automated
deployment-time retrieval after launch; do not bake them into the image.

## 13. Deploy and update SaleSwitch

From the clean production checkout on the VM, one command performs the normal release:

```bash
cd /opt/saleswitch
bash deploy/gcp-production/deploy.sh
```

It performs these guarded steps:

1. Refuses a dirty worktree or detached branch, then fetches and fast-forwards from the
   configured upstream branch.
2. Builds the exact Git commit in Cloud Build and pushes an immutable 12-character
   commit-SHA image tag, or reuses that tag when the commit was built previously. The
   small VM never runs the Node/Vite build.
3. Validates Compose, starts Cloud SQL Proxy and Redis, and creates a compressed
   pre-migration PostgreSQL backup under `/opt/saleswitch-backups`.
4. Pulls the new image and runs `prisma migrate deploy` as a one-shot container.
5. Recreates the app, ensures Caddy is running, and fails unless public HTTPS responds.

To require that CI or a prior deploy has already pushed the image (and fail otherwise), use:

```bash
bash deploy/gcp-production/deploy.sh --skip-build
```

The script prints the previous image on failure for an explicit rollback decision. It does
not automatically roll back after a migration because schema compatibility must be assessed
first. Routine container restarts do not pull source or run migrations:

```bash
cd /opt/saleswitch
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml restart app
```

## 14. Validate the public endpoint

From the operator machine:

```bash
curl -I "https://${SALESWITCH_DOMAIN}/"
curl -sS -o /dev/null -w '%{http_code}\n' "https://${SALESWITCH_DOMAIN}/auth/login"
```

A redirect or Shopify-aware response can be healthy; TLS failures, 502, and 5xx are not.

On the VM:

```bash
cd /opt/saleswitch
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml ps
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml \
  logs --since=10m app cloud-sql-proxy redis caddy
docker stats --no-stream
df -h
free -h
```

Confirm that ports 5432, 6379, and 3000 are not publicly bound:

```bash
sudo ss -lntp
```

Only SSH plus 80/443 should be reachable externally.

## 15. Configure the production Shopify app

Create a production Shopify config instead of overwriting the staging config. Base it on
the existing TOML and set:

```toml
application_url = "https://saleswitch.cc"

[auth]
redirect_urls = [
  "https://saleswitch.cc/auth/callback",
  "https://saleswitch.cc/auth/shopify/callback",
  "https://saleswitch.cc/api/auth/callback",
  "https://saleswitch.cc/api/auth",
]

[app_proxy]
url = "https://saleswitch.cc"
subpath = "badgy" # Shopify-locked legacy identifier; do not rename
prefix = "apps"
```

Keep the existing webhook API version, privacy-compliance URLs, scopes, extension handles,
metafield namespaces, and app-proxy subpath unless the Shopify registration explicitly
requires a change.

From the developer workstation—not the production VM—link/deploy the production app:

```bash
cd /home/dev/apoaap/badgy
shopify app config link
shopify app deploy
```

Before accepting a merchant:

1. Install the production app on a clean Shopify development/test store.
2. Complete OAuth and reopen the embedded app from Shopify Admin.
3. Confirm the offline session survives an app-container restart.
4. Confirm mandatory privacy and uninstall webhooks are registered.
5. Create and schedule a tiny campaign.
6. Watch the worker process the start and end jobs.
7. Confirm prices/metafields revert correctly.
8. Reboot the VM and repeat a scheduled-job test.

Do not use real merchant products for the first campaign test.

## 16. Install monitoring

Install the Google Cloud Ops Agent on the VM using the current command shown in
**Compute Engine → VM instance → Observability → Install Ops Agent**. Google occasionally
changes the installer URL, so use the Console-generated command rather than copying an old
curl command from a blog.

Create these alerts:

- VM uptime check on `https://SALESWITCH_DOMAIN/`.
- VM CPU > 80% for 15 minutes.
- VM disk > 75%.
- VM memory > 80% after the Ops Agent exposes memory metrics.
- Cloud SQL CPU > 70% for 15 minutes.
- Cloud SQL connections > 70% of its maximum.
- Cloud SQL storage > 70% and backup failure.
- Log-based alert for unhandled errors, worker job failures, and overdue campaign jobs.

Keep log retention short initially and verify logs never contain Shopify access tokens.

## 17. Safe release procedure

Before every release, run the quality gate on the developer workstation and push the
reviewed commit to the production branch:

```bash
cd /home/dev/apoaap/badgy
npm ci
npm run lint
npm run typecheck
npx vitest run
git status --short
git push origin main
```

Then run the single deployment command on the VM. The script records the previous image,
creates the backup, migrates, restarts, and verifies the endpoint:

```bash
cd /opt/saleswitch
bash deploy/gcp-production/deploy.sh
```

To roll back application code, set `SALESWITCH_IMAGE` in
`deploy/gcp-production/.env` to the previous immutable image printed by the failed deploy,
then run:

```bash
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml config --quiet
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml pull app
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml up -d --no-deps --force-recreate app
```

Never roll back a database migration by editing or deleting an existing Prisma migration.
Use a forward corrective migration, and confirm the older app image is compatible with the
current schema before an application rollback.

## 18. Reboot and recovery checks

Test once before launch:

```bash
sudo reboot
```

Reconnect after a few minutes and verify:

```bash
cd /opt/saleswitch
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml ps
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml \
  logs --since=10m app cloud-sql-proxy redis caddy
curl -I "https://${SALESWITCH_DOMAIN}/"
```

Test Cloud SQL restore monthly at first:

1. Restore/clone the latest backup or a PITR timestamp to a temporary instance.
2. Connect with a temporary proxy.
3. Verify core table counts and a sample campaign/session read.
4. Delete the temporary instance after verification.

Deletion protection prevents accidental deletion of the production VM and SQL instance.
It does not replace backups.

## 19. Set up the control plane on the OCI Ashburn VM

This section assumes the existing Oracle VM is running in `us-ashburn-1` and SSH works.
Use `admin.saleswitch.cc` as the private control-plane hostname.

### 19.1 Know the two production gates

The current control-plane application can be deployed and exercised, but it is not ready
for unrestricted staff access yet:

1. `app/server/connectors/registry.ts` selects fixture merchant data whenever
   `NODE_ENV=production`. Supplying `SALESWITCH_REPLICA_URL` alone does **not** switch the
   production connector to live data.
2. `/dev-login` lets a signed-in browser choose `ADMIN`, `SUPPORT`, or `VIEWER`. Cloudflare
   Access protects the outer boundary, but the application does not yet map a verified
   Cloudflare identity to a stored role.

Until both are fixed and tested, restrict the Cloudflare Access allow policy to the owner's
single email address. Do not invite support staff or treat fixture dashboard values as real.
The Cloud SQL proxy and read-only role below prepare the real data path, but the connector
code change remains a release gate.

### 19.2 Choose control-plane values — desktop

Run on `sami-desktop`:

```bash
export CONTROL_PLANE_DOMAIN="admin.saleswitch.cc"
export CONTROL_PLANE_OCI_HOST="ubuntu@YOUR_OCI_PUBLIC_IP"
export CONTROL_PLANE_OCI_TAILSCALE_IP="100.65.10.87"
export SALESWITCH_GCP_TAILSCALE_IP="100.101.142.112"
```

If the OCI image uses the `opc` account, replace `ubuntu` with `opc`.

### 19.3 Create the keyless GCP-to-OCI database path — both VMs

Do not export a GCP service-account JSON key to OCI. The production project enforces
`constraints/iam.disableServiceAccountKeyCreation`. Instead, run a second Cloud SQL Auth
Proxy on the SaleSwitch GCE VM. It authenticates through the VM's existing attached runtime
identity and listens only on the GCP VM's Tailscale address. Tailscale encrypts the hop from
OCI to GCP; the proxy encrypts and authenticates the hop from GCP to Cloud SQL.

Install Tailscale on both Ubuntu VMs and authenticate them into the same tailnet:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=HOSTNAME
tailscale status
tailscale ip -4
```

Use `saleswitch-prod-gcp` on GCP and `apoaap-control-plane-oci` on OCI. Verify both
directions before exposing the proxy:

```bash
# GCP VM
tailscale ping 100.65.10.87

# OCI VM
tailscale ping 100.101.142.112
```

On the GCP VM, read the non-secret Cloud SQL connection name from the existing production
environment, then start a dedicated proxy on Tailscale port `5433`:

```bash
export SALESWITCH_GCP_TAILSCALE_IP="$(tailscale ip -4)"
export SALESWITCH_SQL_CONNECTION_NAME="$(sed -n 's/^CLOUD_SQL_CONNECTION_NAME=//p' /opt/saleswitch/repo/deploy/gcp-production/.env | tail -n 1)"

test -n "$SALESWITCH_GCP_TAILSCALE_IP"
test -n "$SALESWITCH_SQL_CONNECTION_NAME"

docker run -d \
  --name saleswitch-control-plane-db-proxy \
  --restart unless-stopped \
  --network host \
  gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.23.0 \
  --address="$SALESWITCH_GCP_TAILSCALE_IP" \
  --port=5433 \
  "$SALESWITCH_SQL_CONNECTION_NAME"

docker logs --tail=100 saleswitch-control-plane-db-proxy
sudo ss -lntp | grep '100.101.142.112:5433'
```

This is intentionally a second proxy, not a second SaleSwitch application stack. Do not
publish `5433` on `0.0.0.0` or the VM's public address. Restrict Tailscale grants/ACLs so
only `apoaap-control-plane-oci` can reach `saleswitch-prod-gcp:5433`.

From OCI, prove the proxy is reachable without supplying a password:

```bash
docker run --rm postgres:16-alpine \
  pg_isready -h 100.101.142.112 -p 5433 -d saleswitch
```

### 19.4 Create the PostgreSQL read-only role — GCP VM

Generate a URL-safe password on your desktop and store it in the password manager:

```bash
openssl rand -hex 24
```

Call it `SALESWITCH_CONTROL_PLANE_DB_PASSWORD`. Do not reuse the SaleSwitch app password.

SSH to the GCP VM and use the existing production environment without printing its
credentials. Run a temporary `psql` container on the SaleSwitch Compose network:

```bash
cd /opt/saleswitch
docker run --rm -it \
  --network saleswitch_default \
  --env-file repo/deploy/gcp-production/.env \
  postgres:16-alpine \
  sh -c 'PGPASSWORD="$SALESWITCH_DB_PASSWORD" exec psql -h cloud-sql-proxy -U "$SALESWITCH_DB_USER" -d "$SALESWITCH_DATABASE"'
```

Create the role without embedding its password in SQL. The default-privilege owner must
match `SALESWITCH_DB_USER`; the production value below is `saleswitch_prod`:

```sql
CREATE ROLE saleswitch_control_plane
  LOGIN
  CONNECTION LIMIT 5;

GRANT CONNECT ON DATABASE saleswitch TO saleswitch_control_plane;
GRANT USAGE ON SCHEMA public TO saleswitch_control_plane;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO saleswitch_control_plane;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO saleswitch_control_plane;

ALTER DEFAULT PRIVILEGES FOR ROLE saleswitch_prod IN SCHEMA public
  GRANT SELECT ON TABLES TO saleswitch_control_plane;
ALTER DEFAULT PRIVILEGES FOR ROLE saleswitch_prod IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO saleswitch_control_plane;

ALTER ROLE saleswitch_control_plane SET default_transaction_read_only = on;
```

Set the generated password through `psql`'s hidden prompt so it is not retained in SQL or
terminal output:

```sql
\password saleswitch_control_plane
```

Paste the generated hex password twice when prompted; do not paste it into the runbook,
chat, shell command, or Compose file until creating the protected OCI `.env`.

Exit with `\q`. If migrations are owned by a different database role, repeat the two
`ALTER DEFAULT PRIVILEGES FOR ROLE ...` statements for that migration owner.

### 19.5 Point Cloudflare DNS at OCI — Cloudflare dashboard

In the `saleswitch.cc` Cloudflare zone create:

```text
Type: A
Name: admin
Content: OCI_PUBLIC_IP
Proxy status: DNS only initially
TTL: Auto
```

Confirm:

```bash
dig +short admin.saleswitch.cc A
```

It must return the OCI public IP. Keep it DNS-only until Caddy obtains its certificate;
then enable the orange-cloud proxy and use **SSL/TLS → Full (strict)**.

### 19.6 Harden and prepare the OCI VM — OCI VM

SSH to OCI:

```bash
ssh "$CONTROL_PLANE_OCI_HOST"
```

On Ubuntu, install Docker:

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git gnupg openssl ufw unattended-upgrades

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and reconnect. Then create the deployment and backup directories:

```bash
sudo mkdir -p /opt/app-control-plane /opt/control-plane-backups
sudo chown -R "$USER":"$USER" /opt/app-control-plane /opt/control-plane-backups
docker version
docker compose version
```

In both the OCI Network Security List/NSG and the VM firewall:

- Allow TCP 80 and 443 from the internet.
- Allow TCP 22 only from the operator's fixed IP, VPN, or another trusted path.
- Do not allow 3000, 5432, or 6379.

For Ubuntu UFW, only after confirming SSH is allowed:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 41641/udp comment 'Tailscale direct connections'
sudo ufw allow in on tailscale0 comment 'Trusted tailnet traffic'
sudo ufw enable
sudo ufw status verbose
```

### 19.7 Clone and verify the control plane — OCI VM

Use the repository's authenticated Git URL:

```bash
git clone YOUR_APP_CONTROL_PLANE_GIT_URL /opt/app-control-plane/repo
cd /opt/app-control-plane/repo
git status --short
```

Before production deployment, the commit must be reviewed and the worktree clean. Build
and test on the desktop/CI; the OCI host is a deployment target, not the source of truth.

### 19.8 Create the dedicated OCI production Compose stack — OCI VM

Create `/opt/app-control-plane/compose.yaml`:

```yaml
services:
  caddy:
    image: caddy:2.10-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      CONTROL_PLANE_DOMAIN: ${CONTROL_PLANE_DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - control-plane
    mem_limit: 128m

  control-plane:
    build:
      context: ./repo
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - .env
    environment:
      NODE_ENV: production
      PORT: "3000"
      CONTROL_PLANE_DATABASE_URL: postgresql://${CP_POSTGRES_USER}:${CP_POSTGRES_PASSWORD}@cp-postgres:5432/${CP_POSTGRES_DB}?schema=public&connection_limit=5
      REDIS_URL: redis://cp-redis:6379
      SALESWITCH_REPLICA_URL: postgresql://${SALESWITCH_CP_DB_USER}:${SALESWITCH_CP_DB_PASSWORD}@${SALESWITCH_GCP_TAILSCALE_IP}:5433/saleswitch?schema=public&connection_limit=3
      BADGE_GRAPHIC_STORAGE_DIR: /data/badge-graphics
      BADGE_GRAPHIC_PUBLIC_BASE_URL: https://${CONTROL_PLANE_DOMAIN}
      BADGE_GRAPHIC_FALLBACK_DIR: ""
    command: ["node", "./build/server/prod.js"]
    volumes:
      - badge_graphics:/data/badge-graphics
    depends_on:
      cp-postgres:
        condition: service_healthy
      cp-redis:
        condition: service_healthy
    expose:
      - "3000"
    mem_limit: 2048m

  cp-postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${CP_POSTGRES_USER}
      POSTGRES_PASSWORD: ${CP_POSTGRES_PASSWORD}
      POSTGRES_DB: ${CP_POSTGRES_DB}
    volumes:
      - cp_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \"$$POSTGRES_USER\" -d \"$$POSTGRES_DB\""]
      interval: 5s
      timeout: 5s
      retries: 10
    mem_limit: 1024m

  cp-redis:
    image: redis:7.2-alpine
    restart: unless-stopped
    command:
      - redis-server
      - --appendonly
      - "yes"
      - --appendfsync
      - everysec
      - --maxmemory
      - 256mb
      - --maxmemory-policy
      - noeviction
    volumes:
      - cp_redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    mem_limit: 384m

volumes:
  caddy_data:
  caddy_config:
  cp_postgres_data:
  cp_redis_data:
  badge_graphics:
```

Nothing publishes ports 3000, 5432, or 6379. The outbound replica connection goes to the
GCP VM's Tailscale-only proxy at `100.101.142.112:5433`.

Create `/opt/app-control-plane/Caddyfile`:

```caddyfile
{$CONTROL_PLANE_DOMAIN} {
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    reverse_proxy control-plane:3000
}
```

Cloudflare Access, not Caddy Basic Auth, is the staff identity perimeter. Token-guarded
machine endpoints require more-specific Cloudflare Access bypass applications later.

### 19.9 Create control-plane secrets — OCI VM

Generate independent values:

```bash
openssl rand -hex 24  # CP_POSTGRES_PASSWORD
openssl rand -hex 32  # FEATURE_FLAGS_READ_TOKEN
openssl rand -hex 32  # BADGE_GRAPHIC_READ_TOKEN
openssl rand -hex 32  # METRICS_AUTH_TOKEN
```

Create `/opt/app-control-plane/.env`:

```dotenv
CONTROL_PLANE_DOMAIN=admin.saleswitch.cc
SALESWITCH_GCP_TAILSCALE_IP=100.101.142.112

CP_POSTGRES_USER=control_plane
CP_POSTGRES_PASSWORD=PASTE_SEPARATE_HEX_PASSWORD
CP_POSTGRES_DB=control_plane

SALESWITCH_CP_DB_USER=saleswitch_control_plane
SALESWITCH_CP_DB_PASSWORD=PASTE_READ_ONLY_HEX_PASSWORD

SHOPIFY_API_KEY=PASTE_SALESWITCH_PRODUCTION_CLIENT_ID
SHOPIFY_API_SECRET=PASTE_SALESWITCH_PRODUCTION_CLIENT_SECRET
CHAT_HOST_ORIGINS=https://saleswitch.cc

SENTRY_DSN=
FEATURE_FLAGS_READ_TOKEN=PASTE_SEPARATE_TOKEN
BADGE_GRAPHIC_READ_TOKEN=PASTE_SEPARATE_TOKEN
METRICS_AUTH_TOKEN=PASTE_SEPARATE_TOKEN

SALESWITCH_ADMIN_API_URL=
SALESWITCH_ADMIN_API_TOKEN=
SALESWITCH_INTERNAL_API_URL=https://saleswitch.cc
SALESWITCH_INTERNAL_API_SECRET=PASTE_VALUE_MATCHING_BADGY_INTERNAL_API_SECRET

USAGE_DIGEST_RECIPIENTS=
SESSION_TTL_SECONDS=28800
SUBSCRIPTION_CACHE_TTL_SECONDS=120
```

`SALESWITCH_INTERNAL_API_SECRET` must equal the legacy code-level
`BADGY_INTERNAL_API_SECRET` configured on the SaleSwitch GCP VM. The feature-flag and
badge-read tokens must likewise match the corresponding tokens later configured in
SaleSwitch.

Protect the deployment material:

```bash
chmod 600 /opt/app-control-plane/.env
chmod 644 /opt/app-control-plane/compose.yaml /opt/app-control-plane/Caddyfile
```

### 19.10 Build, migrate, seed, and start — OCI VM

Validate before starting:

```bash
cd /opt/app-control-plane
docker compose config --quiet
docker compose build control-plane
docker compose up -d cp-postgres cp-redis
docker compose logs --tail=100 cp-postgres cp-redis
docker compose exec cp-redis redis-cli ping
```

Expected Redis result: `PONG`.

Run the control-plane-owned migration and seed once:

```bash
docker compose run --rm control-plane npx prisma migrate deploy
docker compose run --rm control-plane npm run seed
```

Start the persistent server and Caddy:

```bash
docker compose up -d control-plane caddy
docker compose ps
docker compose logs -f --tail=200 control-plane caddy
```

Exit logs with Ctrl-C. Check local readiness on OCI:

```bash
curl -fsS http://127.0.0.1/healthz -H 'Host: admin.saleswitch.cc'
curl -fsS http://127.0.0.1/readyz -H 'Host: admin.saleswitch.cc'
curl -I https://admin.saleswitch.cc
```

`readyz` validates the control plane's own PostgreSQL and Redis. It does not prove the live
SaleSwitch merchant connector is active.

### 19.11 Put the UI behind Cloudflare Access — Cloudflare dashboard

After direct HTTPS works:

1. Enable the orange-cloud proxy for `admin.saleswitch.cc`.
2. Set SSL/TLS mode to **Full (strict)**.
3. Open **Zero Trust → Access → Applications → Add an application → Self-hosted**.
4. Application domain: `admin.saleswitch.cc`.
5. Create an Allow policy containing only the owner's exact email address.
6. Require the configured identity provider and a short session duration.
7. Verify an incognito browser is blocked before authentication.

The embedded SaleSwitch support widget and token-authenticated APIs cannot complete an
interactive Access login. Before enabling those integrations, create more-specific Access
`/api/flags`, and `/api/badge-graphics/*`. Bypass only paths already protected by signed
Shopify sessions, HMAC, or strong bearer tokens. Do not bypass `/*`.

While `/dev-login` remains, visit this only after Cloudflare authenticates the owner's
email:

```text
https://admin.saleswitch.cc/dev-login?role=ADMIN&to=/
```

This is a temporary single-owner bootstrap, not final production RBAC.

### 19.12 Configure SaleSwitch integration — GCP VM

After the required Cloudflare path policies exist, update
`/opt/saleswitch/deploy/gcp-production/.env`:

```dotenv
CONTROL_PLANE_URL=https://admin.saleswitch.cc
BADGE_GRAPHIC_READ_TOKEN=THE_SAME_BADGE_GRAPHIC_READ_TOKEN
CONTROL_PLANE_APP_KEY=saleswitch
```

The existing `SHOPIFY_API_SECRET` must already match on both applications. Recreate the
SaleSwitch app container:

```bash
cd /opt/saleswitch
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml up -d --no-deps --force-recreate app
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml logs --tail=150 app
```

Do not enable the control-plane badge gallery until its badge assets have been imported
into the persistent `badge_graphics` volume and backed up.

### 19.13 Back up the OCI-owned data — OCI VM

Create a nightly script outside the Git repository that dumps the control-plane database
and archives badge graphics. Store a second encrypted copy outside OCI (for example, the
private GCS backup bucket):

```bash
cd /opt/app-control-plane
mkdir -p /opt/control-plane-backups

docker compose exec -T cp-postgres \
  pg_dump -U control_plane -d control_plane -Fc \
  > "/opt/control-plane-backups/control-plane-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker run --rm \
  -v app-control-plane_badge_graphics:/source:ro \
  -v /opt/control-plane-backups:/backup \
  alpine:3.21 \
  tar -czf "/backup/badge-graphics-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C /source .
```

The exact Compose volume prefix can differ. Find it first with:

```bash
docker volume ls | grep badge_graphics
```

Automate only after a manual backup and restore test succeeds. Retain 14 daily and 3
monthly copies initially.

### 19.14 Control-plane acceptance checklist

- [ ] `admin.saleswitch.cc` resolves to OCI and serves valid HTTPS.
- [ ] Cloudflare Access denies non-owner identities.
- [ ] OCI exposes no public 3000, 5432, or 6379 ports.
- [ ] `healthz` and `readyz` are healthy.
- [ ] Control-plane PostgreSQL migrations and seed completed.
- [ ] Redis returns `PONG` and AOF is enabled.
- [ ] Tailscale permits OCI → GCP `100.101.142.112:5433` and blocks unrelated peers.
- [ ] Dedicated GCP Cloud SQL Auth Proxy uses the attached runtime identity and survives reboot.
- [ ] PostgreSQL role `saleswitch_control_plane` cannot insert, update, or delete.
- [ ] Production connector no longer returns fixtures before real operational use.
- [ ] Production SSO/RBAC replaces unrestricted `/dev-login` before adding staff.
- [ ] Public machine paths are narrowly bypassed in Access and independently authenticated.
- [ ] Badge graphics survive container recreation.
- [ ] Database and badge backup restore tests succeed.
- [ ] VM reboot restores all containers automatically.

## 20. First-week tuning

For seven days, check daily:

```bash
cd /opt/saleswitch
docker stats --no-stream
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml exec redis redis-cli info memory
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml exec redis redis-cli info persistence
docker compose --env-file deploy/gcp-production/.env \
  --file deploy/gcp-production/compose.yaml logs --since=24h app | tail -n 300
df -h
free -h
```

Actions:

- Memory consistently above 75% or any OOM: resize to `e2-medium`.
- Swap usage continually grows: resize; do not increase swap first.
- Redis rejected writes/OOM: inspect queue retention and raise capacity cautiously.
- Cloud SQL connection pressure: keep Prisma `connection_limit=5`, inspect leaked/slow
  queries, then resize the database only after query/pool fixes.
- Worker queue delays: raise start/end concurrency from 2 to 3 only if VM CPU/memory and
  Shopify throttling remain healthy.

Resize the VM during a maintenance window:

```bash
gcloud compute instances stop "$SALESWITCH_VM_NAME" --zone="$SALESWITCH_ZONE"
gcloud compute instances set-machine-type "$SALESWITCH_VM_NAME" \
  --zone="$SALESWITCH_ZONE" --machine-type=e2-medium
gcloud compute instances start "$SALESWITCH_VM_NAME" --zone="$SALESWITCH_ZONE"
```

## 21. Completion checklist

- [ ] Monthly budget and credit-expiry alerts configured.
- [ ] Runtime service account has no broad roles.
- [ ] Cloud SQL is PostgreSQL 16, zonal, backed up, PITR-enabled, deletion-protected.
- [ ] A successful on-demand backup is visible.
- [ ] GCE VM is `e2-small`, Shielded, OS Login-enabled, deletion-protected.
- [ ] Only ports 80/443 and restricted/IAP SSH are open.
- [ ] Database, Redis, and Node ports are not public.
- [ ] DNS resolves to the reserved GCP IP.
- [ ] Caddy serves a valid certificate.
- [ ] Image is immutable and built by Cloud Build.
- [ ] `.env` is mode 600 and absent from Git/images/logs.
- [ ] Prisma migrations complete successfully.
- [ ] Redis AOF is active and `PING` returns `PONG`.
- [ ] Shopify OAuth, embedded load, app proxy, extensions, and compliance webhooks work.
- [ ] Campaign schedule/start/end/revert test succeeds.
- [ ] VM reboot recovery succeeds.
- [ ] Alerts reach a human.
- [ ] Restore test is scheduled and owned.

## 22. Authoritative references

- Create Compute Engine instances:
  https://cloud.google.com/compute/docs/instances/create-start-instance
- GCE OS Login:
  https://cloud.google.com/compute/docs/oslogin
- Create Cloud SQL for PostgreSQL:
  https://cloud.google.com/sql/docs/postgres/create-instance
- Cloud SQL Auth Proxy:
  https://cloud.google.com/sql/docs/postgres/connect-auth-proxy
- Cloud SQL backups and PITR:
  https://cloud.google.com/sql/docs/postgres/backup-recovery/backups and
  https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr
- Docker Engine on Ubuntu:
  https://docs.docker.com/engine/install/ubuntu/

Check the official pages and `gcloud ... --help` immediately before execution. Service
flags, supported image families, proxy versions, pricing, and Shopify requirements can
change.
