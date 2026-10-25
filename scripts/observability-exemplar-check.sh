#!/usr/bin/env bash
# Checks the metric-to-trace path with the backend running: an exemplar of a real request reaches
# Prometheus, points at that request's server span in Tempo, comes back through Grafana, and shows
# on the backend's /metrics (see docs/OBSERVABILITY.md, Stage 3). Needs the stack and the app with
# the dev overlay, which publishes the metrics on 127.0.0.1:9464. CI does not run it: it has no
# backend.
set -euo pipefail
# Git Bash would otherwise rewrite arguments such as /api/v1/... into Windows paths. In turn, its
# native curl cannot open /dev/null itself, hence shell redirects instead of `-o /dev/null`.
export MSYS_NO_PATHCONV=1

GRAFANA_AUTH=${GRAFANA_AUTH:-admin:admin}
ROUTE=/api/v1/battles/demo
BUCKETS="http_server_request_duration_seconds_bucket{service_name=\"nimuairy-api\",http_route=\"$ROUTE\"}"

# Retries a step until it passes or the timeout (seconds) runs out. Unlike the smoke test, a failed
# step ends the run: each step needs the IDs an earlier one found.
step() {
  local name=$1 timeout=$2
  shift 2
  local deadline=$((SECONDS + timeout))
  until "$@" 2>/dev/null; do
    if ((SECONDS >= deadline)); then
      echo "FAIL $name (after ${timeout}s)" >&2
      exit 1
    fi
    sleep 2
  done
  echo "ok   $name"
}

backend_scraped() {
  curl -fsSG --max-time 5 127.0.0.1:9090/api/v1/query --data-urlencode 'query=up{job="nimuairy-api"}' |
    grep -qE '"value":\[[0-9.]+,"1"\]'
}
# Prometheus sorts labels, so span_id comes before trace_id.
exemplar_stored() {
  local pair
  pair=$(curl -fsSG --max-time 5 127.0.0.1:9090/api/v1/query_exemplars --data-urlencode "query=$BUCKETS" \
    --data-urlencode "start=$t0" --data-urlencode "end=$(($(date +%s) + 60))" |
    grep -oE '"span_id":"[0-9a-f]{16}","trace_id":"[0-9a-f]{32}"' | tail -n 1)
  [[ $pair =~ \"span_id\":\"([0-9a-f]+)\",\"trace_id\":\"([0-9a-f]+)\" ]] || return 1
  span_id=${BASH_REMATCH[1]}
  trace_id=${BASH_REMATCH[2]}
}
hex_to_base64() {
  local hex=$1 bytes='' i
  for ((i = 0; i < ${#hex}; i += 2)); do bytes+="\\x${hex:i:2}"; done
  printf '%b' "$bytes" | base64
}
# Tempo's JSON has IDs in base64, and a child span would have a parentSpanId before its name.
server_span_in_tempo() {
  local span_b64
  span_b64=$(hex_to_base64 "$span_id")
  curl -fsS --max-time 5 "127.0.0.1:3200/api/v2/traces/$trace_id" |
    grep -qE "\"spanId\":\"${span_b64//+/[+]}\",(\"parentSpanId\":\"[^\"]*\",)?\"name\":\"GET $ROUTE\",\"kind\":\"SPAN_KIND_SERVER\""
}
# Grafana's backend returns the exemplars; its frontend adds the link to Tempo from the datasource's
# exemplarTraceIdDestinations, which the smoke test checks.
exemplar_in_grafana() {
  local body
  body=$(printf '{"from":"%d","to":"%d","queries":[{"refId":"A","datasource":{"type":"prometheus","uid":"prometheus"},"expr":"%s","range":true,"exemplar":true}]}' \
    $(((t0 - 60) * 1000)) $((($(date +%s) + 60) * 1000)) "${BUCKETS//\"/\\\"}")
  curl -fsS --max-time 10 -u "$GRAFANA_AUTH" -H 'Content-Type: application/json' -d "$body" \
    127.0.0.1:3000/api/ds/query | grep -q "\"$trace_id\""
}
# Exemplars are written only in OpenMetrics, and only for the requests since the previous scrape:
# a Prometheus scrape between the request and this one leaves nothing, so the step retries.
exemplar_on_metrics_endpoint() {
  local response
  curl -fsS --max-time 5 "127.0.0.1:8000$ROUTE" >/dev/null
  response=$(curl -fsSi --max-time 5 -H 'Accept: application/openmetrics-text; version=1.0.0' \
    127.0.0.1:9464/metrics)
  grep -qi '^content-type: application/openmetrics-text' <<<"$response" &&
    grep -qE "^http_server_request_duration_seconds_bucket\{[^}]*http_route=\"$ROUTE\"[^}]*\} [0-9.e+]+ # \{[^}]*trace_id=\"[0-9a-f]{32}\"" <<<"$response"
}

step "Prometheus scrapes the backend" 60 backend_scraped

# Nothing but Prometheus may scrape /metrics until the exemplar is stored: every scrape resets the
# exemplars the backend holds.
t0=$(date +%s)
for _ in 1 2 3 4 5; do curl -fsS --max-time 5 "127.0.0.1:8000$ROUTE" >/dev/null; done
step "Prometheus stores an exemplar of $ROUTE" 45 exemplar_stored
echo "     trace_id=$trace_id span_id=$span_id"
step "Tempo has the trace, with the exemplar's span as the server span of $ROUTE" 30 server_span_in_tempo
step "Grafana returns the exemplar" 30 exemplar_in_grafana
step "/metrics shows an exemplar in OpenMetrics" 30 exemplar_on_metrics_endpoint
echo "All checks passed"
