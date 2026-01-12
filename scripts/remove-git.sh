#!/bin/bash

# Open Collective Git Configuration Removal Script
# This script removes git configuration from the root folder and backs it up for restoration

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

# Main execution
main() {
    print_status "Removing git configuration from root folder..."
    
    # Create single backup directory for everything
    BACKUP_DIR=".git-backup"
    
    if [ -d "$BACKUP_DIR" ]; then
        print_warning "$BACKUP_DIR already exists, removing old backup..."
        rm -rf "$BACKUP_DIR"
    fi
    
    mkdir -p "$BACKUP_DIR"
    
    # Move .git folder if it exists
    if [ -d ".git" ]; then
        print_status "Moving .git folder to $BACKUP_DIR..."
        mv ".git" "$BACKUP_DIR/.git"
        print_success ".git folder moved"
    fi
    
    # Move all git-related files (including hidden files)
    # Enable dotglob to include hidden files in glob patterns
    shopt -s dotglob
    for file in .git*; do
        # Skip if it's a directory (like .git which is already handled)
        if [ -d "$file" ]; then
            continue
        fi
        # Skip if it doesn't exist (no matching files)
        if [ ! -e "$file" ]; then
            continue
        fi
        print_status "Moving $file to $BACKUP_DIR..."
        mv "$file" "$BACKUP_DIR/"
        print_success "$file moved"
    done
    shopt -u dotglob  # Disable dotglob
    
    print_success "Git configuration removed. Root folder is no longer a git repository."
    print_status "To restore git configuration, run: ./scripts/restore-git.sh"
}

# Run main function
main "$@"
