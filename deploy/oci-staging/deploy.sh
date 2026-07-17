#!/usr/bin/env bash
#
# Deploy Apoaap Control Plane staging on the shared OCI VM.
# Mirrors Badgy `deploy/oci-staging/deploy.sh` but targets this repo's Compose
# project (control-plane + its own Postgres + Redis). SaleSwitch Caddy must
# already reverse-proxy CONTROL_PLANE_DOMAIN → control-plane:3000.
#
# Usage (from any cwd):
#   bash /opt/app-control-plane/deploy/oci-staging/deploy.sh
#   bash /opt/app-control-plane/deploy/oci-staging/deploy.sh --allow-local-config

if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: Run this deployment script with Bash." >&2
  exit 2
fi

set -Eeuo pipefail
umask 077

usage() {
  echo "Usage: $0 [--allow-local-config]" >&2
}

ALLOW_LOCAL_CONFIG=false
if (( $# > 1 )); then
  usage
  exit 2
fi
if (( $# == 1 )); then
  if [[ "$1" != "--allow-local-config" ]]; then
    usage
    exit 2
  fi
  ALLOW_LOCAL_CONFIG=true
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
COMPOSE_DIR="${REPO_ROOT}/deploy/oci-staging"
ENV_FILE="${COMPOSE_DIR}/.env"
BACKUP_DIR="${BACKUP_DIR:-/opt/app-control-plane/backups}"
BACKUP_RETENTION_COUNT=2
WAIT_ATTEMPTS=30
HTTPS_ATTEMPTS=12
SERVICE_MUTATION_STARTED=false

stage() {
  printf '\n==> %s\n' "$1"
}

is_allowed_local_config() {
  case "$1" in
    deploy/oci-staging/docker-compose.yml \
      | deploy/oci-staging/Caddyfile.fragment \
      | deploy/oci-staging/.env.example)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_operational_path() {
  local path="$1"
  local backup_rel=""

  case "${BACKUP_DIR}" in
    "${REPO_ROOT}" | "${REPO_ROOT}/"*)
      backup_rel="${BACKUP_DIR#"${REPO_ROOT}/"}"
      backup_rel="${backup_rel%/}"
      [[ -n "${backup_rel}" ]] || return 1
      [[ "${path}" == "${backup_rel}" \
        || "${path}" == "${backup_rel}/" \
        || "${path}" == "${backup_rel}/"* ]]
      return
      ;;
    *)
      return 1
      ;;
  esac
}

fail() {
  echo "ERROR: $1" >&2
  handle_failure 1
}

cleanup_backup_temp() {
  local original_status="$1"

  trap - EXIT
  if [[ -n "${BACKUP_TEMP:-}" && -f "${BACKUP_TEMP}" ]]; then
    rm -f -- "${BACKUP_TEMP}" || true
  fi
  if [[ -n "${STATUS_TEMP:-}" && -f "${STATUS_TEMP}" ]]; then
    rm -f -- "${STATUS_TEMP}" || true
  fi
  exit "${original_status}"
}

prune_old_backups() (
  local -a backups=()
  local prune_count

  shopt -s nullglob
  backups=("${BACKUP_DIR}"/control-plane-pre-schema-*.sql.gz)
  prune_count=$(( ${#backups[@]} - BACKUP_RETENTION_COUNT ))

  if (( prune_count > 0 )); then
    rm -f -- "${backups[@]:0:prune_count}"
    echo "Pruned ${prune_count} old backup(s); kept the latest ${BACKUP_RETENTION_COUNT}."
  fi
)

show_failure_logs() {
  if command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && [[ -d "${COMPOSE_DIR}" ]]; then
    echo "Recent control-plane logs:" >&2
    (
      cd "${COMPOSE_DIR}"
      docker compose logs --no-color --tail=80 control-plane 2>&1 \
        | sed -E \
          -e 's#(postgres(ql)?://)[^[:space:]@]+@#\1[REDACTED]@#g' \
          -e "s#((TOKEN|SECRET|PASSWORD|COOKIE|ENCRYPTION_KEY)[\"']?[=:][[:space:]]*[\"']?)[^\"',[:space:]}]+#\\1[REDACTED]#Ig"
    ) >&2 || true
  fi
}

handle_failure() {
  local original_status="$1"

  trap - ERR
  trap '' INT TERM
  echo >&2
  echo "ERROR: Deployment failed (exit ${original_status})." >&2

  if [[ "${SERVICE_MUTATION_STARTED}" == true ]]; then
    show_failure_logs
  fi

  exit "${original_status}"
}

validate_worktree() {
  local -a records=()
  local -a dirty_statuses=()
  local -a dirty_paths=()
  local -a rejected_statuses=()
  local -a rejected_paths=()
  local record status path original_path
  local index

  STATUS_TEMP="$(mktemp)"
  if ! git -C "${REPO_ROOT}" status \
    --porcelain=v1 -z --untracked-files=normal >"${STATUS_TEMP}"; then
    rm -f -- "${STATUS_TEMP}"
    STATUS_TEMP=
    fail "Could not read Git worktree status."
  fi
  mapfile -d '' -t records <"${STATUS_TEMP}"
  rm -f -- "${STATUS_TEMP}"
  STATUS_TEMP=

  for ((index = 0; index < ${#records[@]}; index += 1)); do
    record="${records[index]}"
    if (( ${#record} < 4 )) || [[ "${record:2:1}" != " " ]]; then
      fail "Could not safely parse Git worktree status."
    fi

    status="${record:0:2}"
    path="${record:3}"

    if [[ "${status}" == *[RC]* ]]; then
      ((index += 1))
      if (( index >= ${#records[@]} )); then
        fail "Could not safely parse Git rename/copy status."
      fi
      original_path="${records[index]}"
      if is_operational_path "${path}" && is_operational_path "${original_path}"; then
        continue
      fi
      dirty_statuses+=("${status}" "${status}")
      dirty_paths+=("${path}" "${original_path}")
      if [[ "${ALLOW_LOCAL_CONFIG}" == false ]] \
        || ! is_allowed_local_config "${path}" \
        || ! is_allowed_local_config "${original_path}"; then
        rejected_statuses+=("${status}" "${status}")
        rejected_paths+=("${path}" "${original_path}")
      fi
      continue
    fi

    if is_operational_path "${path}"; then
      continue
    fi

    dirty_statuses+=("${status}")
    dirty_paths+=("${path}")
    if [[ "${ALLOW_LOCAL_CONFIG}" == false ]] || ! is_allowed_local_config "${path}"; then
      rejected_statuses+=("${status}")
      rejected_paths+=("${path}")
    fi
  done

  if [[ "${ALLOW_LOCAL_CONFIG}" == false ]]; then
    (( ${#dirty_paths[@]} == 0 )) \
      || fail "Git worktree is not clean; commit or remove tracked/untracked changes first."
    return
  fi

  if (( ${#rejected_paths[@]} > 0 )); then
    echo "ERROR: Git worktree contains changes outside --allow-local-config:" >&2
    for ((index = 0; index < ${#rejected_paths[@]}; index += 1)); do
      printf '  %s %q\n' \
        "${rejected_statuses[index]}" "${rejected_paths[index]}" >&2
    done
    handle_failure 1
  fi

  if (( ${#dirty_paths[@]} > 0 )); then
    echo "Permitted local configuration changes:"
    for ((index = 0; index < ${#dirty_paths[@]}; index += 1)); do
      printf '  %s %q\n' "${dirty_statuses[index]}" "${dirty_paths[index]}"
    done
  fi
}

load_env_value() {
  local key="$1"
  local line value

  [[ -f "${ENV_FILE}" ]] || return 1
  line="$(
    grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true
  )"
  [[ -n "${line}" ]] || return 1
  value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "${value}"
}

trap 'handle_failure "$?"' ERR
trap 'cleanup_backup_temp "$?"' EXIT
trap 'handle_failure 130' INT
trap 'handle_failure 143' TERM

stage "Preflight"
for required_command in bash git docker curl gzip awk sed mktemp; do
  command -v "${required_command}" >/dev/null 2>&1 \
    || fail "Required command not found: ${required_command}"
done

docker compose version >/dev/null 2>&1 \
  || fail "Docker Compose is unavailable; install the Docker Compose plugin."
docker info >/dev/null 2>&1 \
  || fail "Docker is unavailable or the current user cannot access the daemon."
[[ -f "${ENV_FILE}" ]] \
  || fail "Missing ${ENV_FILE}; create it from .env.example and set staging values."

CONTROL_PLANE_DOMAIN="$(load_env_value CONTROL_PLANE_DOMAIN || true)"
[[ -n "${CONTROL_PLANE_DOMAIN}" ]] \
  || fail "CONTROL_PLANE_DOMAIN is required in ${ENV_FILE}."

POSTGRES_USER="$(load_env_value POSTGRES_USER || true)"
POSTGRES_PASSWORD="$(load_env_value POSTGRES_PASSWORD || true)"
POSTGRES_DB="$(load_env_value POSTGRES_DB || true)"
[[ -n "${POSTGRES_USER}" && -n "${POSTGRES_PASSWORD}" && -n "${POSTGRES_DB}" ]] \
  || fail "POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB are required in ${ENV_FILE} (see .env.example). Do not rely on CONTROL_PLANE_DATABASE_URL alone — Compose builds that URL from these three."

SALESWITCH_DOCKER_NETWORK="$(load_env_value SALESWITCH_DOCKER_NETWORK || true)"
SALESWITCH_DOCKER_NETWORK="${SALESWITCH_DOCKER_NETWORK:-oci-staging_default}"
docker network inspect "${SALESWITCH_DOCKER_NETWORK}" >/dev/null 2>&1 \
  || fail "Docker network ${SALESWITCH_DOCKER_NETWORK} not found. Start SaleSwitch staging first (its Caddy owns 80/443), or set SALESWITCH_DOCKER_NETWORK."

# Guard against colliding with SaleSwitch's Compose project name.
COMPOSE_PROJECT="$(
  cd "${COMPOSE_DIR}"
  docker compose config --format json 2>/dev/null \
    | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
)"
if [[ -z "${COMPOSE_PROJECT}" ]]; then
  COMPOSE_PROJECT="$(
    cd "${COMPOSE_DIR}"
    docker compose config 2>/dev/null | awk '/^name:/ { print $2; exit }'
  )"
fi
[[ "${COMPOSE_PROJECT}" != "oci-staging" ]] \
  || fail "Compose project name is 'oci-staging' (SaleSwitch). Set 'name: control-plane-staging' in docker-compose.yml and re-pull."


git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "${REPO_ROOT} is not inside a Git worktree."

GIT_ROOT="$(git -C "${REPO_ROOT}" rev-parse --show-toplevel)"
[[ "${GIT_ROOT}" == "${REPO_ROOT}" ]] \
  || fail "The script location does not resolve to the Git worktree root."

CURRENT_BRANCH="$(git -C "${REPO_ROOT}" symbolic-ref --quiet --short HEAD)" \
  || fail "HEAD is detached; check out the intended staging branch first."
UPSTREAM_REF="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" \
  || fail "Branch ${CURRENT_BRANCH} has no configured upstream."
UPSTREAM_REMOTE="$(git -C "${REPO_ROOT}" config --get "branch.${CURRENT_BRANCH}.remote")" \
  || fail "Branch ${CURRENT_BRANCH} has no configured upstream remote."
git -C "${REPO_ROOT}" remote get-url "${UPSTREAM_REMOTE}" >/dev/null 2>&1 \
  || fail "Configured upstream remote ${UPSTREAM_REMOTE} is unavailable."

validate_worktree

echo "Branch: ${CURRENT_BRANCH} (upstream: ${UPSTREAM_REF})"
echo "Domain: ${CONTROL_PLANE_DOMAIN}"
echo "Compose project: ${COMPOSE_PROJECT:-control-plane-staging}"
echo "SaleSwitch network: ${SALESWITCH_DOCKER_NETWORK}"

stage "Update source"
git -C "${REPO_ROOT}" fetch --prune "${UPSTREAM_REMOTE}"
git -C "${REPO_ROOT}" pull --ff-only
validate_worktree
LOCAL_HEAD="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
UPSTREAM_HEAD="$(git -C "${REPO_ROOT}" rev-parse "${UPSTREAM_REF}")"
[[ "${LOCAL_HEAD}" == "${UPSTREAM_HEAD}" ]] \
  || fail "Local HEAD does not exactly match ${UPSTREAM_REF}; push or reconcile local commits before deploying."
DEPLOYED_SHA="${LOCAL_HEAD}"

stage "Validate Compose configuration"
(
  cd "${COMPOSE_DIR}"
  docker compose config --quiet
)

SERVICE_MUTATION_STARTED=true
stage "Start PostgreSQL and Redis"
(
  cd "${COMPOSE_DIR}"
  docker compose up -d cp-postgres cp-redis
)

postgres_ready=false
redis_ready=false
for ((attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1)); do
  if (
    cd "${COMPOSE_DIR}"
    docker compose exec -T cp-postgres sh -c \
      'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1
  ); then
    postgres_ready=true
  fi

  if (
    cd "${COMPOSE_DIR}"
    [[ "$(docker compose exec -T cp-redis redis-cli ping 2>/dev/null)" == "PONG" ]]
  ); then
    redis_ready=true
  fi

  if [[ "${postgres_ready}" == true && "${redis_ready}" == true ]]; then
    break
  fi

  sleep 2
done

[[ "${postgres_ready}" == true ]] || fail "PostgreSQL did not become ready."
[[ "${redis_ready}" == true ]] || fail "Redis did not become ready."
echo "PostgreSQL and Redis are ready."

stage "Back up PostgreSQL"
mkdir -p "${BACKUP_DIR}"
BACKUP_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH="${BACKUP_DIR}/control-plane-pre-schema-${BACKUP_TIMESTAMP}-${BASHPID}.sql.gz"
BACKUP_TEMP="${BACKUP_PATH}.tmp"
(
  cd "${COMPOSE_DIR}"
  docker compose exec -T cp-postgres sh -c \
    'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"'
) | gzip >"${BACKUP_TEMP}"
gzip -t "${BACKUP_TEMP}"
mv "${BACKUP_TEMP}" "${BACKUP_PATH}"
echo "Backup created: ${BACKUP_PATH}"
prune_old_backups

stage "Build control-plane image"
(
  cd "${COMPOSE_DIR}"
  docker compose build control-plane
)

# This repo currently ships schema.prisma without a migrations/ history on staging;
# `db push` matches the live VM. When migrations are committed, switch this step to
# `npx prisma migrate deploy`.
stage "Sync database schema"
(
  cd "${COMPOSE_DIR}"
  docker compose run --rm --no-deps control-plane \
    npx prisma db push --skip-generate
)

stage "Start control-plane stack"
(
  cd "${COMPOSE_DIR}"
  docker compose up -d
)

stage "Verify services"
REDIS_RESPONSE="$(
  cd "${COMPOSE_DIR}"
  docker compose exec -T cp-redis redis-cli ping
)"
[[ "${REDIS_RESPONSE}" == "PONG" ]] || fail "Redis verification failed."
echo "Redis: PONG"

CMD_LINE="$(
  cd "${COMPOSE_DIR}"
  docker compose exec -T control-plane \
    sh -c 'tr "\0" " " < /proc/1/cmdline; echo' 2>/dev/null || true
)"
echo "PID 1: ${CMD_LINE:-unknown}"
[[ "${CMD_LINE}" == *'build/server/prod.js'* ]] \
  || fail "control-plane is not running build/server/prod.js (Socket.IO will be missing). Got: ${CMD_LINE:-empty}"

(
  cd "${COMPOSE_DIR}"
  docker compose ps
)

PUBLIC_URL="https://${CONTROL_PLANE_DOMAIN}"
BASIC_AUTH="$(load_env_value CONTROL_PLANE_BASIC_AUTH || true)"
CURL_AUTH_ARGS=()
if [[ -n "${BASIC_AUTH}" ]]; then
  CURL_AUTH_ARGS=(-u "${BASIC_AUTH}")
fi

printf 'HTTPS healthz: %s ' "${PUBLIC_URL}/healthz"
https_ready=false
for ((attempt = 1; attempt <= HTTPS_ATTEMPTS; attempt += 1)); do
  if curl --fail --silent \
    "${CURL_AUTH_ARGS[@]}" \
    --output /dev/null \
    --connect-timeout 5 \
    --max-time 10 \
    "${PUBLIC_URL}/healthz"; then
    https_ready=true
    break
  fi

  printf '.'
  sleep 5
done
echo
[[ "${https_ready}" == true ]] \
  || fail "Public HTTPS /healthz verification failed. Confirm SaleSwitch Caddy proxies ${CONTROL_PLANE_DOMAIN} → control-plane:3000 and Basic Auth (if any) is in CONTROL_PLANE_BASIC_AUTH."

printf 'Socket.IO polling: %s ' "${PUBLIC_URL}/socket.io/?EIO=4&transport=polling"
socket_ready=false
SOCKET_BODY="$(mktemp)"
for ((attempt = 1; attempt <= HTTPS_ATTEMPTS; attempt += 1)); do
  if curl --fail --silent \
    "${CURL_AUTH_ARGS[@]}" \
    --output "${SOCKET_BODY}" \
    --connect-timeout 5 \
    --max-time 10 \
    "${PUBLIC_URL}/socket.io/?EIO=4&transport=polling" \
    && grep -q '"sid"' "${SOCKET_BODY}"; then
    socket_ready=true
    break
  fi

  printf '.'
  sleep 5
done
rm -f -- "${SOCKET_BODY}"
echo
[[ "${socket_ready}" == true ]] \
  || fail "Socket.IO handshake failed. Confirm the container runs node ./build/server/prod.js (not react-router-serve)."

stage "Deployment complete"
echo "Deployed commit: ${DEPLOYED_SHA}"
echo "Public URL: ${PUBLIC_URL}"
