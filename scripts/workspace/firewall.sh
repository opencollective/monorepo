#!/usr/bin/env bash
set -euo pipefail
network=$1 subnet=$2 port=$3
[[ "$EUID" == 0 && "$network" =~ ^[a-z][a-z0-9-]{0,40}$ && "$subnet" =~ ^([0-9]{1,3}\.){3}1/24$ && "$port" =~ ^[0-9]+$ ]] || exit 1
table="oc_workspace_${network//-/_}"
exec 9>"/run/$table.lock"
flock 9
gateway=${subnet%/*}
# Special-use destinations, every connected/routed local subnet, and host public IPs.
# Exclude default routes and this bridge's routes; this bridge is already in 10/8.
blocked=$({
    printf '%s\n' 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.168.0.0/16 198.18.0.0/15 224.0.0.0/4 240.0.0.0/4
    ip -j -4 route show table all | jq -r --arg bridge "$network" '.[] | select(.dst != "default" and .dev != $bridge) | .dst'
    ip -j -4 address show | jq -r '.[].addr_info[] | select(.family == "inet") | .local + "/32"'
} | sort -u | paste -sd,)
rules=$(mktemp)
trap 'rm -f -- "$rules"' EXIT
if nft list table inet "$table" >/dev/null 2>&1; then printf 'delete table inet %s\n' "$table" >"$rules"; fi
cat >>"$rules" <<EOF
table inet $table {
    set blocked { type ipv4_addr; flags interval; auto-merge; elements = { $blocked }; }
    chain input {
        type filter hook input priority -10; policy accept;
        iifname "$network" ct state established,related accept
        iifname "$network" ip daddr $gateway udp dport { 53, 67 } accept
        iifname "$network" ip daddr 255.255.255.255 udp dport 67 accept
        iifname "$network" ip daddr $gateway tcp dport 53 accept
        iifname "$network" drop
    }
    chain forward {
        type filter hook forward priority -10; policy accept;
        iifname "$network" oifname "$network" drop
        iifname "$network" meta nfproto ipv6 drop
        iifname "$network" ip daddr @blocked drop
        iifname "$network" accept
        oifname "$network" ct state established,related accept
        oifname "$network" drop
    }
    chain output {
        type filter hook output priority -10; policy accept;
        oifname "$network" ct state established,related accept
        oifname "$network" ip saddr $gateway udp sport { 53, 67 } accept
        oifname "$network" ip saddr $gateway tcp sport 53 accept
        oifname "$network" tcp dport $port accept
        oifname "$network" drop
    }
}
EOF
nft -c -f "$rules"
nft -f "$rules" # Replace atomically; never flush the host's other firewall tables.
