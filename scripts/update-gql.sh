#!/bin/bash

# Refresh local GraphQL schema files in Open Collective projects that support it.
#
# Projects that pull schema from the running API (http://localhost:3060) via introspection
# or codegen must have the API up first (e.g. ./scripts/run.sh or opencollective-api on :3060).
# opencollective-rest: copies from local opencollective-frontend when present; otherwise
# runs "graphql:update" (fetches from GitHub main) so the script still works in partial checkouts.
#
# Usage: ./scripts/update-gql.sh [-h|--help] [project...]
# Example: ./scripts/update-gql.sh api frontend
# With no project arguments, all supported projects are updated (in a fixed order).
#
# See each repo's package.json "graphql:update" scripts for details.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Short name -> directory (only projects with graphql:update in this monorepo)
declare -A PROJECT_MAP
PROJECT_MAP[api]="opencollective-api"
PROJECT_MAP[frontend]="opencollective-frontend"
PROJECT_MAP[pdf]="opencollective-pdf"
PROJECT_MAP[images]="opencollective-images"
PROJECT_MAP[rest]="opencollective-rest"

# Order when running multiple: api first, then frontend, then the rest, then opencollective-rest last (may copy from frontend)
ORDER=(api frontend pdf images rest)

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_step() {
    echo -e "${BLUE}[update-gql]${NC} $1"
}

print_skip() {
    echo -e "${YELLOW}[update-gql]${NC} Skipping $1 (directory not found)"
}

run_npm_graphql_update() {
    local name="$1"
    local relpath="$2"
    local dir="$WORKSPACE_ROOT/$relpath"
    if [[ ! -d "$dir" ]]; then
        print_skip "$name"
        return 0
    fi
    if [[ ! -f "$dir/package.json" ]]; then
        print_skip "$name (no package.json)"
        return 0
    fi
    print_step "Running npm run graphql:update in $relpath"
    (cd "$dir" && npm run graphql:update)
    echo -e "${GREEN}[update-gql]${NC} Done: $relpath"
    echo ""
}

update_rest() {
    local rest_dir="$WORKSPACE_ROOT/opencollective-rest"
    local fe_dir="$WORKSPACE_ROOT/opencollective-frontend"
    if [[ ! -d "$rest_dir" ]]; then
        print_skip "opencollective-rest"
        return 0
    fi
    if [[ -d "$fe_dir/lib/graphql" ]] && compgen -G "$fe_dir/lib/graphql/*.graphql" > /dev/null; then
        print_step "Syncing opencollective-rest from local opencollective-frontend (schema files)"
        cp "$fe_dir"/lib/graphql/*.graphql "$rest_dir"/src/graphql/
        (cd "$rest_dir" && npx prettier --write src/graphql/*.graphql)
    else
        print_step "Running npm run graphql:update in opencollective-rest (GitHub main; no local frontend or no .graphql files)"
        (cd "$rest_dir" && npm run graphql:update)
    fi
    echo -e "${GREEN}[update-gql]${NC} Done: opencollective-rest"
}

show_help() {
    echo "Usage: $0 [-h|--help] [project...]"
    echo ""
    echo "Runs GraphQL schema refresh. With no project arguments, all supported"
    echo "repositories are updated. With one or more short names, only those are updated"
    echo "(in a fixed order: api → frontend → pdf → images → rest), not the order of arguments."
    echo ""
    echo "Projects (short names): api, frontend, pdf, images, rest"
    echo ""
    echo "Requires the API to be running at http://localhost:3060 for projects that"
    echo "introspect or codegen against the local server (not opencollective-rest when"
    echo "using the local-frontend copy path)."
    exit 0
}

FILTER_ARGS=()
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            ;;
        -*)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            echo "Use -h for help." >&2
            exit 1
            ;;
        *)
            if [[ -v "PROJECT_MAP[$1]" ]]; then
                FILTER_ARGS+=("$1")
            else
                echo -e "${RED}Error: unknown project '$1'.${NC}" >&2
                echo "Valid short names: ${!PROJECT_MAP[@]}" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

declare -A RUN
if [[ ${#FILTER_ARGS[@]} -eq 0 ]]; then
    for k in "${ORDER[@]}"; do
        RUN[$k]=1
    done
    echo -e "${GREEN}Updating all supported projects.${NC}"
else
    for p in "${FILTER_ARGS[@]}"; do
        RUN[$p]=1
    done
    SELECTED_LABEL=()
    for k in "${ORDER[@]}"; do
        [[ -n ${RUN[$k]+x} ]] && SELECTED_LABEL+=("$k")
    done
    echo -e "${GREEN}Updating: ${SELECTED_LABEL[*]}${NC}"
fi
echo -e "${YELLOW}Tip: start the API on port 3060 before running this, except when only${NC}"
echo -e "${YELLOW}     refreshing opencollective-rest from GitHub (no local API needed).${NC}"
echo ""

for key in "${ORDER[@]}"; do
    [[ -n ${RUN[$key]+x} ]] || continue
    case "$key" in
        api) run_npm_graphql_update "opencollective-api" "opencollective-api" ;;
        frontend) run_npm_graphql_update "opencollective-frontend" "opencollective-frontend" ;;
        pdf) run_npm_graphql_update "opencollective-pdf" "opencollective-pdf" ;;
        images) run_npm_graphql_update "opencollective-images" "opencollective-images" ;;
        rest) update_rest ;;
    esac
done

echo -e "${GREEN}[update-gql] All steps finished.${NC}"
