#!/bin/bash

# Run tests for specific file(s) across different Open Collective projects
# Usage: ./scripts/test.sh [--watch] <path-to-test-file> [path-to-test-file ...]
# Example: ./scripts/test.sh opencollective-frontend/components/edit-collective/sections/ReceivingMoney.test.tsx
# Example: ./scripts/test.sh --watch opencollective-api/test/server/lib/collectivelib.test.ts
# Example: ./scripts/test.sh opencollective-api/test/foo.test.ts opencollective-api/test/bar.test.ts --watch

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
WATCH_MODE=false
TEST_PATHS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --watch|-w)
            WATCH_MODE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--watch] <path-to-test-file> [path-to-test-file ...]"
            echo ""
            echo "Options:"
            echo "  --watch, -w    Run tests in watch mode"
            echo "  -h, --help     Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 opencollective-frontend/components/MyComponent.test.tsx"
            echo "  $0 --watch opencollective-api/test/server/lib/mylib.test.ts"
            echo "  $0 opencollective-api/test/foo.test.ts opencollective-api/test/bar.test.ts"
            echo "  $0 opencollective-pdf/test/some.test.ts"
            echo "  $0 opencollective-rest/test/some.test.ts"
            exit 0
            ;;
        -*)
            echo -e "${RED}Error: Unknown option $1${NC}" >&2
            exit 1
            ;;
        *)
            TEST_PATHS+=("$1")
            shift
            ;;
    esac
done

# Validate that at least one test path was provided
if [[ ${#TEST_PATHS[@]} -eq 0 ]]; then
    echo -e "${RED}Error: No test path(s) provided${NC}" >&2
    echo "Usage: $0 [--watch] <path-to-test-file> [path-to-test-file ...]"
    exit 1
fi

# Helper to get project and relative path for a given path
get_project_and_relative_path() {
    local path="$1"
    if [[ "$path" == opencollective-frontend/* ]]; then
        echo "opencollective-frontend ${path#opencollective-frontend/}"
    elif [[ "$path" == opencollective-api/* ]]; then
        echo "opencollective-api ${path#opencollective-api/}"
    elif [[ "$path" == opencollective-pdf/* ]]; then
        echo "opencollective-pdf ${path#opencollective-pdf/}"
    elif [[ "$path" == opencollective-rest/* ]]; then
        echo "opencollective-rest ${path#opencollective-rest/}"
    else
        echo ""
    fi
}

# Determine project from first path and collect relative paths (all must be same project)
PROJECT=""
RELATIVE_PATHS=()

for TEST_PATH in "${TEST_PATHS[@]}"; do
    result=$(get_project_and_relative_path "$TEST_PATH")
    if [[ -z "$result" ]]; then
        echo -e "${RED}Error: Could not determine project from path: $TEST_PATH${NC}" >&2
        echo "Path should start with one of: opencollective-frontend/, opencollective-api/, opencollective-pdf/, opencollective-rest/"
        exit 1
    fi
    path_project="${result%% *}"
    path_relative="${result#* }"
    if [[ -z "$PROJECT" ]]; then
        PROJECT="$path_project"
    elif [[ "$PROJECT" != "$path_project" ]]; then
        echo -e "${RED}Error: All test files must be from the same project (got $PROJECT and $path_project)${NC}" >&2
        exit 1
    fi
    RELATIVE_PATHS+=("$path_relative")
done

# Get workspace root (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$WORKSPACE_ROOT/$PROJECT"

# Check that the project directory exists
if [[ ! -d "$PROJECT_DIR" ]]; then
    echo -e "${RED}Error: Project directory not found: $PROJECT_DIR${NC}" >&2
    exit 1
fi

# Determine the test command
if [[ "$WATCH_MODE" == true ]]; then
    TEST_CMD="test:watch"
    echo -e "${GREEN}Running tests in watch mode for: ${TEST_PATHS[*]}${NC}"
else
    TEST_CMD="test"
    echo -e "${GREEN}Running tests for: ${TEST_PATHS[*]}${NC}"
fi

echo -e "${YELLOW}Project: $PROJECT${NC}"
echo -e "${YELLOW}Relative path(s): ${RELATIVE_PATHS[*]}${NC}"
echo ""

# Run the test command in the project directory (pass all relative paths)
cd "$PROJECT_DIR"
npm run "$TEST_CMD" -- "${RELATIVE_PATHS[@]}"
