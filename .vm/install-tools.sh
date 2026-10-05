#!/usr/bin/env bash
# Runs as the development user. Tool versions live separately from provisioning.
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
# jq works before Node is installed. The optional file argument lets checks use
# a fixture without changing the installed guest configuration. Read first so a
# JSON failure cannot disappear inside process substitution.
versions_file="${1:-/opt/oc-vm/versions.json}"
version_specs=$(jq -er '.nvm, .node, (.npm_packages | to_entries[] | "\(.key)@\(.value)")' "$versions_file")
readarray -t versions <<< "$version_specs"
nvm_tag="${versions[0]}"
if [[ "$nvm_tag" == latest ]]; then
  # GitHub's latest-release endpoint selects a stable release, rather than the
  # development branch. Resolve on each provision so latest also updates nvm.
  release=$(curl -fsSL https://api.github.com/repos/nvm-sh/nvm/releases/latest) || {
    echo 'Could not look up the latest nvm release' >&2
    exit 1
  }
  nvm_tag=$(jq -er '.tag_name | select(type == "string")' <<< "$release") || {
    echo 'Latest nvm release response has no valid tag_name' >&2
    exit 1
  }
fi
[[ "$nvm_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Invalid nvm release tag: $nvm_tag" >&2
  exit 1
}
echo "Installing nvm $nvm_tag and Node ${versions[1]}"
if [[ ! -d "$NVM_DIR/.git" ]]; then
  [[ ! -e "$NVM_DIR" ]] || { echo "$NVM_DIR exists but is not an nvm Git checkout" >&2; exit 1; }
  git clone --depth 1 --branch "$nvm_tag" https://github.com/nvm-sh/nvm.git "$NVM_DIR"
else
  # Preserve the existing nvm directory and update it to the resolved release.
  git -C "$NVM_DIR" fetch --depth 1 origin "tag" "$nvm_tag"
  git -C "$NVM_DIR" checkout --detach "$nvm_tag"
fi
# Load the selected nvm release before installing the pinned Node runtime.
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm install "${versions[1]}"
nvm alias default "${versions[1]}"
nvm use "${versions[1]}"
# npm resolves @latest on every provision. Global CLIs belong to this Node
# installation; provision.sh subsequently refreshes their system PATH links.
npm install -g "${versions[@]:2}"
[[ "$(npm --version)" == 11.* ]] || { echo 'The pinned Node release must include npm 11' >&2; exit 1; }
