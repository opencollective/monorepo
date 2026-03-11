#!/usr/bin/env bash
# Run coverage for a feature in an Open Collective project.
# Usage: ./run-feature-coverage.sh <project> [path-filter]
# Examples:
#   ./run-feature-coverage.sh opencollective-api
#   ./run-feature-coverage.sh opencollective-api test/server/graphql/v2/mutation
#   ./run-feature-coverage.sh opencollective-frontend components/edit-collective
#
# Run from workspace root. Output: coverage/ in project dir, also printed to stdout.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Script lives at .agents/skills/review-feature-tests/scripts/; workspace root is 4 levels up
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PROJECT="${1:-}"
PATH_FILTER="${2:-}"

if [[ -z "$PROJECT" ]]; then
  echo -e "${RED}Usage: $0 <project> [path-filter]${NC}"
  echo ""
  echo "Projects: opencollective-frontend, opencollective-api, opencollective-pdf, opencollective-rest"
  echo ""
  echo "Examples:"
  echo "  $0 opencollective-api"
  echo "  $0 opencollective-api test/server/graphql/v2/mutation"
  echo "  $0 opencollective-frontend components/edit-collective"
  exit 1
fi

PROJECT_DIR="$WORKSPACE_ROOT/$PROJECT"
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo -e "${RED}Project directory not found: $PROJECT_DIR${NC}"
  exit 1
fi

cd "$PROJECT_DIR"

echo -e "${GREEN}Running coverage for $PROJECT${NC}"
if [[ -n "$PATH_FILTER" ]]; then
  echo -e "${YELLOW}Path filter: $PATH_FILTER${NC}"
fi
echo ""

case "$PROJECT" in
  opencollective-frontend)
    # Jest: pass path to limit scope
    if [[ -n "$PATH_FILTER" ]]; then
      npm run test:coverage -- "$PATH_FILTER"
    else
      npm run test:coverage
    fi
    ;;
  opencollective-api)
    # Mocha: npm run test:coverage -- <paths> passes paths to mocha
    if [[ -n "$PATH_FILTER" ]]; then
      # Ensure path is under test/
      TARGET="$PATH_FILTER"
      [[ "$TARGET" != test/* ]] && TARGET="test/$TARGET"
      npm run test:coverage -- "$TARGET"
    else
      npm run test:coverage
    fi
    ;;
  opencollective-pdf)
    # Vitest: supports path as positional arg
    if [[ -n "$PATH_FILTER" ]]; then
      npm run test:coverage -- "$PATH_FILTER"
    else
      npm run test:coverage
    fi
    ;;
  opencollective-rest)
    if [[ -n "$PATH_FILTER" ]]; then
      npm run test -- "$PATH_FILTER"
    else
      npm run test
    fi
    ;;
  *)
    echo -e "${RED}Unknown project: $PROJECT${NC}"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}Coverage complete. Check $PROJECT_DIR/coverage/ for HTML report.${NC}"
