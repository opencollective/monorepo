#!/bin/bash

# Open Collective Development Environment Setup Script
# This script clones all Open Collective repositories

set -e  # Exit on any error

# Change to the project root directory, regardless of where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to clone a repository
clone_repo() {
    local repo_url="$1"
    local repo_name="$2"
    local target_dir="$repo_name"
    
    if [ -d "$target_dir" ]; then
        return 0  # Repository already exists, return success
    fi
    
    print_status "Cloning $repo_name from $repo_url..."
    
    # Use shallow cloning if --shallow flag is provided
    local git_args=""
    if [ "$SHALLOW_CLONE" = "true" ]; then
        git_args="--depth 1 --single-branch"
    fi
    
    if git clone $git_args "$repo_url" "$target_dir"; then
        print_success "Successfully cloned $repo_name"
    else
        print_error "Failed to clone $repo_name"
        return 1
    fi
}

# Main execution
main() {
    # Parse command line arguments
    SHALLOW_CLONE="false"
    while [[ $# -gt 0 ]]; do
        case $1 in
            --shallow)
                SHALLOW_CLONE="true"
                shift
                ;;
            -h|--help)
                echo "Usage: $0 [--shallow]"
                echo ""
                echo "Options:"
                echo "  --shallow    Use shallow cloning (--depth 1 --single-branch) for faster, smaller clones"
                echo "  -h, --help   Show this help message"
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    print_status "Starting Open Collective development environment setup..."
    
    if [ "$SHALLOW_CLONE" = "true" ]; then
        print_status "Shallow cloning mode enabled"
    fi
    
    # List of Open Collective repositories
    # Format: "https://github.com/opencollective/REPO_NAME" "REPO_NAME"
    declare -a repositories=(
        "https://github.com/opencollective/opencollective-api" "opencollective-api"
        "https://github.com/opencollective/opencollective-frontend" "opencollective-frontend"
        "https://github.com/opencollective/opencollective-taxes" "opencollective-taxes"
        "https://github.com/opencollective/opencollective-tools" "opencollective-tools"
        "https://github.com/opencollective/opencollective-watch" "opencollective-watch"
        "https://github.com/opencollective/opencollective-rest" "opencollective-rest"
        "https://github.com/opencollective/opencollective-rss" "opencollective-rss"
        "https://github.com/opencollective/opencollective-pdf" "opencollective-pdf"
        "https://github.com/opencollective/opencollective-images" "opencollective-images"
        # "https://github.com/opencollective/contributors-svg" "contributors-svg"
        # "https://github.com/opencollective/discover" "discover"
        # "https://github.com/opencollective/documentation" "documentation"
        # "https://github.com/opencollective/eslint-config-opencollective" "eslint-config"
        # "https://github.com/opencollective/graphql-docs-v2" "graphql-docs"
        "https://github.com/opencollective/opencollective" "opencollective"
    )
    
    # Clone repositories
    local failed_repos=()
    local total_repos=${#repositories[@]}
    local processed=0
    
    for ((i=0; i<total_repos; i+=2)); do
        local repo_url="${repositories[i]}"
        local repo_name="${repositories[i+1]}"
        local target_dir="$repo_name"
        
        processed=$((processed + 1))
        
        if [ -d "$target_dir" ]; then
            print_status "Processing repository $(printf "%02d" $processed)/$(printf "%02d" $((total_repos/2))): $repo_name (already exists)"
        else
            print_status "Processing repository $(printf "%02d" $processed)/$(printf "%02d" $((total_repos/2))): $repo_name"
            if ! clone_repo "$repo_url" "$repo_name"; then
                failed_repos+=("$repo_name")
            fi
        fi
    done
    
    # Summary
    echo "================================================="

    if [ ${#failed_repos[@]} -eq 0 ]; then
        print_success "All repositories cloned successfully!"
    else
        print_warning "Some repositories failed to clone:"
        for repo in "${failed_repos[@]}"; do
            echo "  - $repo"
        done
        echo ""
        print_status "You can try running the script again to retry failed repositories."
    fi
    
    echo "================================================="
    print_status "Check README.md for the next steps. Happy coding! 🚀"
}

# Run main function
main "$@"