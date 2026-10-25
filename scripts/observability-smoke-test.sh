#!/usr/bin/env bash
# Smoke test for the running stack in observability/: every service is ready, Grafana reaches its
# datasources, a trace, a log line and a scrape each make it through, and exemplars can be stored and
# linked to Tempo (see docs/OBSERVABILITY.md, Verify). CI runs it after
# `docker compose -f observability/compose.yaml up -d --wait`. It does not need the backend; the
# checks that do stay manual (scripts/observability-exemplar-check.sh covers exemplars).
set -euo pipefail

GRAFANA_AUTH=${GRAFANA_AUTH:-admin:admin}
# Marks the probe trace and log line, so they never mix with the backend's.
PROBE=observability-smoke-test
failures=()

# Retries a check until it passes or the timeout (seconds) runs out. Loki, for one, reports ready
# only some 15 s after it starts.
check() {
  local name=$1 timeout=$2
  shift 2
  local deadline=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      echo "FAIL $name (after ${timeout}s)"
      failures+=("$name")
      return 0
    fi
    sleep 2
  done
  echo "ok   $name"
}

ready() { curl -fsS --max-time 5 "$1"; }
datasource_ok() {
  curl -fsS --max-time 10 -u "$GRAFANA_AUTH" "127.0.0.1:3000/api/datasources/uid/$1/health" | grep -q '"status":"OK"'
}
# Reads the provisioning as Grafana loaded it, not the file. Grafana returns jsonData keys sorted.
exemplars_link_to_tempo() {
  curl -fsS --max-time 10 -u "$GRAFANA_AUTH" 127.0.0.1:3000/api/datasources/uid/prometheus |
    grep -qE '"exemplarTraceIdDestinations":\[[^]]*\{"datasourceUid":"tempo","name":"trace_id"'
}
# Compares the result of a Prometheus scalar-like query (count(...)) with the expected value.
prometheus_equals() {
  curl -fsSG --max-time 5 127.0.0.1:9090/api/v1/query --data-urlencode "query=$1" |
    grep -qE "\"value\":\[[0-9.]+,\"$2\"\]"
}
trace_stored() { curl -fsS --max-time 5 "127.0.0.1:3200/api/v2/traces/$1" | grep -q "$PROBE"; }
log_stored() {
  curl -fsSG --max-time 5 127.0.0.1:3100/loki/api/v1/query_range \
    --data-urlencode "query={app=\"$PROBE\"} |= \"$1\"" --data-urlencode since=5m | grep -q "$1"
}

check "Prometheus ready" 120 ready 127.0.0.1:9090/-/ready
check "Loki ready" 120 ready 127.0.0.1:3100/ready
check "Tempo ready" 120 ready 127.0.0.1:3200/ready
check "Alloy ready" 120 ready 127.0.0.1:12345/-/ready
check "Grafana ready" 120 ready 127.0.0.1:3000/api/health
for uid in prometheus loki tempo; do
  check "Grafana datasource $uid" 60 datasource_ok "$uid"
done
check "Grafana links exemplars to Tempo" 60 exemplars_link_to_tempo

# The nimuairy-api target is down without the backend, but it must be configured.
check "Prometheus scrapes itself and Alloy" 60 prometheus_equals 'count(up{job=~"prometheus|alloy"} == 1)' 2
check "Prometheus has the nimuairy-api job" 60 prometheus_equals 'count(up{job="nimuairy-api"})' 1
# Without --enable-feature=exemplar-storage the limit is 0 and Prometheus drops every exemplar it scrapes.
check "Prometheus stores exemplars" 60 \
  prometheus_equals 'count(prometheus_tsdb_exemplar_max_exemplars{job="prometheus"} > 0)' 1

# OTLP/JSON takes hex IDs. Tempo returns a trace by ID within seconds; search would take ~30 s.
trace_id=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
span_id=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
now=$(date +%s%N)
span='{"traceId":"'$trace_id'","spanId":"'$span_id'","name":"'$PROBE'","kind":1,"startTimeUnixNano":"'$((now - 1000000))'","endTimeUnixNano":"'$now'"}'
resource='{"attributes":[{"key":"service.name","value":{"stringValue":"'$PROBE'"}}]}'
if curl -fsS --max-time 10 -o /dev/null -H 'Content-Type: application/json' \
  -d '{"resourceSpans":[{"resource":'"$resource"',"scopeSpans":[{"spans":['"$span"']}]}]}' \
  127.0.0.1:4318/v1/traces; then
  check "Tempo stores an OTLP trace" 60 trace_stored "$trace_id"
else
  echo "FAIL Tempo accepts an OTLP trace"
  failures+=("Tempo accepts an OTLP trace")
fi

# A labelled container stands in for the backend: Alloy must ship its stdout and map the
# observability.app label to the Loki label app, which Grafana's trace-to-logs link relies on. It
# reuses the Prometheus image (busybox-based, already pulled) and keeps logging, because Alloy only
# picks up containers it discovers while they run.
token="$PROBE-$trace_id"
image=$(docker inspect --format '{{.Config.Image}}' prometheus)
docker rm -f "$PROBE" >/dev/null 2>&1 || true
trap 'docker rm -f "$PROBE" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$PROBE" --label "observability.app=$PROBE" --entrypoint sh "$image" \
  -c "while true; do echo $token; sleep 1; done" >/dev/null
check "Alloy ships a labelled container's logs to Loki" 60 log_stored "$token"

if ((${#failures[@]})); then
  echo "${#failures[@]} check(s) failed: ${failures[*]}" >&2
  exit 1
fi
echo "All checks passed"
