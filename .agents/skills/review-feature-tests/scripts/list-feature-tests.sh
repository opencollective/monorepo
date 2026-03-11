#!/usr/bin/env bash
# List test files related to a feature in an Open Collective project.
# Usage: ./list-feature-tests.sh <project> <path-or-keyword>
# Examples:
#   ./list-feature-tests.sh opencollective-api server/graphql/v2/mutation/ExpenseMutations
#   ./list-feature-tests.sh opencollective-frontend ReceivingMoney
#   ./list-feature-tests.sh opencollective-api expense
#
# Run from workspace root.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Script lives at .agents/skills/review-feature-tests/scripts/; workspace root is 4 levels up
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PROJECT="${1:-}"
QUERY="${2:-}"

if [[ -z "$PROJECT" || -z "$QUERY" ]]; then
  echo -e "${RED}Usage: $0 <project> <path-or-keyword>${NC}"
  echo ""
  echo "Projects: opencollective-frontend, opencollective-api, opencollective-pdf, opencollective-rest"
  echo ""
  echo "Examples:"
  echo "  $0 opencollective-api server/graphql/v2/mutation/ExpenseMutations"
  echo "  $0 opencollective-frontend ReceivingMoney"
  echo "  $0 opencollective-api expense"
  exit 1
fi

PROJECT_DIR="$WORKSPACE_ROOT/$PROJECT"
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo -e "${RED}Project directory not found: $PROJECT_DIR${NC}"
  exit 1
fi

cd "$WORKSPACE_ROOT"

case "$PROJECT" in
  opencollective-frontend)
    # Jest: *.test.tsx, *.test.ts, __tests__/
    # Path-based: convert source path to test path (e.g. components/X → components/X.test.tsx or components/X/__tests__/)
    # Keyword: grep in test files
    if [[ "$QUERY" == *"/"* ]]; then
      # Path: try common patterns
      BASE="${QUERY%.test.*}"
      BASE="${BASE#components/}"
      BASE="${BASE#lib/}"
      BASE="${BASE#pages/}"
      find "$PROJECT_DIR" -type f \( -name "*.test.tsx" -o -name "*.test.ts" -o -name "*.test.js" \) \
        | grep -iE "(/${BASE}|${BASE}/|${BASE}\\.)" \
        | sort
    else
      # Keyword search
      grep -riFl "$QUERY" "$PROJECT_DIR" --include="*.test.tsx" --include="*.test.ts" --include="*.test.js" 2>/dev/null | sort
    fi
    ;;
  opencollective-api)
    # Mocha: test/ mirrors server/; *.test.ts, *.test.js
    if [[ "$QUERY" == *"/"* ]]; then
      # Path: server/X/Y → test/server/X/Y.test.*
      REL="${QUERY#server/}"
      REL="${REL#test/}"
      find "$PROJECT_DIR/test" -type f \( -name "*.test.ts" -o -name "*.test.js" \) \
        | grep -iE "(/${REL}|${REL}/|${REL}\\.)" \
        | sort
    else
      grep -riFl "$QUERY" "$PROJECT_DIR/test" --include="*.test.ts" --include="*.test.js" 2>/dev/null | sort
    fi
    ;;
  opencollective-pdf)
    if [[ "$QUERY" == *"/"* ]]; then
      find "$PROJECT_DIR" -type f -name "*.test.ts" | grep -iE "(/${QUERY}|${QUERY}/|${QUERY}\\.)" | sort
    else
      grep -riFl "$QUERY" "$PROJECT_DIR" --include="*.test.ts" 2>/dev/null | sort
    fi
    ;;
  opencollective-rest)
    if [[ "$QUERY" == *"/"* ]]; then
      find "$PROJECT_DIR" -type f \( -name "*.test.ts" -o -name "*.test.js" \) | grep -iE "(/${QUERY}|${QUERY}/|${QUERY}\\.)" | sort
    else
      grep -riFl "$QUERY" "$PROJECT_DIR" --include="*.test.ts" --include="*.test.js" 2>/dev/null | sort
    fi
    ;;
  *)
    echo -e "${RED}Unknown project: $PROJECT${NC}"
    echo "Supported: opencollective-frontend, opencollective-api, opencollective-pdf, opencollective-rest"
    exit 1
    ;;
esac
