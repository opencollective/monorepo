#!/usr/bin/env bash
# Start the existing API dependency services with Docker or Podman Compose.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve the checkout from this script or an explicit root.
PROJECT_ROOT="${OC_MONOREPO_ROOT:-$(dirname "$SCRIPT_DIR")}"
COMPOSE_DIR="$PROJECT_ROOT/opencollective-api/docker-compose"
engine="${OC_CONTAINER_ENGINE:-}"
detached=false
services=()

usage() {
  echo "Usage: $0 [--engine docker|podman] [--detach] <db|mail|uploads|search|...>"
  echo "Defaults to Docker if installed, otherwise Podman."
}

while (($#)); do
  case "$1" in
    --engine)
      [[ $# -ge 2 ]] || { usage >&2; exit 1; }
      engine="$2"
      shift 2
      ;;
    --detach|-d) detached=true; shift ;;
    --help|-h) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) services+=("$1"); shift ;;
  esac
done

((${#services[@]})) || { usage >&2; exit 1; }
if [[ -z "$engine" ]]; then
  # Retain Podman support for existing devcontainer users. The VM explicitly
  # selects the Docker engine installed during provisioning.
  if command -v docker >/dev/null 2>&1; then engine=docker; else engine=podman; fi
fi
[[ "$engine" == docker || "$engine" == podman ]] || { echo "Engine must be docker or podman" >&2; exit 1; }
command -v "$engine" >/dev/null || { echo "$engine is not installed" >&2; exit 1; }

compose_files=()
for service in "${services[@]}"; do
  # Service names select tracked Compose files, never arbitrary paths supplied
  # by the caller. Check all selections before starting any containers.
  [[ "$service" =~ ^[a-zA-Z0-9_-]+$ && -f "$COMPOSE_DIR/$service.yml" ]] || {
    echo "Unknown dependency: $service (see $COMPOSE_DIR/*.yml)" >&2
    exit 1
  }
  compose_files+=(-f "$COMPOSE_DIR/$service.yml")
done

cd "$PROJECT_ROOT"
up_args=(up)
if [[ "$detached" == true ]]; then up_args+=(-d); fi
"$engine" compose "${compose_files[@]}" "${up_args[@]}"
