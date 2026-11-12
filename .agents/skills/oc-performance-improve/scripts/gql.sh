#!/bin/sh
# Run one GraphQL operation against a local API and print "<http status> <seconds>s".
# The response body goes to $OUT (default /tmp/gql-last-response-<port>.json).
#
# usage: [PORT=3060] [TOKEN_FILE=/path/to/jwt.txt] gql.sh <operation.graphql> ['<variables json>']
#
# The operation must be named (`query PerfOrders(...)`): the dev API fails slow anonymous operations.
set -eu
PORT=${PORT:-3060}
OUT=${OUT:-/tmp/gql-last-response-$PORT.json}
QUERY=$(jq -Rs . < "$1")
VARIABLES=${2:-'{}'}
if [ -n "${TOKEN_FILE:-}" ]; then
  set -- -H "Authorization: Bearer $(cat "$TOKEN_FILE")"
else
  set --
fi
curl -s -o "$OUT" -w '%{http_code} %{time_total}s\n' "http://localhost:$PORT/graphql/v2" \
  -H 'Content-Type: application/json' "$@" --max-time 300 \
  -d "{\"query\": $QUERY, \"variables\": $VARIABLES}"
