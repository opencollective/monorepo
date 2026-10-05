#!/usr/bin/env bash
set -euo pipefail
subnet=$1 network=$2
[[ "$subnet" =~ ^([0-9]{1,3}\.){3}1/24$ && "$network" =~ ^[a-z][a-z0-9-]+$ ]] || exit 1
ipv4_number() {
    local a b c d
    IFS=. read -r a b c d <<<"$1"
    for octet in "$a" "$b" "$c" "$d"; do [[ "$octet" =~ ^[0-9]{1,3}$ ]] && ((10#$octet <= 255)) || exit 1; done
    printf '%s\n' "$(((10#$a << 24) + (10#$b << 16) + (10#$c << 8) + 10#$d))"
}
candidate=$(ipv4_number "${subnet%/*}")
routes=$(ip -j -4 route show table all | jq -er 'map([.dst, (.dev // "")] | @tsv) | join("\n")')
while IFS=$'\t' read -r route device; do
    [[ "$device" != "$network" && "$route" != default && "$route" == */* ]] || continue
    address=${route%/*}
    prefix=${route#*/}
    [[ "$address" == *.* && "$prefix" =~ ^[0-9]+$ ]] || continue
    mask=$(((0xffffffff << (32 - prefix)) & 0xffffffff))
    existing=$(ipv4_number "$address")
    if (((candidate & mask) == (existing & mask) || (candidate & 0xffffff00) == (existing & 0xffffff00))); then
        printf 'workspace: subnet %s overlaps route %s on %s\n' "$subnet" "$route" "$device" >&2
        exit 1
    fi
done <<<"$routes"
