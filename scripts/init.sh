#!/bin/bash

# Open Collective Development Environment Setup Script
# Clone or update Open Collective submodules to the latest origin/main.

set -e  # Exit on any error

# Change to the project root directory, regardless of where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${OC_MONOREPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
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

# Short name for a submodule path (e.g. opencollective-api -> api)
project_short_name() {
    local path="$1"
    if [[ "$path" == opencollective-* ]]; then
        echo "${path#opencollective-}"
    else
        echo "$path"
    fi
}

# Resolve a user-provided project id to a submodule path, or return empty if unknown
resolve_project() {
    local input="${1,,}" # lowercase
    local -a paths=("${ALL_PROJECT_PATHS[@]}")
    local path short
    for path in "${paths[@]}"; do
        if [ "$input" = "$path" ] || [ "$input" = "$(project_short_name "$path")" ]; then
            echo "$path"
            return 0
        fi
    done
    return 1
}

# Fetch every time, but never discard local work to reach origin/main.
init_repo() {
    local name="$1"
    local path="$2"
    local -a clone_args=()
    local changes

    git submodule init -- "$path" || return 1
    git config "submodule.$name.branch" main || return 1
    git config "submodule.$name.ignore" all || return 1

    if [ ! -e "$path/.git" ]; then
        if [ "$SHALLOW_CLONE" = "true" ]; then
            # Submodule cloning follows remote HEAD; include main even if HEAD differs.
            clone_args+=(--depth 1 --no-single-branch)
        fi
        git submodule update --init --remote --checkout "${clone_args[@]}" -- "$path" || return 1
    fi

    # Explicitly fetch main even if this checkout only tracks another branch.
    git -C "$path" config --replace-all remote.origin.fetch \
        '+refs/heads/main:refs/remotes/origin/main' '^\+?refs/heads/main:' || return 1
    git -C "$path" fetch --no-recurse-submodules origin \
        '+refs/heads/main:refs/remotes/origin/main' || return 1

    changes=$(git -C "$path" status --porcelain) || return 1
    if [ -n "$changes" ]; then
        print_error "$path has uncommitted changes. Commit or stash them, then rerun init."
        return 1
    fi

    if git -C "$path" show-ref --verify --quiet refs/heads/main; then
        if ! git -C "$path" merge-base --is-ancestor main origin/main; then
            print_error "$path has local commits on main that are not on origin/main. Move or reconcile them, then rerun init."
            return 1
        fi
        git -C "$path" switch main || return 1
    else
        git -C "$path" switch --create main --track origin/main || return 1
    fi

    git -C "$path" merge --ff-only origin/main || return 1
    git -C "$path" branch --set-upstream-to=origin/main main || return 1
    print_success "$path is up to date on main"
}

# Main execution
main() {
    # Parse command line arguments
    SHALLOW_CLONE="false"
    PROJECTS_FILTER=""
    while [[ $# -gt 0 ]]; do
        case $1 in
            --shallow)
                SHALLOW_CLONE="true"
                shift
                ;;
            --projects)
                if [ -z "${2:-}" ]; then
                    print_error "--projects requires a comma-separated list of projects"
                    exit 1
                fi
                PROJECTS_FILTER="$2"
                shift 2
                ;;
            -h|--help)
                echo "Usage: $0 [--shallow] [--projects PROJECTS]"
                echo ""
                echo "Options:"
                echo "  --shallow              Use shallow cloning (--depth 1) for new submodules"
                echo "  --projects PROJECTS    Comma-separated list of projects to initialize/update (default: all)"
                echo "                         Use short names (api, frontend) or full directory names (opencollective-api)"
                echo "  -h, --help             Show this help message"
                echo ""
                echo "Every run fetches and checks out the latest origin/main for selected projects."
                echo "Uncommitted changes or unpublished commits on main cause an error; local work is preserved."
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
    
    # Repository list comes from .gitmodules (name + path per submodule)
    local GITMODULES="$PROJECT_ROOT/.gitmodules"
    if [ ! -f "$GITMODULES" ]; then
        print_error ".gitmodules not found at $GITMODULES"
        exit 1
    fi
    
    local -a repositories=()
    local line name path
    while IFS= read -r line; do
        [[ "$line" =~ ^submodule\.([^=]+)\.path=(.*)$ ]] || continue
        name="${BASH_REMATCH[1]}"
        path="${BASH_REMATCH[2]}"
        repositories+=("$name" "$path")
    done < <(git config -f "$GITMODULES" -l | grep '^submodule\..*\.path=')
    
    if [ "${#repositories[@]}" -eq 0 ]; then
        print_error "No submodules found in $GITMODULES"
        exit 1
    fi

    local -a ALL_PROJECT_PATHS=()
    for ((i=1; i<${#repositories[@]}; i+=2)); do
        ALL_PROJECT_PATHS+=("${repositories[i]}")
    done

    local -a selected_paths=()
    if [ -n "$PROJECTS_FILTER" ]; then
        local IFS=',' project resolved unknown=()
        for project in $PROJECTS_FILTER; do
            project="${project#"${project%%[![:space:]]*}"}"
            project="${project%"${project##*[![:space:]]}"}"
            [ -z "$project" ] && continue
            if resolved=$(resolve_project "$project"); then
                selected_paths+=("$resolved")
            else
                unknown+=("$project")
            fi
        done
        if [ "${#unknown[@]}" -gt 0 ]; then
            print_error "Unknown project(s): ${unknown[*]}"
            echo ""
            echo "Available projects (short or directory name):"
            local path
            for path in "${ALL_PROJECT_PATHS[@]}"; do
                echo "  - $(project_short_name "$path") ($path)"
            done
            exit 1
        fi
        if [ "${#selected_paths[@]}" -eq 0 ]; then
            print_error "No projects selected. Use --projects with a comma-separated list."
            exit 1
        fi
        # Deduplicate while preserving order
        local -a deduped=()
        local path seen
        for path in "${selected_paths[@]}"; do
            seen=false
            for existing in "${deduped[@]}"; do
                [ "$existing" = "$path" ] && seen=true && break
            done
            [ "$seen" = false ] && deduped+=("$path")
        done
        selected_paths=("${deduped[@]}")

        local -a filtered=()
        for ((i=0; i<${#repositories[@]}; i+=2)); do
            local repo_name="${repositories[i]}"
            local repo_path="${repositories[i+1]}"
            local include=false
            for path in "${selected_paths[@]}"; do
                [ "$path" = "$repo_path" ] && include=true && break
            done
            [ "$include" = true ] && filtered+=("$repo_name" "$repo_path")
        done
        repositories=("${filtered[@]}")
        print_status "Initializing/updating selected projects only: ${selected_paths[*]}"
    fi

    if [ "${#repositories[@]}" -eq 0 ]; then
        print_error "No repositories to initialize/update"
        exit 1
    fi
    
    # Initialize/update repositories, continuing after individual failures.
    local failed_repos=()
    local total_repos=${#repositories[@]}
    local processed=0
    
    for ((i=0; i<total_repos; i+=2)); do
        local repo_name="${repositories[i]}"
        local repo_path="${repositories[i+1]}"
        
        processed=$((processed + 1))
        
        print_status "Processing repository $(printf "%02d" $processed)/$(printf "%02d" $((total_repos/2))): $repo_path"
        if ! init_repo "$repo_name" "$repo_path"; then
            print_error "Failed to initialize/update $repo_path"
            failed_repos+=("$repo_path")
        fi
    done
    
    # Summary
    echo "================================================="

    if [ ${#failed_repos[@]} -eq 0 ]; then
        print_success "All selected repositories are up to date on main!"
    else
        print_warning "Some repositories failed to initialize/update:"
        for repo in "${failed_repos[@]}"; do
            echo "  - $repo"
        done
        echo ""
        print_status "Resolve the errors above, then rerun the script to retry."
        return 1
    fi
    
    echo "================================================="
    print_status "Check README.md for the next steps. Happy coding! 🚀"
}

# Run main function
main "$@"
