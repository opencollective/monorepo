#!/bin/bash

# Run tests for a specific file across different Open Collective projects
# Usage: ./scripts/test.sh [--watch] <path-to-test-file>
# Example: ./scripts/test.sh opencollective-frontend/components/edit-collective/sections/ReceivingMoney.test.tsx
# Example: ./scripts/test.sh --watch opencollective-api/test/server/lib/collectivelib.test.ts

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
WATCH_MODE=false
TEST_PATH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --watch|-w)
            WATCH_MODE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--watch] <path-to-test-file>"
            echo ""
            echo "Options:"
            echo "  --watch, -w    Run tests in watch mode"
            echo "  -h, --help     Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 opencollective-frontend/components/MyComponent.test.tsx"
            echo "  $0 --watch opencollective-api/test/server/lib/mylib.test.ts"
            echo "  $0 opencollective-pdf/test/some.test.ts"
            echo "  $0 opencollective-rest/test/some.test.ts"
            exit 0
            ;;
        -*)
            echo -e "${RED}Error: Unknown option $1${NC}" >&2
            exit 1
            ;;
        *)
            TEST_PATH="$1"
            shift
            ;;
    esac
done

# Validate that a test path was provided
if [[ -z "$TEST_PATH" ]]; then
    echo -e "${RED}Error: No test path provided${NC}" >&2
    echo "Usage: $0 [--watch] <path-to-test-file>"
    exit 1
fi

# Determine the project from the path
# The path should start with the project directory name
PROJECT=""
RELATIVE_PATH=""

if [[ "$TEST_PATH" == opencollective-frontend/* ]]; then
    PROJECT="opencollective-frontend"
    RELATIVE_PATH="${TEST_PATH#opencollective-frontend/}"
elif [[ "$TEST_PATH" == opencollective-api/* ]]; then
    PROJECT="opencollective-api"
    RELATIVE_PATH="${TEST_PATH#opencollective-api/}"
elif [[ "$TEST_PATH" == opencollective-pdf/* ]]; then
    PROJECT="opencollective-pdf"
    RELATIVE_PATH="${TEST_PATH#opencollective-pdf/}"
elif [[ "$TEST_PATH" == opencollective-rest/* ]]; then
    PROJECT="opencollective-rest"
    RELATIVE_PATH="${TEST_PATH#opencollective-rest/}"
else
    echo -e "${RED}Error: Could not determine project from path: $TEST_PATH${NC}" >&2
    echo "Path should start with one of: opencollective-frontend/, opencollective-api/, opencollective-pdf/, opencollective-rest/"
    exit 1
fi

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
    echo -e "${GREEN}Running tests in watch mode for: $TEST_PATH${NC}"
else
    TEST_CMD="test"
    echo -e "${GREEN}Running tests for: $TEST_PATH${NC}"
fi

echo -e "${YELLOW}Project: $PROJECT${NC}"
echo -e "${YELLOW}Relative path: $RELATIVE_PATH${NC}"
echo ""

# Run the test command in the project directory
cd "$PROJECT_DIR"
npm run "$TEST_CMD" -- "$RELATIVE_PATH"
