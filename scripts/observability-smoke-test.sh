#!/usr/bin/env bash
# Smoke test for the running stack in observability/: every service is ready, Grafana reaches its
# datasources, a trace, a log line and a scrape each make it through, the logs of a container without
# the observability.logs=true label stay out of Loki, exemplars can be stored and linked to Tempo, and
# a container on the network the backend shares with the stack cannot reach Loki, Grafana or Alloy
# (see docs/OBSERVABILITY.md, Verify and Networks). It also checks the Docker API boundary of
# docker-socket-proxy: the proxy's running configuration, the requests it lets Alloy make, the
# requests, clients and network positions it refuses, and that every numbered line of a probe reaches
# Loki in normal operation (docs/OBSERVABILITY.md, Docker API access). CI runs it after
# `docker compose -f observability/compose.yaml up -d --wait`. It does not need the backend; the
# checks that do stay manual (scripts/observability-exemplar-check.sh covers exemplars). It starts,
# stops and changes nothing but its own probe containers, which it removes when it exits.
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
PROXY=docker-socket-proxy
API_NET=nimuairy-observability_docker-api
# Probes for the Docker API checks, each with exactly one network position: Alloy's network
# namespace (the proxy accepts Alloy's address only), another container on Alloy's network to the
# proxy, a container on each of the stack's two other networks, and the host's network namespace.
ALLOY_NS_PROBE=$PROBE-alloy-ns
FOREIGN_PROBE=$PROBE-docker-api
SHARED_PROBE=$PROBE-shared
STACK_PROBE=$PROBE-stack
HOST_PROBE=$PROBE-host
# Fixed names, so a run also removes what an interrupted one left behind.
PROBES=("$PROBE" "$UNLABELLED" "$APP_PROBE" "$ALLOY_NS_PROBE" "$FOREIGN_PROBE" "$SHARED_PROBE" "$STACK_PROBE"
  "$HOST_PROBE")
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

fatal() {
  echo "FATAL $1" >&2
  exit 1
}
# -v also removes the anonymous volume the Prometheus image declares for /prometheus.
cleanup() { docker rm -fv "${PROBES[@]}" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Exiting through the EXIT trap removes the probes of an interrupted run too.
trap 'exit 130' INT
trap 'exit 143' TERM

# The checks need the stack as `up --wait` leaves it. The script starts or repairs nothing, so a
# missing piece ends the run here instead of in a list of misleading failures.
docker info >/dev/null 2>&1 || fatal "the Docker engine does not answer"
for container in alloy "$PROXY"; do
  [[ $(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) == true ]] ||
    fatal "$container is not running; start the stack: docker compose -f observability/compose.yaml up -d --wait"
done
deadline=$((SECONDS + 60))
until [[ $(docker inspect -f '{{.State.Health.Status}}' "$PROXY") == healthy ]]; do
  ((SECONDS < deadline)) || fatal "$PROXY is not healthy after 60 s; see docker logs $PROXY"
  sleep 2
done
cleanup
# The daemon's clock, which docker logs --since compares with. On Docker Desktop the host's clock
# can differ from it.
started=$(docker info -f '{{.SystemTime}}')
run_id=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
api=$(docker version -f '{{.Server.APIVersion}}')
alloy_id=$(docker inspect -f '{{.Id}}' alloy)
alloy_ip=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$API_NET\").IPAddress}}" alloy 2>/dev/null) ||
  fatal "alloy has no address on $API_NET"
# Alloy must not restart during the run: its address tells its requests apart in the proxy's log.
alloy_state() { docker inspect -f '{{.State.StartedAt}} {{.RestartCount}}' alloy 2>/dev/null || true; }
alloy_before=$(alloy_state)
echo "info engine: $(docker info -f '{{.OperatingSystem}}'), Docker $(docker version -f '{{.Server.Version}}'), API $api"

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
# A harmless variable for the accepted-risk check below: through the proxy, Alloy can read the
# environment of any container, this one included.
env_marker="SMOKE_ENV_MARKER=$run_id"
image=$(docker inspect --format '{{.Config.Image}}' prometheus)
# The unlabelled container starts first, so both are running before any discovery round can find
# the labelled one. Without the allowlist filter, the round that discovers the labelled container
# would discover the unlabelled one as well.
docker run -d --name "$UNLABELLED" --label "observability.app=$UNLABELLED" --env "$env_marker" \
  --entrypoint sh "$image" -c "while true; do echo $unlabelled_token; sleep 1; done" >/dev/null
# Numbered lines, so that the continuity check at the end can tell whether one went missing.
docker run -d --name "$PROBE" --label observability.logs=true --label "observability.app=$PROBE" \
  --entrypoint sh "$image" -c "n=0; while true; do n=\$((n + 1)); echo \"$token seq=\$n\"; sleep 1; done" >/dev/null
probe_id=$(docker inspect -f '{{.Id}}' "$PROBE")
probe_started=$(docker inspect -f '{{.State.StartedAt}}' "$PROBE")
unlabelled_id=$(docker inspect -f '{{.Id}}' "$UNLABELLED")
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
# The trailing dot makes the name absolute. With a search domain in resolv.conf (GitHub's runners
# have one), busybox nslookup queries only <name>.<search domain>, never the bare name.
resolves_from() { docker exec "$1" nslookup "$2." 2>/dev/null | grep -q '^Name:'; }
connects_from() { docker exec "$1" nc -w 3 "$2" "$3" </dev/null >/dev/null 2>&1; }
resolves() { resolves_from "$APP_PROBE" "$1"; }
connects() { connects_from "$APP_PROBE" "$1" "$2"; }
net_ip() { docker inspect -f "{{(index .NetworkSettings.Networks \"$2\").IPAddress}}" "$1" 2>/dev/null; }
stack_ip() { net_ip "$1" "$STACK_NET"; }
published() { [[ -n $(docker port "$1" "$2/tcp" 2>/dev/null) ]]; }
fail() {
  echo "FAIL $1"
  failures+=("$1")
}

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

# Docker API boundary of docker-socket-proxy (docs/OBSERVABILITY.md, Docker API access). The proxy
# checks the client first (403 "forbidden IP" for anyone but Alloy), then the method (405), then the
# path (403), and logs each refusal with its reason before it answers.
pass() { echo "ok   $1"; }
warn() {
  echo "WARN $1"
  warnings+=("$1")
}
expect_equal() {
  if [[ $2 == "$3" ]]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi
}
# Sorted: Go templates range over map keys in order.
networks_of() {
  docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$1" 2>/dev/null |
    awk NF | paste -sd' ' -
}
members_of() {
  docker network inspect -f '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}' "$1" | awk NF | LC_ALL=C sort |
    paste -sd' ' -
}
api_net_id=$(docker network inspect -f '{{.Id}}' "$API_NET")
# Check names with names in place of the long IDs.
shown() {
  local s=${1//$probe_id/<probe>}
  s=${s//$unlabelled_id/<unlabelled>}
  s=${s//${unlabelled_id:0:12}/<unlabelled, short>}
  s=${s//$api_net_id/<$API_NET>}
  printf '%s' "${s//$alloy_id/alloy}"
}
# The probes below run the Grafana image, which the stack has already pulled: it has curl, busybox nc
# and nslookup. busybox nc cannot be the HTTP client: it half-closes the connection once it has sent
# the request, and the proxy's Go server then cancels a request it is passing on to Docker (502).
client_image=$(docker inspect --format '{{.Config.Image}}' grafana)
start_probe() {
  local probe=$1
  shift
  if docker run -d --name "$probe" "$@" --entrypoint sleep "$client_image" 600 >/dev/null &&
    docker exec "$probe" sh -c 'command -v curl && command -v nc && command -v nslookup' >/dev/null; then
    return 0
  fi
  fail "$probe starts, with curl, nc and nslookup"
  return 1
}
# A probe's results describe only the network position it has, so that is checked before it is used:
# its network mode and exactly the networks it is on.
assert_vantage() {
  local expected="$2 [$3]" actual
  actual="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$1" 2>/dev/null || true) [$(networks_of "$1" || true)]"
  if [[ $actual == "$expected" ]]; then
    pass "$1 has network mode and networks: $(shown "$expected")"
    return 0
  fi
  fail "$1 has network mode and networks: $(shown "$expected") (got $(shown "$actual"))"
  return 1
}
# One HTTP request from inside a probe. Sets status (empty when no HTTP response came back) and
# response (headers and body), which is never printed: an inspect returns environment variables.
# Each request carries its own smoke= parameter, which the proxy logs with a refusal; the proxy
# matches only the path, and Docker ignores parameters it does not know. --path-as-is sends dot
# segments as written.
req_n=0
request() {
  local sep='?' method=(-X "$3")
  if [[ $4 == *'?'* ]]; then sep='&'; fi
  if [[ $3 == HEAD ]]; then method=(-I); fi
  req_n=$((req_n + 1))
  printf -v marker 'smoke=%s-%03d' "$run_id" "$req_n"
  logged=
  response=$(docker exec "$1" curl -sS -i --path-as-is --max-time 10 "${method[@]}" "http://$2:2375$4$sep$marker" \
    2>/dev/null | tr -d '\000\r') || true
  status=
  if [[ $response =~ ^HTTP/[0-9.]+\ ([0-9]{3}) ]]; then status=${BASH_REMATCH[1]}; fi
}
refusals() { docker logs --since "$started" "$PROXY" 2>&1 | tr -d '\r' | grep -F 'msg="blocked request"' || true; }
# The proxy logs every refusal with its reason before it answers. This request's line, found by its
# marker, shows that the proxy refused it and why; a status code alone could have come from Docker.
blocked_logged() {
  local deadline=$((SECONDS + 5))
  until logged=$(refusals | grep -F "$marker"); do
    if ((SECONDS >= deadline)); then return 1; fi
    sleep 1
  done
  [[ $logged == *"reason=\"$1\""* && $logged == *"response=$2"* && $logged == *"client=${3:+$3:}"* ]]
}
expect_allowed() {
  request "$ALLOY_NS_PROBE" "$PROXY" "$2" "$3"
  if [[ $status == 200 && $response == *"$4"* ]]; then
    pass "$1"
  else
    fail "$1 (expected 200 with Docker's answer, got ${status:-no HTTP response}, ${#response} bytes)"
  fi
}
# Sets confirmed, so that the caller can keep the marker of a refusal seen in the proxy's log.
expect_blocked() {
  confirmed=false
  request "$2" "$3" "$4" "$5"
  if [[ -z $status ]]; then
    fail "$1 (no HTTP response: the request did not reach the proxy, so nothing is verified)"
  elif [[ $status != "$6" ]]; then
    fail "$1 (expected $6, got $status)"
  elif ! blocked_logged "$7" "$6" "${8:-}"; then
    fail "$1 ($6, but the proxy logged no matching refusal: ${logged:-no line with $marker})"
  else
    pass "$1"
    confirmed=true
  fi
}

# Configuration, as the running containers have it, not as the Compose file says. This runs before
# any probe joins the proxy's network.
socket_mounts=
for container in $(docker ps -a --filter label=com.docker.compose.project=nimuairy-observability \
  --format '{{.Names}}' | LC_ALL=C sort); do
  if [[ $(docker inspect -f '{{range .Mounts}}{{.Source}} {{.Destination}} {{end}}' "$container") == *docker.sock* ]]; then
    socket_mounts+="${socket_mounts:+ }$container"
  fi
done
expect_equal "Of the stack's containers, only $PROXY mounts the Docker socket" "$socket_mounts" "$PROXY"
if [[ $(docker inspect -f '{{range .Mounts}}{{.Source}} {{.Destination}} {{end}}' alloy) == *docker.sock* ]]; then
  fail "Alloy does not mount the Docker socket"
else
  pass "Alloy does not mount the Docker socket"
fi
# NetworkSettings.Ports would list 2375 anyway: the image exposes it.
bindings=$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$PROXY")
published_ports=$(docker port "$PROXY" 2>&1) || true
if [[ ($bindings == '{}' || $bindings == null) && -z $published_ports ]]; then
  pass "$PROXY publishes no port"
else
  fail "$PROXY publishes no port (port bindings $bindings; docker port: $published_ports)"
fi
expect_equal "$PROXY is on $API_NET only" "$(networks_of "$PROXY")" "$API_NET"
expect_equal "Alloy is on $API_NET and $STACK_NET only" "$(networks_of alloy)" "$API_NET $STACK_NET"
expect_equal "$API_NET is internal" "$(docker network inspect -f '{{.Internal}}' "$API_NET")" true
expect_equal "Only Alloy and $PROXY are on $API_NET" "$(members_of "$API_NET")" "alloy $PROXY"
# Pinned as in compose.yaml: a new version of the proxy must pass these checks before this changes.
expect_equal "$PROXY runs wollomatic/socket-proxy:1.13.2" "$(docker inspect -f '{{.Config.Image}}' "$PROXY")" \
  wollomatic/socket-proxy:1.13.2
proxy_user=$(docker inspect -f '{{.Config.User}}' "$PROXY")
if [[ $proxy_user =~ ^65534:[0-9]+$ ]]; then
  pass "$PROXY runs as user 65534 ($proxy_user)"
else
  fail "$PROXY runs as user 65534 (got '$proxy_user')"
fi
expect_equal "$PROXY has a read-only root filesystem, no privileges or capabilities, and no-new-privileges" \
  "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.Privileged}} {{json .HostConfig.CapDrop}} {{len .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}}' "$PROXY")" \
  'true false ["ALL"] 0 ["no-new-privileges:true"]'
# The proxy takes its rules only from its flags and from SP_* variables: SP_ALLOW_<METHOD> would
# allow another method, SP_PROXYCONTAINERNAME would add allowlists from container labels. The
# requests below sample the rules; this pins all of them. Change it together with compose.yaml.
expected_command='["/socket-proxy"] ["-listenip=0.0.0.0","-allowfrom=alloy","-allowHEAD=/_ping","-allowGET=/v1\\.[0-9]+/(containers/json|networks|containers/[0-9a-f]{64}/(json|logs))","-allowhealthcheck","-watchdoginterval=60","-stoponwatchdog"]'
expect_equal "$PROXY runs exactly the command in observability/compose.yaml" \
  "$(docker inspect -f '{{json .Config.Entrypoint}} {{json .Config.Cmd}}' "$PROXY")" "$expected_command"
proxy_env=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$PROXY") || proxy_env=SP_UNREADABLE
if [[ $'\n'$proxy_env == *$'\n'SP_* ]]; then
  fail "$PROXY has no SP_* variables"
else
  pass "$PROXY has no SP_* variables"
fi

# Requests from Alloy's address, the only one the proxy accepts: this probe shares Alloy's network
# namespace. The markers of the refusals the proxy logged here are kept for the last check.
refusal_markers=()
api_answers() {
  request "$ALLOY_NS_PROBE" "$PROXY" HEAD /_ping
  [[ $status == 200 && $response == *$'\n'Api-Version:* ]]
}
unlabelled_state() { docker inspect -f '{{.State.Running}} {{.State.StartedAt}}' "$UNLABELLED" 2>/dev/null || true; }
if start_probe "$ALLOY_NS_PROBE" --network container:alloy &&
  assert_vantage "$ALLOY_NS_PROBE" "container:$alloy_id" ""; then
  # healthy means only that the proxy can open the socket; this is the first answer of its API.
  check "The proxy's API answers Alloy: HEAD /_ping (200 from Docker)" 60 api_answers
  expect_allowed "Alloy's address gets 200 for GET /v$api/containers/json" GET "/v$api/containers/json" \
    "\"Id\":\"$probe_id\""
  expect_allowed "Alloy's address gets 200 for GET /v$api/networks" GET "/v$api/networks" "\"Name\":\"$API_NET\""
  expect_allowed "Alloy's address gets 200 for GET /v$api/containers/<probe>/json" GET \
    "/v$api/containers/$probe_id/json" "\"Id\":\"$probe_id\""
  # Without follow, Docker ends the response after the last line. Alloy's followed stream is what
  # the continuity check at the end covers.
  expect_allowed "Alloy's address gets 200 for GET /v$api/containers/<probe>/logs" GET \
    "/v$api/containers/$probe_id/logs?stdout=1&tail=1" "$token seq="
  # Accepted risk (docs/OBSERVABILITY.md, Docker API access). If this ever fails, the docs are wrong.
  expect_allowed "Accepted risk: Alloy's address can inspect a container outside the log allowlist, environment included" \
    GET "/v$api/containers/$unlabelled_id/json" "$env_marker"

  # Each request is one Docker would answer, or never 403: only the proxy's path rule refuses it.
  refused_paths=(
    "GET /_ping"                                                 # only HEAD may ping
    "HEAD /v$api/containers/json"                                # HEAD allows /_ping only
    "GET /version"                                               # not a call Alloy makes
    "GET /v$api/info"                                            # the host's details
    "GET /containers/json"                                       # a version prefix is required
    "GET /v$api/networks/$api_net_id"                            # the rule ends after /networks
    "GET /v$api/containers/json/smoke-suffix"                    # and after /containers/json
    "GET /v$api/containers/$UNLABELLED/json"                     # names do not pass, full IDs do
    "GET /v$api/containers/${unlabelled_id:0:12}/json"           # short IDs do not pass either
    "GET /v$api/containers/$probe_id/archive?path=/etc/hostname" # other container endpoints
    "GET /v$api/containers/$probe_id/json/../../info"            # dot segments are kept for matching
  )
  for r in "${refused_paths[@]}"; do
    expect_blocked "Alloy's address gets 403 for $(shown "$r")" "$ALLOY_NS_PROBE" "$PROXY" "${r%% *}" "${r#* }" \
      403 'path not allowed'
    if $confirmed; then refusal_markers+=("$marker"); fi
  done
  # The DELETE targets the test's own unlabelled container: had it got through, that container, and
  # nothing else, would be gone.
  unlabelled_before=$(unlabelled_state)
  refused_methods=(
    "POST /v$api/containers/json"
    "POST /v$api/containers/create"
    "DELETE /v$api/containers/$unlabelled_id?force=1"
    "PUT /v$api/containers/$unlabelled_id/archive?path=/tmp"
  )
  for r in "${refused_methods[@]}"; do
    expect_blocked "Alloy's address gets 405 for $(shown "$r")" "$ALLOY_NS_PROBE" "$PROXY" "${r%% *}" "${r#* }" \
      405 'method not allowed'
    if $confirmed; then refusal_markers+=("$marker"); fi
  done
  if [[ $unlabelled_before == true\ * ]]; then
    expect_equal "No refused request reached Docker: $UNLABELLED runs unchanged" "$(unlabelled_state)" \
      "$unlabelled_before"
  else
    fail "No refused request reached Docker ($UNLABELLED was not running before: '$unlabelled_before')"
  fi
else
  echo "skip Requests from Alloy's address (no probe in Alloy's network namespace)"
fi

# Another client on the proxy's network. It reaches the proxy, so a 403 can only be the proxy's
# client check; the requests are ones Alloy gets answered.
if start_probe "$FOREIGN_PROBE" --network "$API_NET" && assert_vantage "$FOREIGN_PROBE" "$API_NET" "$API_NET"; then
  foreign_ip=$(net_ip "$FOREIGN_PROBE" "$API_NET") || foreign_ip=
  failures_before=${#failures[@]}
  check "Another container on $API_NET resolves $PROXY" 10 resolves_from "$FOREIGN_PROBE" "$PROXY"
  check "Another container on $API_NET connects to $PROXY:2375" 10 connects_from "$FOREIGN_PROBE" "$PROXY" 2375
  if ((${#failures[@]} > failures_before)) || [[ -z $foreign_ip ]]; then
    echo "skip The proxy's client check (the other container does not reach the proxy)"
  else
    for r in "HEAD /_ping" "GET /v$api/containers/json"; do
      expect_blocked "Another container on $API_NET gets 403 for $r (forbidden IP)" "$FOREIGN_PROBE" "$PROXY" \
        "${r%% *}" "${r#* }" 403 'forbidden IP' "$foreign_ip"
    done
  fi
fi
docker rm -fv "$FOREIGN_PROBE" >/dev/null 2>&1 || true

# The stack's other networks: a container on each, on that network alone. The proxy's name must not
# resolve and its address must not take a connection. Controls: the same probe resolves and reaches
# a service that only its network carries, and Alloy's network namespace reaches the proxy's address.
proxy_ip=$(net_ip "$PROXY" "$API_NET") || proxy_ip=
proxy_port_open=false
failures_before=${#failures[@]}
check "Alloy's network namespace connects to $PROXY at ${proxy_ip:-?}:2375 (control)" 10 \
  connects_from "$ALLOY_NS_PROBE" "${proxy_ip:-unknown}" 2375
if ((${#failures[@]} == failures_before)) && [[ -n $proxy_ip ]]; then proxy_port_open=true; fi
proxy_unreachable_from() {
  local before=${#failures[@]}
  if ! start_probe "$1" --network "$2" || ! assert_vantage "$1" "$2" "$2"; then
    echo "skip $PROXY is unreachable from $2 (no probe on $2 alone)"
    return 0
  fi
  check "A container on $2 alone resolves $3 (control)" 10 resolves_from "$1" "$3"
  check "A container on $2 alone connects to $3:$4 (control)" 10 connects_from "$1" "$3" "$4"
  if ((${#failures[@]} > before)) || ! $proxy_port_open; then
    echo "skip $PROXY is unreachable from $2 (a control failed, so a refusal would prove nothing)"
    return 0
  fi
  if resolves_from "$1" "$PROXY"; then fail "$PROXY does not resolve on $2"; else pass "$PROXY does not resolve on $2"; fi
  if connects_from "$1" "$proxy_ip" 2375; then
    request "$1" "$proxy_ip" HEAD /_ping
    fail "$PROXY at $proxy_ip:2375 is unreachable from $2 (TCP connects; HTTP ${status:-no response})"
  else
    pass "$PROXY at $proxy_ip:2375 is unreachable from $2"
  fi
}
proxy_unreachable_from "$SHARED_PROBE" "$SHARED_NET" tempo 4318
proxy_unreachable_from "$STACK_PROBE" "$STACK_NET" loki 3100

# The host's network namespace. Docker gives an internal network's bridge an address on the host, so
# on Linux a host process reaches the proxy's address; the proxy must refuse it and log the bridge's
# gateway as the client. On Docker Desktop host networking is an opt-in feature whose namespace
# Docker does not document, so nothing here counts as passed there.
gateway=$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' "$API_NET")
name="A client in the host's network namespace gets 403 from $PROXY (forbidden IP)"
if ! $proxy_port_open; then
  echo "skip $name (the proxy's address is not known to take connections)"
elif start_probe "$HOST_PROBE" --network host && assert_vantage "$HOST_PROBE" host host; then
  request "$HOST_PROBE" "$proxy_ip" HEAD /_ping
  if [[ -z $status ]]; then
    if $docker_desktop; then
      warn "$name: no connection to $proxy_ip:2375 on Docker Desktop, so host access is not verified on this engine"
    else
      fail "$name (no connection to $proxy_ip:2375, although Docker gives the host an address on internal networks; the client check from the host is unverified)"
    fi
  elif [[ $status != 403 ]] || ! blocked_logged 'forbidden IP' 403; then
    fail "$name (got $status; proxy log: ${logged:-no line with $marker})"
  else
    logged_client=${logged#*client=}
    logged_client=${logged_client%% *}
    if $docker_desktop; then
      warn "$name: refused client $logged_client, but Docker Desktop's host network is not a Linux host's network namespace, so host access is not verified on this engine"
    elif [[ $logged_client != "$gateway":* ]]; then
      fail "$name (the proxy saw client $logged_client, not the $API_NET gateway $gateway)"
    else
      pass "$name, as the $API_NET gateway $gateway"
    fi
  fi
fi
expect_equal "Only Alloy and $PROXY are on $API_NET after these checks" "$(members_of "$API_NET")" "alloy $PROXY"

# Normal log-stream continuity: every numbered line the labelled probe wrote reached Loki through
# Alloy's followed stream and the proxy. This covers normal operation in this run's window only; it
# says nothing about outages and is no proof of lossless collection.
probe_seqs() {
  local body
  body=$(curl -fsSG --max-time 10 127.0.0.1:3100/loki/api/v1/query_range \
    --data-urlencode "query={app=\"$PROBE\"} |= \"$token\"" --data-urlencode since=15m \
    --data-urlencode limit=1000) || return 1
  grep -q '"status":"success"' <<<"$body" || return 1
  grep -oE "$token seq=[0-9]+" <<<"$body" | sed 's/.* seq=//' || true
}
last=$(docker logs --tail 1 "$PROBE" 2>&1 | tr -d '\r' | sed -n 's/.* seq=\([0-9]*\)$/\1/p')
seqs=
missing=
answered=false
continuity_ok=false
deadline=$((SECONDS + 30))
while [[ -n $last ]]; do
  if seqs=$(probe_seqs); then
    answered=true
    missing=$(awk -v last="$last" '{ seen[$1] = 1 } END { for (i = 1; i <= last; i++) if (!(i in seen)) printf "%d ", i }' <<<"$seqs")
    if [[ -z $missing ]]; then break; fi
  fi
  if ((SECONDS >= deadline)); then break; fi
  sleep 2
done
name="Loki has every line the probe wrote, 1 to ${last:-?}, at least 15"
if [[ -z $last ]]; then
  fail "$name (no numbered line in docker logs $PROBE)"
elif ! $answered; then
  fail "$name (Loki did not answer the query)"
elif ((last < 15)); then
  fail "$name (only $last lines, too few to judge)"
elif [[ -n $missing ]]; then
  fail "$name (still missing after 30 s: $(cut -d' ' -f1-10 <<<"$missing"))"
else
  pass "$name: no gap in normal operation (this run only)"
  continuity_ok=true
fi
if [[ -n $seqs ]]; then
  total=$(grep -c . <<<"$seqs" || true)
  unique=$(sort -nu <<<"$seqs" | grep -c . || true)
  echo "info $((total - unique)) duplicate line(s) of the probe in Loki (reported, never a failure)"
fi
# What each message means comes from Alloy v1.20.1's tailer: "could not transfer logs" is a followed
# stream that broke with an error, which in this window has no harmless cause (Alloy keeps a running,
# unchanged target's tailer). It is also the one sign of the http:// regression in
# observability/alloy/config.alloy, whose streams restart every 5 s from the last second, so that
# the line check alone could pass. "finished transferring logs" is a stream that ended cleanly,
# normally because its container stopped, and the other two are failed attempts to open one; Alloy
# reopens a stream within 5 s from the last second it read, so these say nothing about loss.
stream_messages() { grep -cF "msg=\"$1\"" <<<"$stream_log" || true; }
name="Alloy reports no broken stream for the probe (could not transfer logs)"
if [[ $(docker inspect -f '{{.State.Running}} {{.State.StartedAt}}' "$PROBE" 2>/dev/null) != "true $probe_started" ]]; then
  fail "The labelled probe ran throughout the run"
  echo "skip $name (it cannot be judged)"
elif [[ $(alloy_state) != "$alloy_before" ]]; then
  fail "Alloy kept running throughout the run (it restarted)"
  echo "skip $name (it cannot be judged)"
else
  stream_log=$(docker logs --since "$probe_started" alloy 2>&1 | tr -d '\r' | grep -F "$probe_id" || true)
  if (($(stream_messages 'could not transfer logs') == 0)); then
    pass "$name"
  else
    grep -F 'msg="could not transfer logs"' <<<"$stream_log" | head -5 | sed 's/^/     /'
    fail "$name (lines above)"
  fi
  echo "info Alloy's other stream messages for the probe: finished transferring logs" \
    "$(stream_messages 'finished transferring logs'), could not fetch logs for container" \
    "$(stream_messages 'could not fetch logs for container'), could not inspect container info" \
    "$(stream_messages 'could not inspect container info') (interruptions Alloy recovers from, not loss)"
fi
name="Alloy still skips the container without observability.logs=true at the end of the run"
if ! $continuity_ok; then
  echo "skip $name (the labelled probe's lines did not all arrive)"
elif log_absent "$unlabelled_token"; then
  pass "$name"
else
  fail "$name"
fi

# Alloy's own requests over the whole run. A refusal is Alloy's when it comes from Alloy's address
# and has no smoke= parameter: every request of this script has one, and Alloy's never do. So the
# deliberate refusals above, sent from the same address, never count, whatever the order.
name="The proxy refused none of Alloy's own requests during the run"
all_refusals=$(refusals)
seen_markers=0
for m in "${refusal_markers[@]}"; do
  if grep -qF "$m" <<<"$all_refusals"; then seen_markers=$((seen_markers + 1)); fi
done
if [[ $(alloy_state) != "$alloy_before" ]]; then
  fail "Alloy kept running throughout the run (it restarted, so its requests cannot be told apart)"
  echo "skip $name"
elif ((${#refusal_markers[@]} == 0 || seen_markers < ${#refusal_markers[@]})); then
  fail "The proxy's log shows this run's own refusals ($seen_markers of ${#refusal_markers[@]})"
  echo "skip $name"
elif ! $continuity_ok; then
  echo "skip $name (no proof that Alloy used the proxy in this window: the continuity check failed)"
else
  alloy_refusals=$(grep -F "client=$alloy_ip:" <<<"$all_refusals" | grep -vF 'smoke=' || true)
  if [[ -z $alloy_refusals ]]; then
    pass "$name"
  else
    head -5 <<<"$alloy_refusals" | sed 's/^/     /'
    fail "$name ($(grep -c . <<<"$alloy_refusals") refusal(s), first ones above)"
  fi
  others=$(grep -vF "client=$alloy_ip:" <<<"$all_refusals" | grep -vF "smoke=$run_id-" || true)
  if [[ -n $others ]]; then
    echo "info $(grep -c . <<<"$others") refusal(s) of other clients without this run's marker, not Alloy's:"
    head -5 <<<"$others" | sed 's/^/     /'
  fi
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
