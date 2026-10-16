#!/usr/bin/env bash
# Open Dependabot alerts, traced to the copies in the default branch's lockfile and the packages that pin them.
# usage: alerts.sh [api|frontend|rest|images|pdf|contributors-svg ...] (default: all six)
#        ALERTS_UPSTREAM=0 alerts.sh ...   # skip the `npm view` lookup of each parent's latest range
# Read-only. For each alert: the copies of the package (version, path, dev-only or runtime, vulnerable or not by
# comparison with the first patched version), the parents that depend on each vulnerable copy with their range, and
# the range in the parent's latest release (does upgrading the parent fix it?). The vulnerable check is a version
# sort against the first patched version, not a full semver range match: confirm edge cases by hand.
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
repos=("$@"); [[ ${#repos[@]} -gt 0 ]] || repos=(api frontend rest images pdf contributors-svg)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# 0 when $1 < $2 (version sort; prerelease suffixes approximate)
version_lt() { [[ "$1" != "$2" ]] && [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" == "$1" ]]; }

for r in "${repos[@]}"; do
  resolve_repo "$r"
  echo "######## $SHORT ($REPO)"
  if ! ghr api --paginate "repos/$REPO/dependabot/alerts?state=open&per_page=100" > "$tmp/alerts.json" 2> "$tmp/err"; then
    echo "   alerts unavailable: $(grep -o -m1 -E '"message":"[^"]+"|HTTP [0-9]+[^)]*' "$tmp/err" || head -c 200 "$tmp/err")"
    echo; continue
  fi
  n=$(jq -s 'add | length' "$tmp/alerts.json")
  if [[ "$n" == 0 ]]; then echo "   no open alerts"; echo; continue; fi
  branch=$(gh api "repos/$REPO" --jq .default_branch)
  lock_ok=1
  ghr api "repos/$REPO/contents/package-lock.json?ref=$branch" -H "Accept: application/vnd.github.raw" > "$tmp/lock.json" 2>/dev/null || lock_ok=0

  jq -s -r 'add[] | [.number, .security_advisory.severity, .dependency.package.name, .dependency.manifest_path,
      .security_advisory.ghsa_id, (.security_vulnerability.vulnerable_version_range // ""),
      (.security_vulnerability.first_patched_version.identifier // ""), .created_at[0:10],
      (.security_advisory.summary | gsub("[\t\r\n]+"; " "))] | join("\u001f")' "$tmp/alerts.json" \
  | while IFS=$'\x1f' read -r num sev pkg manifest ghsa range fix created summary; do
      echo "-- #$num $sev $pkg ($ghsa, since $created): $summary"
      echo "   vulnerable $range; first patched: ${fix:-none}; manifest: $manifest"
      [[ "$lock_ok" == 1 && "$manifest" == package-lock.json ]] || { echo "   (lockfile not read: trace by hand)"; continue; }
      jq -r --arg p "$pkg" '.packages | to_entries[] | select((.key | sub(".*node_modules/"; "")) == $p)
          | [.key, (.value.version // "?"), (if .value.dev then "dev" elif .value.devOptional then "dev-optional" else "runtime" end)] | @tsv' \
          "$tmp/lock.json" > "$tmp/copies"
      [[ -s "$tmp/copies" ]] || { echo "   no copy in $branch's lockfile: already fixed, the alert closes on the next scan"; continue; }
      while IFS=$'\t' read -r path ver scope; do
        if [[ -z "$fix" ]]; then state="vulnerable (no fix released)"
        elif version_lt "$ver" "$fix"; then state="vulnerable"
        else state="ok"; fi
        echo "   $pkg@$ver  $scope  $state  at $path"
        [[ "$state" == ok ]] && continue
        # Parents: the package that owns the nested node_modules, or every package depending on a hoisted copy
        # Dependents that resolve to this copy, the way npm does: <dependent>/node_modules/<pkg>, then upwards
        jq -r --arg p "$pkg" --arg path "$path" '
            def resolve($all; $k):
              ((if $k == "" then "" else $k + "/" end) + "node_modules/" + $p) as $c
              | if $all[$c] != null then $c elif $k == "" then null
                else resolve($all; $k | sub("(^|/)node_modules/(@[^/]+/)?[^/]+$"; "")) end;
            .packages as $all | $all | to_entries[]
            | (.value.dependencies[$p] // .value.optionalDependencies[$p] // .value.peerDependencies[$p] // .value.devDependencies[$p]) as $want
            | select($want != null)
            | select(resolve($all; .key) == $path)
            | [(if .key == "" then "(root package.json)" else (.key | sub(".*node_modules/"; "")) end), (.value.version // ""), $want] | join("\u001f")' \
            "$tmp/lock.json" | sort -u | head -8 \
        | while IFS=$'\x1f' read -r parent pver want; do
            line="      pinned by $parent${pver:+@$pver} wants $want"
            if [[ "${ALERTS_UPSTREAM:-1}" == 1 && "$parent" != "(root package.json)" ]]; then
              latest=$(npm view "$parent" version 2>/dev/null || true)
              lrange=$(npm view "$parent" "dependencies.$pkg" 2>/dev/null || true)
              [[ -n "$latest" ]] && line+="; latest $parent@$latest wants ${lrange:-(no longer depends on it)}"
            fi
            echo "$line"
          done
      done < "$tmp/copies"
    done
  echo
done
