#!/bin/bash

# Install dependencies (npm install) in Open Collective sub-projects
# Usage: ./scripts/install-dependencies.sh [project...]
# Example: ./scripts/install-dependencies.sh              # All projects in parallel
# Example: ./scripts/install-dependencies.sh frontend api  # Only frontend and api

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Project name mapping (short name -> directory)
declare -A PROJECT_MAP
PROJECT_MAP[frontend]="opencollective-frontend"
PROJECT_MAP[api]="opencollective-api"
PROJECT_MAP[rest]="opencollective-rest"
PROJECT_MAP[pdf]="opencollective-pdf"
PROJECT_MAP[taxes]="opencollective-taxes"
PROJECT_MAP[images]="opencollective-images"
PROJECT_MAP[tools]="opencollective-tools"
PROJECT_MAP[watch]="opencollective-watch"

# All projects in default order
ALL_PROJECTS=(frontend api rest pdf taxes images tools watch)

show_help() {
    echo "Usage: $0 [-h|--help] [project...]"
    echo ""
    echo "Installs dependencies (npm install) in Open Collective sub-projects in parallel."
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Projects (use short names):"
    echo "  frontend, api, rest, pdf, taxes, images, tools, watch"
    echo ""
    echo "Examples:"
    echo "  $0                    Install in all projects"
    echo "  $0 frontend api       Install only in frontend and api"
    exit 0
}

# Parse arguments
FILTER_ARGS=()
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            ;;
        -*)
            echo -e "${RED}Error: Unknown option $1${NC}" >&2
            exit 1
            ;;
        *)
            if [[ -v PROJECT_MAP[$1] ]]; then
                FILTER_ARGS+=("$1")
            else
                echo -e "${RED}Error: Unknown project '$1'. Available: ${!PROJECT_MAP[*]}${NC}" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

# Get workspace root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$WORKSPACE_ROOT"

# Determine which projects to install
if [[ ${#FILTER_ARGS[@]} -eq 0 ]]; then
    PROJECTS_TO_INSTALL=("${ALL_PROJECTS[@]}")
    echo -e "${GREEN}Installing dependencies in all projects (parallel)...${NC}"
else
    PROJECTS_TO_INSTALL=("${FILTER_ARGS[@]}")
    echo -e "${GREEN}Installing dependencies in: ${PROJECTS_TO_INSTALL[*]}${NC}"
fi

# Run npm install in each project in parallel
FAILED_FILE=$(mktemp)
trap 'rm -f "$FAILED_FILE"' EXIT

for project in "${PROJECTS_TO_INSTALL[@]}"; do
    dir="${PROJECT_MAP[$project]}"
    if [[ ! -d "$dir" ]]; then
        echo -e "${YELLOW}Warning: $dir not found, skipping${NC}"
        continue
    fi
    if [[ ! -f "$dir/package.json" ]]; then
        echo -e "${YELLOW}Warning: $dir has no package.json, skipping${NC}"
        continue
    fi
    (
        if (cd "$dir" && npm install); then
            echo -e "${GREEN}✓ $project done${NC}"
        else
            echo -e "${RED}✗ $project failed${NC}" >&2
            echo "$project" >> "$FAILED_FILE"
            exit 1
        fi
    ) &
done

wait || true

if [[ -s "$FAILED_FILE" ]]; then
    echo -e "${RED}Some installations failed${NC}" >&2
    exit 1
fi