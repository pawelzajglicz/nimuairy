#!/usr/bin/env bash
# Smoke test for the running stack in observability/: every service is ready, Grafana reaches its
# datasources, a trace, a log line and a scrape each make it through, the logs of a container without
# the observability.logs=true label stay out of Loki, exemplars can be stored and linked to Tempo, and
# a container on the network the backend shares with the stack cannot reach Loki, Grafana or Alloy
# (see docs/OBSERVABILITY.md, Verify and Networks). CI runs it after
# `docker compose -f observability/compose.yaml up -d --wait`. It does not need the backend; the
# checks that do stay manual (scripts/observability-exemplar-check.sh covers exemplars).
set -euo pipefail

GRAFANA_AUTH=${GRAFANA_AUTH:-admin:admin}
# Marks the probe trace and log line, so they never mix with the backend's.
PROBE=observability-smoke-test
# A container Alloy must not collect: it has observability.app but not observability.logs=true.
UNLABELLED=$PROBE-unlabelled
# Seconds to wait after the labelled container's log reaches Loki before checking that the unlabelled
# one's did not: an ingestion margin, which also spans three of Alloy's discovery rounds
# (refresh_interval = "5s" in observability/alloy/config.alloy).
NEGATIVE_WAIT=20
# Takes the backend's place on the network the app shares with the stack.
APP_PROBE=$PROBE-app
SHARED_NET=nimuairy-observability
STACK_NET=nimuairy-observability_stack
failures=()
# Network checks this engine cannot verify. They are reported, never counted as passed.
warnings=()

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
# Searches every stream Alloy ships (loki.write adds stack="observability" to all of them). A failed
# query proves nothing, so only an answered query without any stream counts as absent.
log_absent() {
  local body
  body=$(curl -fsSG --max-time 5 127.0.0.1:3100/loki/api/v1/query_range \
    --data-urlencode "query={stack=\"observability\"} |= \"$1\"" --data-urlencode since=5m) || return 1
  grep -q '"status":"success"' <<<"$body" && grep -q '"result":\[\]' <<<"$body"
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
# observability.app label to the Loki label app, which Grafana's trace-to-logs link relies on. The
# unlabelled one must be left out. Both reuse the Prometheus image (busybox-based, already pulled)
# and keep logging, because Alloy only picks up containers it discovers while they run.
token="$PROBE-$trace_id"
unlabelled_token="$UNLABELLED-$trace_id"
image=$(docker inspect --format '{{.Config.Image}}' prometheus)
docker rm -f "$PROBE" "$UNLABELLED" >/dev/null 2>&1 || true
# The stand-in on the shared network runs Prometheus, which writes to the image's /prometheus volume;
# -v removes that anonymous volume with it.
trap 'docker rm -f "$PROBE" "$UNLABELLED" >/dev/null 2>&1 || true
  docker rm -fv "$APP_PROBE" >/dev/null 2>&1 || true' EXIT
# The unlabelled container starts first, so both are running before any discovery round can find
# the labelled one. Without the allowlist filter, the round that discovers the labelled container
# would discover the unlabelled one as well.
docker run -d --name "$UNLABELLED" --label "observability.app=$UNLABELLED" \
  --entrypoint sh "$image" -c "while true; do echo $unlabelled_token; sleep 1; done" >/dev/null
docker run -d --name "$PROBE" --label observability.logs=true --label "observability.app=$PROBE" \
  --entrypoint sh "$image" -c "while true; do echo $token; sleep 1; done" >/dev/null
failures_before=${#failures[@]}
check "Alloy ships a labelled container's logs to Loki" 60 log_stored "$token"

# The labelled log's arrival proves that a discovery round including both containers has run. The
# full NEGATIVE_WAIT after it gives the unlabelled log time to reach Loki too, had Alloy shipped it.
# Without that arrival, absence proves nothing.
if ((${#failures[@]} > failures_before)); then
  echo "skip Alloy skips a container without observability.logs=true (no labelled log arrived)"
else
  sleep "$NEGATIVE_WAIT"
  if log_absent "$unlabelled_token"; then
    echo "ok   Alloy skips a container without observability.logs=true"
  else
    echo "FAIL Alloy skips a container without observability.logs=true"
    failures+=("Alloy skips a container without observability.logs=true")
  fi
fi

# Network boundaries (docs/OBSERVABILITY.md, Networks). A container on the shared network, as the
# backend is, must reach Tempo's intake and be reachable by Prometheus, but not reach Loki, Grafana
# or Alloy. A name that does not resolve proves nothing on its own, so each is also tried by IP.
# Native Linux engines drop those connections, even to published ports (a raw-table rule since
# Docker 28.2). Docker Desktop lets connections to published ports through, so there such a
# connection is a WARN: not verified, never passed. Only an engine that reports itself exactly as
# Docker Desktop gets this exception; anything else is checked strictly.
if [[ $(docker info --format '{{.OperatingSystem}}|{{.Name}}' 2>/dev/null) == 'Docker Desktop|docker-desktop' ]]; then
  docker_desktop=true
else
  docker_desktop=false
fi
in_app() { docker exec "$APP_PROBE" "$@"; }
resolves() { in_app nslookup "$1" 2>/dev/null | grep -q '^Name:'; }
connects() { in_app nc -w 3 "$1" "$2" </dev/null >/dev/null 2>&1; }
stack_ip() { docker inspect -f "{{(index .NetworkSettings.Networks \"$STACK_NET\").IPAddress}}" "$1" 2>/dev/null; }
published() { [[ -n $(docker port "$1" "$2/tcp" 2>/dev/null) ]]; }
fail() {
  echo "FAIL $1"
  failures+=("$1")
}

docker rm -fv "$APP_PROBE" >/dev/null 2>&1 || true
failures_before=${#failures[@]}
if docker run -d --name "$APP_PROBE" --network "$SHARED_NET" "$image" >/dev/null; then
  check "A container on $SHARED_NET reaches Tempo's OTLP intake" 30 in_app wget -q -T 3 -O /dev/null \
    --header 'Content-Type: application/json' --post-data '{"resourceSpans":[]}' http://tempo:4318/v1/traces
  # The path the backend scrape takes.
  check "Prometheus reaches a container on $SHARED_NET" 30 \
    docker exec prometheus wget -q -T 3 -O /dev/null "http://$APP_PROBE:9090/-/ready"
  # The negative checks below rely on nslookup and nc in the stand-in. A missing tool or a failed
  # exec would look like isolation, so both must first work against Tempo.
  check "A container on $SHARED_NET resolves tempo" 30 resolves tempo
  check "A container on $SHARED_NET connects to tempo:4318 with nc" 30 connects tempo 4318
else
  fail "A container starts on $SHARED_NET"
fi

# Without working positive checks, a failed connection could be the probe's own fault.
if ((${#failures[@]} > failures_before)); then
  echo "skip Network isolation of Loki, Grafana and Alloy (the probe on $SHARED_NET does not work)"
else
  members=" $(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$SHARED_NET")"
  for service in loki grafana alloy; do
    name="$service is not on $SHARED_NET"
    if [[ $members == *" $service "* ]]; then fail "$name"; else echo "ok   $name"; fi
    name="$service does not resolve on $SHARED_NET"
    if resolves "$service"; then fail "$name"; else echo "ok   $name"; fi
  done
  # Loki's gRPC port is never published, so it is checked strictly on every engine.
  for target in loki:3100 loki:9096 grafana:3000 alloy:12345; do
    service=${target%:*} port=${target#*:}
    ip=$(stack_ip "$service") || ip=
    name="$service at ${ip:-?}:$port is unreachable from $SHARED_NET"
    if [[ -z $ip ]]; then
      fail "$name ($service has no address on $STACK_NET)"
    # A failed connection proves isolation only if the port is open on that address.
    elif ! docker exec prometheus nc -w 3 "$ip" "$port" </dev/null >/dev/null 2>&1; then
      fail "$name (Prometheus cannot reach it on $STACK_NET either, so the check proves nothing)"
    elif ! connects "$ip" "$port"; then
      echo "ok   $name"
    elif $docker_desktop && published "$service" "$port"; then
      echo "WARN $service at $ip:$port is reachable from $SHARED_NET: Docker Desktop lets connections to published ports through, so the isolation is not verified on this engine"
      warnings+=("$name")
    else
      fail "$name"
    fi
  done
  # An accepted limitation: sharing a network with Tempo and Prometheus opens all their ports.
  for target in tempo:3200 prometheus:9090; do
    if connects "${target%:*}" "${target#*:}"; then
      echo "info $target is reachable from $SHARED_NET (accepted limitation, see docs/OBSERVABILITY.md)"
    else
      echo "info $target is not reachable from $SHARED_NET"
    fi
  done
fi

if ((${#warnings[@]})); then
  echo "${#warnings[@]} check(s) not verified on this engine (WARN):" >&2
  printf '  %s\n' "${warnings[@]}" >&2
fi
if ((${#failures[@]})); then
  echo "${#failures[@]} check(s) failed: ${failures[*]}" >&2
  exit 1
fi
if ((${#warnings[@]})); then
  echo "No check failed, but the WARN checks above were not verified"
else
  echo "All checks passed"
fi
