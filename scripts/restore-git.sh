#!/bin/bash

# Open Collective Git Configuration Restore Script
# This script restores the git configuration that was removed by init.sh

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
    print_status "Starting git configuration restore..."
    
    # Check if backup exists
    BACKUP_DIR=".git-backup"
    if [ ! -d "$BACKUP_DIR" ]; then
        print_error "No git backup found ($BACKUP_DIR directory does not exist)"
        print_status "The git configuration may not have been backed up, or it was already restored."
        exit 1
    fi
    
    # Check if .git already exists
    if [ -d ".git" ]; then
        print_warning ".git directory already exists"
        read -p "Do you want to overwrite it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Restore cancelled"
            exit 0
        fi
        print_status "Removing existing .git directory..."
        rm -rf ".git"
    fi
    
    # Restore .git folder
    if [ -d "$BACKUP_DIR/.git" ]; then
        print_status "Restoring .git folder from backup..."
        mv "$BACKUP_DIR/.git" ".git"
        print_success ".git folder restored"
    fi
    
    # Restore all other files (including hidden files like .gitignore)
    # Enable dotglob to include hidden files in glob patterns
    shopt -s dotglob
    for file in "$BACKUP_DIR"/*; do
        # Skip if it's a directory (like .git which is already handled)
        if [ -d "$file" ]; then
            continue
        fi
        # Skip if it doesn't exist (empty backup dir)
        if [ ! -e "$file" ]; then
            continue
        fi
        filename=$(basename "$file")
        print_status "Restoring $filename..."
        mv "$file" "$PROJECT_ROOT/$filename"
        print_success "$filename restored"
    done
    shopt -u dotglob  # Disable dotglob
    
    # Clean up backup directory if empty
    if [ -d "$BACKUP_DIR" ] && [ -z "$(ls -A "$BACKUP_DIR")" ]; then
        print_status "Removing empty backup directory..."
        rmdir "$BACKUP_DIR"
    fi
    
    print_success "Git configuration restored successfully!"
    print_status "The root folder is now recognized as a git repository again."
}

# Run main function
main "$@"
