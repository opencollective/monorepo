#!/bin/sh
# usage: PORT=3065 JWT_FILE=/tmp/perf/jwt.txt gql.sh <query-file> [variables-json]
# Prints "<http status> <seconds>s"; the response body goes to ${OUT:-/tmp/perf/last-response-$PORT.json}.
# Operations must be named: anonymous ones fail validation on the API.
PORT=${PORT:-3065}
Q=$(jq -Rs . < "$1")
curl -s -o "${OUT:-/tmp/perf/last-response-$PORT.json}" -w '%{http_code} %{time_total}s\n' "http://localhost:$PORT/graphql/v2" \
  -H "Authorization: Bearer $(cat "$JWT_FILE")" -H 'Content-Type: application/json' \
  --max-time 300 -d "{\"query\": $Q, \"variables\": ${2:-{\}}}"
