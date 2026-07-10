#!/usr/bin/env bash
#
# dev-up.sh — one-shot local launcher for the Apoaap Control Plane.
#
# What it does, in order:
#   1. Makes sure the control-plane Postgres (Docker) is up on :5544
#   2. Ensures .env exists and deps are installed
#   3. Syncs the Prisma schema + seeds the App registry (both idempotent)
#   4. Kills any stale dev server holding the port, then starts a fresh one
#
# Badgy/SaleSwitch does NOT need to run — its data is served by an in-memory
# fixture (see app/server/connectors/registry.ts). Redis is not needed for `dev`.
#
# Usage:  ./scripts/dev-up.sh        (run from anywhere; logs stream to your terminal)
# Stop:   Ctrl-C                     (stops the dev server; Postgres stays up)

set -euo pipefail  # -e: exit on any error · -u: error on unset vars · -o pipefail: fail a pipe if any stage fails

# ── Config (override by exporting before you run, e.g. `DEV_PORT=3001 ./scripts/dev-up.sh`) ──
DEV_PORT="${DEV_PORT:-5173}"            # Vite dev server port (React Router default)
PG_CONTAINER="${PG_CONTAINER:-cp-pg}"   # name of the Postgres Docker container
PG_PORT="${PG_PORT:-5544}"              # host port mapped to Postgres (matches .env DSN)
PG_USER="${PG_USER:-cp}"                # Postgres user (matches .env DSN)
PG_PASS="${PG_PASS:-cp}"                # Postgres password (matches .env DSN)
PG_DB="${PG_DB:-control_plane}"         # Postgres database name (matches .env DSN)
PG_IMAGE="${PG_IMAGE:-postgres:16}"     # Postgres image tag

# Resolve the repo root from this script's own location, so it works no matter
# what directory you invoke it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"  # absolute path of scripts/
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                    # one level up = project root
cd "$ROOT_DIR"                                              # all commands below run from the repo root

# Tiny logging helper so each step is easy to spot in the output.
log() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }   # cyan "▶ message"

# ── free_port: kill whatever process is listening on a TCP port ───────────────
# Tries lsof, then fuser, then ss — whichever exists on this box (WSL varies).
# This is what makes "server already running" safe: we reclaim the port first.
free_port() {
  local port="$1" pids=""                                   # port to free; pids found listening on it
  if command -v lsof >/dev/null 2>&1; then                  # preferred: lsof gives PIDs directly
    pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then               # fallback: fuser (psmisc)
    pids="$(fuser "${port}/tcp" 2>/dev/null | tr -s ' ' '\n' || true)"
  elif command -v ss >/dev/null 2>&1; then                  # last resort: parse ss output for pid=NNN
    pids="$(ss -ltnp 2>/dev/null | grep -E ":${port} " | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
  fi
  if [ -n "${pids//[[:space:]]/}" ]; then                   # if we found any PIDs (ignoring whitespace)
    log "Port ${port} is busy — stopping PID(s): ${pids//$'\n'/ }"
    kill ${pids} 2>/dev/null || true                        # polite SIGTERM first
    sleep 1                                                  # give them a moment to release the socket
    kill -9 ${pids} 2>/dev/null || true                     # SIGKILL any stragglers
  fi
}

# ── 1. Postgres ───────────────────────────────────────────────────────────────
log "Ensuring Postgres container '${PG_CONTAINER}' is running on :${PG_PORT}"
command -v docker >/dev/null 2>&1 || { echo "✖ Docker not found. Install Docker / enable WSL integration."; exit 1; }

if docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then        # container exists AND is running?
  log "Postgres already running — reusing it."
elif docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then   # container exists but is stopped?
  log "Starting existing Postgres container."
  docker start "$PG_CONTAINER" >/dev/null                                  # start the stopped container
else                                                                       # container doesn't exist at all?
  log "Creating Postgres container."
  docker run -d --name "$PG_CONTAINER" \
    -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_DB="$PG_DB" \
    -p "${PG_PORT}:5432" "$PG_IMAGE" >/dev/null                            # -d detached; map host:container ports
fi

# Wait until Postgres is actually accepting connections before touching Prisma,
# otherwise `db push` can race the container startup and fail.
log "Waiting for Postgres to accept connections…"
for i in $(seq 1 30); do                                                   # up to ~30s
  if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    log "Postgres is ready."
    break
  fi
  [ "$i" -eq 30 ] && { echo "✖ Postgres did not become ready in time."; exit 1; }  # give up after 30 tries
  sleep 1
done

# ── 2. Env file + dependencies ────────────────────────────────────────────────
if [ ! -f .env ]; then                       # no .env yet?
  log "Creating .env from .env.example (placeholders pass config validation)."
  cp .env.example .env
fi

if [ ! -d node_modules ]; then               # deps not installed yet?
  log "Installing npm dependencies (first run only)."
  npm install
else
  log "Dependencies already installed — skipping npm install."
fi

# ── 3. Prisma schema + seed (both idempotent, safe to re-run) ─────────────────
log "Generating Prisma client."
npx prisma generate                          # regenerate the typed client from schema.prisma

log "Syncing schema to the database (db push)."
npx prisma db push                           # create/update tables to match schema (no migrations dir exists)

log "Seeding the App registry (upsert — safe to repeat)."
npm run seed                                 # inserts/updates the 'saleswitch' registry row

# ── 4. (Re)start the dev server ───────────────────────────────────────────────
free_port "$DEV_PORT"                         # stop any previous dev server still holding the port

log "Starting dev server → http://localhost:${DEV_PORT}"
echo   "   Log in via: http://localhost:${DEV_PORT}/dev-login?role=ADMIN&to=/"
echo   "   (swap role= for SUPPORT or VIEWER to test RBAC · Ctrl-C to stop)"
exec npm run dev                              # exec replaces this script so Ctrl-C goes straight to Vite
