#!/usr/bin/env bash
# Open a project in an isolated Docker container with a copy of the app (host files are not modified).
# Third-party services (Postgres, OpenSearch, etc.) are not started.
#
#  Main use case: running scripts or commands in a safe/isolated/historyless/self-destroying environment.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

IMAGE="${OPEN_IN_CONTAINER_IMAGE:-mcr.microsoft.com/devcontainers/typescript-node:24}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <app>

Open the given app in a throwaway container. The app directory is copied into the container;
edits inside the shell do not change files on the host.

Supported apps:
  api    opencollective-api

Environment:
  OPEN_IN_CONTAINER_IMAGE   Override the Docker image (default: ${IMAGE})
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

APP="$1"
case "$APP" in
  api)
    PROJECT_DIR="${WORKSPACE_ROOT}/opencollective-api"
    DEST_NAME="opencollective-api"
    ;;
  *)
    echo "Unsupported app: ${APP}" >&2
    echo "Only 'api' is supported for now." >&2
    exit 1
    ;;
esac

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Project directory not found: ${PROJECT_DIR}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not on PATH." >&2
  exit 1
fi

# Read-only mount of the host project, then copy into the container filesystem so edits stay off the host.
echo "Starting container (--rm); copying project into /workspace/${DEST_NAME}..."
exec docker run --rm -it --init -u root \
  -v "${PROJECT_DIR}:/source:ro" \
  "${IMAGE}" \
  bash -lc "
    set -e
    mkdir -p '/workspace/${DEST_NAME}'
    cp -a /source/. '/workspace/${DEST_NAME}/'
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq postgresql-client || echo 'Warning: postgresql-client install failed; psql may be unavailable.' >&2
    cd '/workspace/${DEST_NAME}'
    exec bash -l
  "
