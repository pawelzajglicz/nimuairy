#!/usr/bin/env bash
# Outage check for docker-socket-proxy, Alloy's only path to the Docker API (docs/OBSERVABILITY.md,
# Docker API access). It stops the proxy for 20-45 s while Alloy runs, starts it again and checks
# that Alloy resumes without a restart: the tailer of a container it already followed, discovery of
# a container started after the outage, and every numbered line of this run, the outage included,
# in Loki. That holds for this controlled outage only; it is no proof of lossless collection.
# CI runs it after the smoke test, on the stack `up --wait` leaves.
#
# While it runs, Alloy collects no logs from any container on this Docker host, so do not run it
# next to the smoke test, or on the VPS without intent. It changes nothing but the proxy, which it
# stops and starts, and its own probe containers. On every exit it can catch (INT, TERM, HUP too) it
# brings the proxy back. After a SIGKILL of the script the proxy stays stopped, because
# `restart: unless-stopped` never restarts a container stopped by hand: `docker start
# docker-socket-proxy` repairs that.
set -euo pipefail

PROXY=docker-socket-proxy
API_NET=nimuairy-observability_docker-api
COMPOSE_UP="docker compose -f observability/compose.yaml up -d --wait"
# Fixed names, so a run also removes what an interrupted one left behind.
PROBE=observability-proxy-resilience
# Started once the API answers again: only a working discovery can find a container that did not
# exist before the outage.
LATE_PROBE=$PROBE-late
# Shares Alloy's network namespace, so it reaches the proxy as Alloy does.
ALLOY_NS_PROBE=$PROBE-alloy-ns
PROBES=("$PROBE" "$LATE_PROBE" "$ALLOY_NS_PROBE")
# The stack's other services, which the outage must not restart.
OTHERS=(prometheus loki tempo grafana)
# Seconds the proxy stays stopped: at least MIN_OUTAGE, so that several of Alloy's 5 s discovery and
# tailer rounds fail, and at most MAX_OUTAGE while waiting for Alloy to log both kinds of failure.
MIN_OUTAGE=20
MAX_OUTAGE=45
POST_RECOVERY_LINES=3
# Loki returns at most this many lines. A result that size may be cut off, so a gap in it would prove
# nothing.
LOKI_LIMIT=1000
failures=()
preflight_done=false
proxy_touched=false
proxy_restored=false

pass() { echo "ok   $1"; }
fail() {
  echo "FAIL $1"
  failures+=("$1")
}
info() { echo "info $1"; }
fatal() {
  echo "FATAL $1" >&2
  exit 1
}
expect_equal() {
  if [[ $2 == "$3" ]]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi
}
# Polls a command every 2 s until it succeeds or the timeout (seconds) runs out. The command runs in
# this shell, so the variables it sets stay set.
wait_for() {
  local timeout=$1
  shift
  local deadline=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || return 1
    sleep 2
  done
}
finish() {
  if ((${#failures[@]})); then
    echo "${#failures[@]} check(s) failed: ${failures[*]}" >&2
    exit 1
  fi
  echo "All checks passed"
  exit 0
}
# Without a baseline, an outage or a recovery, the checks after it cannot be judged: they are
# skipped, which never counts as passed.
give_up() {
  echo "skip $1"
  finish
}

ready() { curl -fsS --max-time 5 "$1"; }
daemon_now() { docker info -f '{{.SystemTime}}'; }
running() { [[ $(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null) == true ]]; }
stopped() { [[ $(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null) == false ]]; }
healthy() { [[ $(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null) == healthy ]]; }
# Any restart, by hand or by the restart policy, changes one of these.
state_of() { docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' "$1" 2>/dev/null || true; }
# Every start sets StartedAt and every stop FinishedAt, so a start during the outage changes this
# even if the proxy is stopped again before the next poll.
proxy_state() { docker inspect -f '{{.State.Running}} {{.State.StartedAt}} {{.State.FinishedAt}}' "$PROXY" 2>/dev/null || true; }
others_state() { for c in "${OTHERS[@]}"; do echo "$c $(state_of "$c")"; done; }
net_ip() { docker inspect -f "{{(index .NetworkSettings.Networks \"$2\").IPAddress}}" "$1" 2>/dev/null; }
# Sorted: Go templates range over map keys in order.
networks_of() {
  docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$1" 2>/dev/null |
    awk NF | paste -sd' ' -
}
members_of() {
  docker network inspect -f '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}' "$1" | awk NF | LC_ALL=C sort |
    paste -sd' ' -
}
# Read from the probe's own log, which does not depend on Alloy.
last_seq() { docker logs --tail 1 "$1" 2>&1 | tr -d '\r' | sed -n 's/.* seq=\([0-9]*\)$/\1/p'; }
writer() { echo "n=0; while true; do n=\$((n + 1)); echo \"$1 seq=\$n\"; sleep 1; done"; }
no_mounts() { [[ $(docker inspect -f '{{len .Mounts}}' "$1" 2>/dev/null) == 0 ]]; }

# One HEAD /_ping from Alloy's network namespace. Sets api_verdict: ANSWERED <status>, UNAVAILABLE
# (curl ran and could not resolve the proxy's name, exit 6, or connect to it, exit 7), or ERROR with
# what came back instead (the exec failed, curl is missing, a timeout). Only UNAVAILABLE is evidence
# of an outage. The resilience= parameter tells these requests apart from Alloy's in the proxy's
# log; the proxy matches only the path.
api_probe() {
  local out re=$'\n''HTTP/[0-9.]+ ([0-9]{3})'
  out=$(docker exec "$ALLOY_NS_PROBE" sh -c 'command -v curl >/dev/null || { echo "no curl in the probe"; exit; }
    out=$(curl -sS -I --max-time 5 "http://$1:2375/_ping?resilience=$2" 2>&1); echo "curl-exit=$?"
    printf "%s\n" "$out"' _ "$PROXY" "$run_id" 2>&1 | tr -d '\r') || true
  api_headers=
  case ${out%%$'\n'*} in
    curl-exit=0)
      if [[ $out =~ $re ]]; then
        api_verdict="ANSWERED ${BASH_REMATCH[1]}"
        api_headers=$out
      else
        api_verdict="ERROR (curl exit 0 without an HTTP status)"
      fi
      ;;
    curl-exit=6 | curl-exit=7) api_verdict="UNAVAILABLE (${out#*$'\n'})" ;;
    *) api_verdict="ERROR (${out:-no output})" ;;
  esac
}
# healthy means only that the proxy can open the socket; this is an answer of its API.
api_answers() {
  api_probe
  [[ $api_verdict == 'ANSWERED 200' && $api_headers == *$'\n'Api-Version:* ]]
}
api_unavailable() {
  api_probe
  [[ $api_verdict == UNAVAILABLE* ]]
}

# The seq numbers of the lines with token $1 in Loki. Anything but an answered log query is no
# answer, never an empty result. The query starts a second before the first probe did (daemon
# clock), so it covers every line judged however long the run takes.
loki_seqs() {
  local body
  body=$(curl -fsSG --max-time 10 127.0.0.1:3100/loki/api/v1/query_range \
    --data-urlencode "query={app=\"$PROBE\"} |= \"$1\"" --data-urlencode "start=$loki_start" \
    --data-urlencode "limit=$LOKI_LIMIT") || return 1
  grep -q '"status":"success"' <<<"$body" && grep -q '"resultType":"streams"' <<<"$body" || return 1
  grep -oE "$1 seq=[0-9]+" <<<"$body" | sed 's/.* seq=//' || true
}
# Loki has at least $3 lines of token $1 with a seq above $2.
loki_has_after() {
  local seqs
  seqs=$(loki_seqs "$1") || return 1
  (($(awk -v min="$2" '$1 > min { n++ } END { print n + 0 }' <<<"$seqs") >= $3))
}
# Whole seconds from daemon time $1 to the ts= of Alloy log line $2.
secs_after() {
  local ts
  ts=$(grep -oE '^ts=[^ ]+' <<<"$2" | cut -c4-)
  if [[ -n $ts ]]; then echo $(($(date -d "$ts" +%s) - $(date -d "$1" +%s))); else echo '?'; fi
}

cleanup_probes() { docker rm -fv "${PROBES[@]}" >/dev/null 2>&1 || true; }
on_exit() {
  local code=$? restored left
  set +e
  # A second Ctrl-C must not cut the restore short.
  trap '' INT TERM HUP
  if $proxy_touched && ! $proxy_restored; then
    # docker restart works on a running, stopping or stopped container, and the daemon finishes the
    # stop and start even if this script dies meanwhile.
    info "restoring $PROXY with docker restart"
    restored=false
    if docker restart "$PROXY" >/dev/null && wait_for 30 running "$PROXY" && wait_for 60 healthy "$PROXY"; then
      if ! running "$ALLOY_NS_PROBE" || wait_for 60 api_answers; then restored=true; fi
    fi
    if $restored; then
      info "$PROXY restored: running and healthy"
    else
      echo "RESTORE FAILED $PROXY: $(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$PROXY" 2>&1)" >&2
      docker logs --tail 20 "$PROXY" 2>&1 | sed 's/^/     /' >&2
      echo "Repair: docker start $PROXY, or $COMPOSE_UP" >&2
      ((code)) || code=1
    fi
  fi
  cleanup_probes
  left=$(docker ps -aq --filter "name=$PROBE")
  if [[ -n $left ]]; then
    echo "FAIL probe containers left behind: $(docker ps -a --filter "name=$PROBE" --format '{{.Names}}' | paste -sd' ' -)" >&2
    ((code)) || code=1
  fi
  # Restarting Alloy is its restart policy's job; this script never stops it.
  if $preflight_done && ! running alloy; then
    echo "FAIL alloy is not running at exit. Repair: docker start alloy, or $COMPOSE_UP" >&2
    ((code)) || code=1
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# Preflight: the stack as `up --wait` leaves it. The script starts or repairs nothing here, so a
# missing piece ends the run before the proxy is touched.
docker info >/dev/null 2>&1 || fatal "the Docker engine does not answer"
for container in alloy "$PROXY" "${OTHERS[@]}"; do
  running "$container" ||
    fatal "$container is not running. A container stopped by hand stays stopped: docker start $container, or $COMPOSE_UP"
done
wait_for 60 healthy "$PROXY" || fatal "$PROXY is not healthy after 60 s; see docker logs $PROXY"
wait_for 60 ready 127.0.0.1:12345/-/ready || fatal "Alloy is not ready after 60 s"
wait_for 60 ready 127.0.0.1:3100/ready || fatal "Loki is not ready after 60 s"
# With another path to the Docker API, a recovery would prove nothing about the proxy.
[[ $(docker inspect -f '{{range .Mounts}}{{.Source}} {{.Destination}} {{end}}' alloy) != *docker.sock* ]] ||
  fatal "Alloy mounts the Docker socket, so the proxy is not its only path to the Docker API"
cleanup_probes
run_id=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
token=$PROBE-$run_id
late_token=$LATE_PROBE-$run_id
alloy_id=$(docker inspect -f '{{.Id}}' alloy)
alloy_ip=$(net_ip alloy "$API_NET") && [[ -n $alloy_ip ]] || fatal "alloy has no address on $API_NET"
alloy_before=$(state_of alloy)
others_before=$(others_state)
proxy_id=$(docker inspect -f '{{.Id}}' "$PROXY")
proxy_ip_before=$(net_ip "$PROXY" "$API_NET") || proxy_ip_before=?
# The Grafana image, which the stack has already pulled, has sh and curl and declares no volume.
client_image=$(docker inspect -f '{{.Config.Image}}' grafana)
preflight_done=true
info "engine: $(docker info -f '{{.OperatingSystem}}'), Docker $(docker version -f '{{.Server.Version}}'), API $(docker version -f '{{.Server.APIVersion}}')"
info "run $run_id; $PROXY restart count before the run: $(docker inspect -f '{{.RestartCount}}' "$PROXY")"

# Baseline: before the outage, the proxy answers Alloy's address and the probe's lines reach Loki,
# which takes discovery, inspect and the followed stream, all through the proxy.
if ! docker run -d --name "$ALLOY_NS_PROBE" --network container:alloy --entrypoint sleep "$client_image" 900 \
  >/dev/null; then
  fail "A probe starts in Alloy's network namespace"
  give_up "the outage (no probe to reach the proxy as Alloy does)"
fi
expect_equal "$ALLOY_NS_PROBE has Alloy's network namespace and no volume" \
  "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$ALLOY_NS_PROBE") [$(networks_of "$ALLOY_NS_PROBE")] $(no_mounts "$ALLOY_NS_PROBE" && echo none)" \
  "container:$alloy_id [] none"
if wait_for 60 api_answers; then
  pass "The proxy's API answers Alloy's address: HEAD /_ping 200 with Api-Version"
else
  fail "The proxy's API answers Alloy's address (last answer: $api_verdict)"
  give_up "the outage (no baseline)"
fi
docker run -d --name "$PROBE" --label observability.logs=true --label "observability.app=$PROBE" \
  --entrypoint sh "$client_image" -c "$(writer "$token")" >/dev/null
probe_id=$(docker inspect -f '{{.Id}}' "$PROBE")
probe_started=$(docker inspect -f '{{.State.StartedAt}}' "$PROBE")
loki_start=$(($(date -d "$probe_started" +%s) - 1))
if no_mounts "$PROBE"; then pass "$PROBE has no volume"; else fail "$PROBE has no volume"; fi
if wait_for 60 loki_has_after "$token" 0 5; then
  pass "Alloy ships the probe's lines to Loki through the proxy (at least 5)"
else
  fail "Alloy ships the probe's lines to Loki through the proxy (at least 5 within 60 s)"
  give_up "the outage (no baseline)"
fi

# Outage. docker stop is what Compose does on restart, recreation and daemon shutdown. The proxy
# closes its listener at once and waits up to its grace time of 10 s for the followed log stream,
# which never goes idle, so the daemon may kill it at its stop timeout: 10 s by default on Linux,
# 3 s as measured on Docker Desktop 4.96.
s_pre=$(last_seq "$PROBE")
t_stop=$(daemon_now)
proxy_touched=true
info "stopping $PROXY"
stop_began=$SECONDS
docker stop "$PROXY" >/dev/null || fail "docker stop $PROXY succeeds"
if wait_for 30 stopped "$PROXY"; then
  proxy_down=$(proxy_state)
  pass "$PROXY is stopped"
  info "docker stop took $((SECONDS - stop_began)) s; exit code $(docker inspect -f '{{.State.ExitCode}}' "$PROXY") (0: graceful, 137: killed at Docker's stop timeout)"
else
  fail "$PROXY is stopped (still running after 30 s)"
  give_up "the outage and recovery checks (no outage was produced)"
fi
down_at=$SECONDS
# Up to 10 s: a single probe can take its full 5 s timeout.
wait_for 10 api_unavailable || true
case $api_verdict in
  UNAVAILABLE*) pass "The proxy's API is unavailable from Alloy's network namespace: $api_verdict" ;;
  ANSWERED*)
    fail "The proxy's API is unavailable from Alloy's network namespace (it still answers: $api_verdict)"
    give_up "the outage and recovery checks (no outage was produced)"
    ;;
  *)
    fail "The proxy's API is unavailable from Alloy's network namespace (the probe is broken, so nothing is verified: $api_verdict)"
    give_up "the outage and recovery checks (the outage is not verified)"
    ;;
esac

# The messages are Alloy v1.20.1's. The tailer inspects its container every 5 s and logs a failed
# inspect with the container's ID; discovery logs every failed refresh. Without both, Alloy never
# lost the API, so a recovery cannot be claimed. A version that renames them fails here loudly.
# Every poll also checks that the outage still holds: the proxy as it stopped, and no answer from
# its API where Alloy sends its requests.
info "holding the outage for ${MIN_OUTAGE}-${MAX_OUTAGE} s"
alloy_restarted=false
probe_lost=false
polls=0
unready=0
unavailable=0
proxy_moved=
api_lapse=
while :; do
  polls=$((polls + 1))
  [[ $(state_of alloy) == "$alloy_before" ]] || alloy_restarted=true
  proxy_now=$(proxy_state)
  [[ -n $proxy_moved || $proxy_now == "$proxy_down" ]] || proxy_moved="poll $polls: $proxy_now"
  if api_unavailable; then
    unavailable=$((unavailable + 1))
  elif [[ -z $api_lapse ]]; then
    api_lapse="poll $polls: $api_verdict"
  fi
  ready 127.0.0.1:12345/-/ready >/dev/null 2>&1 || unready=$((unready + 1))
  [[ $(docker inspect -f '{{.State.Running}} {{.State.StartedAt}}' "$PROBE" 2>/dev/null) == "true $probe_started" ]] ||
    probe_lost=true
  outage_log=$(docker logs --since "$t_stop" alloy 2>&1 | tr -d '\r')
  tailer_errors=$(grep -F "$probe_id" <<<"$outage_log" |
    grep -E 'msg="(error inspecting Docker container|could not inspect container info|could not fetch logs for container)"' || true)
  discovery_errors=$(grep -F 'msg="Unable to refresh target groups"' <<<"$outage_log" |
    grep -F 'component_id=discovery.docker.containers' || true)
  held=$((SECONDS - down_at))
  if ((held >= MAX_OUTAGE)) || { ((held >= MIN_OUTAGE)) && [[ -n $tailer_errors && -n $discovery_errors ]]; }; then
    break
  fi
  sleep 2
done
info "the proxy was down for $held s before the start"
if [[ -z $api_lapse ]]; then
  pass "The proxy's API stayed unavailable from Alloy's network namespace at all $polls polls"
else
  fail "The proxy's API stayed unavailable from Alloy's network namespace at all $polls polls (UNAVAILABLE at $unavailable; first other verdict at $api_lapse)"
fi
if $alloy_restarted; then
  fail "Alloy kept running through the outage (it restarted, so a recovery without a restart is not demonstrated)"
else
  pass "Alloy kept running through the outage (same Id, StartedAt and restart count)"
fi
if ((unready)); then
  fail "Alloy reported ready throughout the outage ($unready of $polls polls failed)"
else
  pass "Alloy reported ready throughout the outage ($polls polls)"
fi
# A probe that stopped writes no lines; their absence would not be lost logs.
if $probe_lost; then
  fail "The labelled probe ran throughout the outage"
else
  pass "The labelled probe ran throughout the outage"
fi
if [[ -n $tailer_errors ]]; then
  pass "Alloy's tailer lost the Docker API for the probe ($(grep -c . <<<"$tailer_errors") failed attempt(s))"
  first=$(head -1 <<<"$tailer_errors")
  info "first tailer error $(secs_after "$t_stop" "$first") s after docker stop: $(grep -oE 'msg="[^"]*"' <<<"$first") $(grep -oE ' (err|error)="[^"]*"' <<<"$first" | cut -c2-200)"
else
  fail "Alloy's tailer lost the Docker API for the probe (no failed inspect or fetch with its ID since docker stop)"
fi
if [[ -n $discovery_errors ]]; then
  pass "Alloy's discovery lost the Docker API ($(grep -c . <<<"$discovery_errors") failed refresh(es))"
  first=$(head -1 <<<"$discovery_errors")
  info "first failed refresh $(secs_after "$t_stop" "$first") s after docker stop: $(grep -oE ' (err|error)="[^"]*"' <<<"$first" | cut -c2-200)"
else
  fail "Alloy's discovery lost the Docker API (no failed refresh of discovery.docker.containers since docker stop)"
fi
stream_end=$(grep -F "$probe_id" <<<"$outage_log" | grep -oE 'msg="(could not transfer logs|finished transferring logs)"' |
  head -1 || true)
info "the probe's followed stream ended with: ${stream_end:-no stream-end message}"
s_down=$(last_seq "$PROBE")
info "the probe wrote lines $((s_pre + 1))-$s_down from docker stop to the end of the outage"
# The outage lasts until docker start, so the proxy is compared once more right before it.
proxy_now=$(proxy_state)
[[ -n $proxy_moved || $proxy_now == "$proxy_down" ]] || proxy_moved="right before docker start: $proxy_now"
if [[ -z $proxy_moved ]]; then
  pass "$PROXY stayed stopped throughout the outage: unchanged StartedAt and FinishedAt at all $polls polls and right before docker start"
else
  fail "$PROXY stayed stopped throughout the outage (stopped as '$proxy_down', then $proxy_moved)"
fi
# A recovery after an outage that did not hold the whole time would claim more than was tested.
if [[ -n $proxy_moved || -n $api_lapse ]]; then
  give_up "the recovery checks (the declared outage did not hold)"
fi

# Recovery: the same container starts again. Restarting Alloy is out of bounds here; it must find
# its way back by itself.
t_start=$(daemon_now)
info "starting $PROXY"
start_began=$SECONDS
docker start "$PROXY" >/dev/null || fail "docker start $PROXY succeeds"
if ! wait_for 30 running "$PROXY"; then
  fail "$PROXY runs again (not running after 30 s)"
  give_up "the recovery checks (the proxy did not start)"
fi
# The end check requires this start, and no other, to be the proxy's last.
proxy_started=$(docker inspect -f '{{.State.StartedAt}}' "$PROXY")
if wait_for 60 api_answers; then
  up_at=$SECONDS
  s_up=$(last_seq "$PROBE")
  pass "The proxy's API answers Alloy's address again: HEAD /_ping 200 ($((up_at - start_began)) s after docker start)"
else
  fail "The proxy's API answers Alloy's address again (last answer after 60 s: $api_verdict)"
  give_up "the recovery checks (the API did not come back)"
fi
t_up=$(daemon_now)
if wait_for 60 healthy "$PROXY"; then
  proxy_restored=true
  pass "$PROXY is healthy again ($((SECONDS - start_began)) s after docker start)"
else
  fail "$PROXY is healthy again (not after 60 s)"
  give_up "the recovery checks (the proxy is not healthy)"
fi
info "$PROXY address on $API_NET: $proxy_ip_before before, $(net_ip "$PROXY" "$API_NET" || echo ?) after"

# Lines written after the API answered again, with this run's token, so that neither the lines from
# before the outage nor another run can pass this. The +1 allows for a line written just before
# s_up was read.
name="Alloy resumes the probe's stream: $POST_RECOVERY_LINES lines written after the API was back (seq > $((s_up + 1))) reach Loki"
resumed=false
if wait_for 60 loki_has_after "$token" $((s_up + 1)) "$POST_RECOVERY_LINES"; then
  pass "$name ($((SECONDS - up_at)) s after the API answered)"
  resumed=true
else
  if loki_seqs "$token" >/dev/null; then fail "$name (not within 60 s)"; else fail "$name (Loki did not answer the query with a log result)"; fi
  docker logs --since "$t_up" alloy 2>&1 | tr -d '\r' | grep -F "$probe_id" | head -5 | sed 's/^/     /' || true
fi
docker run -d --name "$LATE_PROBE" --label observability.logs=true --label "observability.app=$PROBE" \
  --entrypoint sh "$client_image" -c "$(writer "$late_token")" >/dev/null
late_began=$SECONDS
if no_mounts "$LATE_PROBE"; then pass "$LATE_PROBE has no volume"; else fail "$LATE_PROBE has no volume"; fi
name="Alloy discovers a container started after the outage: $LATE_PROBE's lines reach Loki"
discovered=false
if wait_for 60 loki_has_after "$late_token" 0 1; then
  pass "$name ($((SECONDS - late_began)) s after it started)"
  discovered=true
else
  fail "$name (not within 60 s)"
  docker logs --since "$t_up" alloy 2>&1 | tr -d '\r' | grep -F 'msg="Unable to refresh target groups"' | head -3 |
    sed 's/^/     /' || true
fi
expect_equal "Alloy did not restart: same Id, StartedAt and restart count as before the outage" \
  "$(state_of alloy)" "$alloy_before"

name="The proxy refused none of Alloy's requests after docker start"
if $resumed && $discovered; then
  refusals=$(docker logs --since "$t_start" "$PROXY" 2>&1 | tr -d '\r' | grep -F 'msg="blocked request"' || true)
  alloy_refusals=$(grep -F "client=$alloy_ip:" <<<"$refusals" | grep -vF "resilience=$run_id" || true)
  if [[ -z $alloy_refusals ]]; then
    pass "$name"
  else
    head -5 <<<"$alloy_refusals" | sed 's/^/     /'
    fail "$name ($(grep -c . <<<"$alloy_refusals") refusal(s), first ones above)"
  fi
else
  echo "skip $name (no proof that Alloy used the proxy after the start)"
fi

# Continuity over the whole run, outage included: Alloy reopens the stream from the last second it
# read, so the lines written meanwhile are read again from Docker's log. This covers this
# controlled outage only. Duplicates of that second are possible and are no failure.
s_end=$(last_seq "$PROBE")
seqs=
missing=
returned=0
answered=false
truncated=false
deadline=$((SECONDS + 30))
while [[ -n $s_end ]]; do
  if result=$(loki_seqs "$token"); then
    answered=true
    seqs=$result
    returned=$(grep -c . <<<"$seqs" || true)
    if ((returned >= LOKI_LIMIT)); then
      truncated=true
      break
    fi
    missing=$(awk -v last="$s_end" '{ seen[$1] = 1 } END { for (i = 1; i <= last; i++) if (!(i in seen)) printf "%d ", i }' <<<"$seqs")
    if [[ -z $missing ]]; then break; fi
  fi
  if ((SECONDS >= deadline)); then break; fi
  sleep 2
done
name="Loki has every line the probe wrote, 1 to ${s_end:-?}, the outage included"
if [[ -z $s_end ]]; then
  fail "$name (no numbered line in docker logs $PROBE)"
elif ! $answered; then
  fail "$name (Loki did not answer the query with a log result)"
elif $truncated; then
  fail "$name (Loki returned $returned lines, the most LOKI_LIMIT allows, so the result may be cut off)"
elif ((s_end < s_up + POST_RECOVERY_LINES)); then
  fail "$name (only $((s_end - s_up)) line(s) after the API was back, too few to judge)"
elif [[ -n $missing ]]; then
  fail "$name (still missing after 30 s: $(cut -d' ' -f1-10 <<<"$missing"))"
else
  pass "$name: no gap in this controlled outage (this run only)"
fi
if [[ -n $seqs ]]; then
  total=$(grep -c . <<<"$seqs" || true)
  unique=$(sort -nu <<<"$seqs" | grep -c . || true)
  info "$((total - unique)) duplicate line(s) of the probe in Loki (reported, never a failure)"
fi

# No cascade. docker start and docker restart reset a container's restart count to 0, so the count
# shows only restarts by the policy, a crash loop for one. A start by hand shows in StartedAt.
expect_equal "The outage restarted none of ${OTHERS[*]}" "$(others_state)" "$others_before"
expect_equal "$PROXY is the same container, last started by this run's docker start, with no restart since" \
  "$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' "$PROXY")" "$proxy_id $proxy_started 0"
expect_equal "Only Alloy and $PROXY are on $API_NET" "$(members_of "$API_NET")" "alloy $PROXY"

finish
