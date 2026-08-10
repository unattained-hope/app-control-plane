#!/usr/bin/env bash
# Pull, back up, build, sync/seed, restart, and verify control-plane production.
# Usage from any directory on the OCI VM:
#   bash /opt/app-control-plane/deploy/oci-production/deploy.sh

if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: Run this deployment script with Bash." >&2
  exit 2
fi

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"
BACKUP_DIR="${BACKUP_DIR:-/opt/control-plane-backups}"
WAIT_ATTEMPTS=30
EDGE_ATTEMPTS=12
DOCKER_BIN="$(type -P docker || true)"
DOCKER_PREFIX=()
DEPLOY_STARTED=false
DEPLOY_COMPLETE=false
BACKUP_TEMP=""

stage() {
  printf '\n==> %s\n' "$1"
}

fail() {
  echo "ERROR: $1" >&2
  return 1
}

docker() {
  "${DOCKER_PREFIX[@]}" "${DOCKER_BIN}" "$@"
}

compose() {
  docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" "$@"
}

env_value() {
  local key="$1"
  local line

  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  [[ -n "${line}" ]] || fail "Missing ${key} in ${ENV_FILE}."
  printf '%s' "${line#*=}"
}

show_failure_context() {
  local original_status="$1"

  trap - ERR
  echo >&2
  echo "ERROR: Production deployment failed (exit ${original_status})." >&2
  if [[ "${DEPLOY_STARTED}" == true ]]; then
    compose logs --no-color --tail=120 control-plane 2>&1 \
      | sed -E \
        -e 's#(postgres(ql)?://)[^[:space:]@]+@#\1[REDACTED]@#g' \
        -e "s#((TOKEN|SECRET|PASSWORD|COOKIE)[\"']?[=:][[:space:]]*[\"']?)[^\"',[:space:]}]+#\\1[REDACTED]#Ig" \
      >&2 || true
  fi
  if [[ -n "${BACKUP_TEMP}" && -f "${BACKUP_TEMP}" ]]; then
    rm -f -- "${BACKUP_TEMP}" || true
  fi
  exit "${original_status}"
}

prune_old_backups() (
  local retention="$1"
  local -a backups=()
  local prune_count

  shopt -s nullglob
  backups=("${BACKUP_DIR}"/control-plane-production-*.sql.gz)
  prune_count=$(( ${#backups[@]} - retention ))
  if (( prune_count > 0 )); then
    rm -f -- "${backups[@]:0:prune_count}"
    echo "Pruned ${prune_count} old production backup(s)."
  fi
)

trap 'show_failure_context "$?"' ERR
trap 'show_failure_context 130' INT
trap 'show_failure_context 143' TERM

stage "Preflight"
for command_name in git curl gzip awk sed mktemp; do
  command -v "${command_name}" >/dev/null 2>&1 \
    || fail "Required command not found: ${command_name}"
done
[[ -n "${DOCKER_BIN}" ]] || fail "Required command not found: docker"
if ! "${DOCKER_BIN}" info >/dev/null 2>&1; then
  command -v sudo >/dev/null 2>&1 \
    || fail "Docker requires elevated access, but sudo is unavailable."
  sudo -v
  DOCKER_PREFIX=(sudo)
fi
docker compose version >/dev/null 2>&1 \
  || fail "Docker Compose plugin is unavailable."
docker info >/dev/null 2>&1 \
  || fail "Docker is unavailable."
[[ -f "${ENV_FILE}" ]] \
  || fail "Missing ${ENV_FILE}; copy .env.example, fill production values, and chmod 600 it."
[[ "$(stat -c '%a' "${ENV_FILE}")" == "600" ]] \
  || fail "${ENV_FILE} must have mode 600."

DOMAIN="$(env_value CONTROL_PLANE_DOMAIN)"
EDGE_NETWORK="$(env_value EDGE_DOCKER_NETWORK)"
POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
SALESWITCH_REPLICA_URL="$(env_value SALESWITCH_REPLICA_URL)"
SHOPIFY_API_KEY="$(env_value SHOPIFY_API_KEY)"
SHOPIFY_API_SECRET="$(env_value SHOPIFY_API_SECRET)"
[[ -n "${DOMAIN}" && -n "${EDGE_NETWORK}" ]] \
  || fail "CONTROL_PLANE_DOMAIN and EDGE_DOCKER_NETWORK must not be empty."
[[ -n "${POSTGRES_USER}" && -n "${POSTGRES_PASSWORD}" && -n "${POSTGRES_DB}" ]] \
  || fail "Production PostgreSQL values must not be empty."
[[ -n "${SALESWITCH_REPLICA_URL}" && -n "${SHOPIFY_API_KEY}" && -n "${SHOPIFY_API_SECRET}" ]] \
  || fail "SALESWITCH_REPLICA_URL, SHOPIFY_API_KEY, and SHOPIFY_API_SECRET must not be empty."
docker network inspect "${EDGE_NETWORK}" >/dev/null 2>&1 \
  || fail "Edge Docker network ${EDGE_NETWORK} does not exist."
compose config --quiet

git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "${REPO_ROOT} is not a Git checkout."
[[ "$(git -C "${REPO_ROOT}" rev-parse --show-toplevel)" == "${REPO_ROOT}" ]] \
  || fail "The deploy script does not resolve to the Git worktree root."
[[ -z "$(git -C "${REPO_ROOT}" status --porcelain=v1 --untracked-files=normal)" ]] \
  || fail "Git worktree is not clean; commit or remove local changes before production deployment."
BRANCH="$(git -C "${REPO_ROOT}" symbolic-ref --quiet --short HEAD)" \
  || fail "HEAD is detached."
UPSTREAM="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" \
  || fail "Branch ${BRANCH} has no upstream."
REMOTE="$(git -C "${REPO_ROOT}" config --get "branch.${BRANCH}.remote")" \
  || fail "Branch ${BRANCH} has no configured remote."

stage "Update source from Git"
git -C "${REPO_ROOT}" fetch --prune "${REMOTE}"
git -C "${REPO_ROOT}" pull --ff-only
[[ -z "$(git -C "${REPO_ROOT}" status --porcelain=v1 --untracked-files=normal)" ]] \
  || fail "Worktree became dirty after pull."
DEPLOYED_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
[[ "${DEPLOYED_SHA}" == "$(git -C "${REPO_ROOT}" rev-parse "${UPSTREAM}")" ]] \
  || fail "Local HEAD does not match ${UPSTREAM}."

DEPLOY_STARTED=true
stage "Start production PostgreSQL and Redis"
compose pull cp-postgres cp-redis
compose up -d cp-postgres cp-redis

dependencies_ready=false
for ((attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1)); do
  if compose exec -T cp-postgres sh -c \
      'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 \
    && [[ "$(compose exec -T cp-redis redis-cli ping 2>/dev/null || true)" == "PONG" ]]; then
    dependencies_ready=true
    break
  fi
  sleep 2
done
[[ "${dependencies_ready}" == true ]] \
  || fail "Production PostgreSQL or Redis did not become ready."

stage "Back up production PostgreSQL"
mkdir -p "${BACKUP_DIR}"
[[ -w "${BACKUP_DIR}" ]] \
  || fail "${BACKUP_DIR} is not writable by $(id -un)."
BACKUP_PATH="${BACKUP_DIR}/control-plane-production-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
BACKUP_TEMP="${BACKUP_PATH}.tmp"
compose exec -T cp-postgres sh -c \
  'exec pg_dump --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip >"${BACKUP_TEMP}"
gzip -t "${BACKUP_TEMP}"
mv -- "${BACKUP_TEMP}" "${BACKUP_PATH}"
BACKUP_TEMP=""
echo "Backup created: ${BACKUP_PATH}"
RETENTION="$(env_value BACKUP_RETENTION_COUNT || printf '14')"
[[ "${RETENTION}" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_RETENTION_COUNT must be positive."
prune_old_backups "${RETENTION}"

stage "Build application and schema images"
compose --profile operations build control-plane control-plane-schema

stage "Synchronize schema and seed required data"
compose --profile operations run --rm --no-deps control-plane-schema

stage "Restart production application"
compose up -d --no-deps --force-recreate control-plane
compose ps

stage "Verify readiness and authenticated UI"
ready=false
for ((attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1)); do
  if compose exec -T control-plane node -e '
    fetch("http://127.0.0.1:3000/readyz").then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
    })
  ' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "${ready}" == true ]] || fail "Internal /readyz did not become healthy."

compose exec -T control-plane node --input-type=module <<'NODE'
const origin = "http://127.0.0.1:3000";
const login = await fetch(`${origin}/dev-login?role=ADMIN&to=/`, { redirect: "manual" });
if (login.status < 300 || login.status >= 400) {
  throw new Error(`dev-login returned HTTP ${login.status}`);
}
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("dev-login did not issue a role cookie");
const home = await fetch(`${origin}/`, { headers: { cookie } });
const body = await home.text();
if (!home.ok) throw new Error(`authenticated / returned HTTP ${home.status}`);
if (body.includes("Unexpected Server Error") || body.includes("Something went wrong")) {
  throw new Error("authenticated / rendered the application error boundary");
}
const socket = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`);
const socketBody = await socket.text();
if (!socket.ok || !socketBody.includes('"sid"')) {
  throw new Error(`Socket.IO handshake failed (${socket.status})`);
}
console.log("Internal /readyz, authenticated /, and Socket.IO: OK");
NODE

stage "Verify public HTTPS edge"
edge_ready=false
edge_code="000"
for ((attempt = 1; attempt <= EDGE_ATTEMPTS; attempt += 1)); do
  edge_code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 5 --max-time 10 "https://${DOMAIN}/healthz" || true)"
  case "${edge_code}" in
    200 | 301 | 302 | 303 | 307 | 308 | 401 | 403)
      edge_ready=true
      break
      ;;
  esac
  sleep 5
done
[[ "${edge_ready}" == true ]] \
  || fail "Public HTTPS edge failed for https://${DOMAIN}/healthz (HTTP ${edge_code})."
echo "Public edge reachable (HTTP ${edge_code}; Cloudflare Access may intercept unauthenticated probes)."

DEPLOY_COMPLETE=true
stage "Production deployment complete"
echo "Commit: ${DEPLOYED_SHA}"
echo "URL:    https://${DOMAIN}"
