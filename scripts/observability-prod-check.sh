#!/usr/bin/env bash
# Checks the stack's production port policy (docs/OBSERVABILITY.md, Resource limits;
# docs/S4b_DESIGN_CONTRACT.md, sections 5.1 and 8.4).
#
#   static   Renders the stack three ways and checks each render's host port mappings against an
#            exact, pinned set:
#            - P-S1, production (compose.yaml + compose.prod.yaml): only Grafana's 127.0.0.1:3000;
#            - P-S2, development (compose.yaml): the seven development mappings;
#            - P-S3, test runs (+ compose.test.yaml): Grafana's and the five the test scripts use;
#            - P-S6: no service of the three renders uses network_mode: host, which would bypass
#              port publishing.
#
# A mapping is the tuple (service, host IP, host port, container port, protocol). The checks compare
# sets, never a count, so an extra or missing mapping, one on another service, a host IP other than
# 127.0.0.1 (none means every interface), a port range, an ephemeral host port or another protocol
# fails. Compose's mode is not compared: it matters only in Swarm. The sets are pinned on purpose: a
# mapping changed in a Compose file fails here until its set changes with it, in the same commit.
# The script only renders the files; it starts and changes nothing.
set -euo pipefail

BASE=observability/compose.yaml
PROD=observability/compose.prod.yaml
TEST=observability/compose.test.yaml
# As "service host IP:host port->container port/protocol" (docs/S4b_DESIGN_CONTRACT.md, section 5.1).
PROD_PORTS='["grafana 127.0.0.1:3000->3000/tcp"]'
DEV_PORTS='["grafana 127.0.0.1:3000->3000/tcp", "prometheus 127.0.0.1:9090->9090/tcp",
  "loki 127.0.0.1:3100->3100/tcp", "tempo 127.0.0.1:3200->3200/tcp", "tempo 127.0.0.1:4317->4317/tcp",
  "tempo 127.0.0.1:4318->4318/tcp", "alloy 127.0.0.1:12345->12345/tcp"]'
# The development set without Tempo's 4317, which no test script uses.
TEST_PORTS='["grafana 127.0.0.1:3000->3000/tcp", "prometheus 127.0.0.1:9090->9090/tcp",
  "loki 127.0.0.1:3100->3100/tcp", "tempo 127.0.0.1:3200->3200/tcp", "tempo 127.0.0.1:4318->4318/tcp",
  "alloy 127.0.0.1:12345->12345/tcp"]'
failures=()

fatal() {
  echo "FATAL $1" >&2
  exit 1
}
render() {
  local file args=()
  for file in "$@"; do args+=(-f "$file"); done
  docker compose "${args[@]}" config --format json
}
# Runs a jq program that prints one "ok" or "FAIL" line per check, prints them and records the
# FAILs. A jq error, or no output at all, is fatal, so no check passes without having run.
judge() {
  local out line
  out=$(jq -r "$@") || fatal "jq failed"
  [[ -n $out ]] || fatal "jq printed nothing"
  while IFS= read -r line; do
    echo "$line"
    if [[ $line == FAIL* ]]; then failures+=("${line#FAIL }"); fi
  done <<<"$out"
}
finish() {
  if ((${#failures[@]})); then
    echo "${#failures[@]} check(s) failed:" >&2
    printf '  %s\n' "${failures[@]}" >&2
    exit 1
  fi
  echo "All checks passed"
}

# Compares a render's host port mappings with an expected set. An unexpected mapping is listed with
# what makes it one besides not being expected.
check_ports() {
  judge --arg id "$1" --arg name "$2" --argjson expected "$3" '
    def host_ip: if (.host_ip // "") == "" then "<every interface>" else .host_ip end;
    def mapping($s): "\($s) \(host_ip):\(.published // "<ephemeral>")->\(.target)/\(.protocol // "<none>")";
    def faults:
      [ if .host_ip != "127.0.0.1" then "host IP \(host_ip)" else empty end,
        if .published == null then "an ephemeral host port"
        elif (.published | tostring | test("-")) then "a host port range"
        else empty end,
        if .protocol != "tcp" then "protocol \(.protocol // "<none>")" else empty end
      ] | join(", ");
    [.services // {} | to_entries[] | .key as $s | (.value.ports // [])[]
      | {mapping: mapping($s), faults: faults}] as $found
    | ($found | map(.mapping)) as $got
    | ($expected - $got) as $missing
    | [$found[] | select(.mapping | IN($expected[]) | not)
        | if .faults == "" then .mapping else "\(.mapping) (\(.faults))" end] as $extra
    | [$got | group_by(.)[] | select(length > 1) | .[0]] as $twice
    | if (.services // {} | length) == 0 then "FAIL \($id) \($name): the render has no service"
      elif ($missing + $extra + $twice | length) == 0
      then "ok   \($id) \($name): exactly the \($expected | length) expected mapping(s): \($expected | join(", "))"
      else "FAIL \($id) \($name): " + ([
          if ($missing | length) > 0 then "missing \($missing | join(", "))" else empty end,
          if ($extra | length) > 0 then "unexpected \($extra | join(", "))" else empty end,
          if ($twice | length) > 0 then "listed more than once \($twice | join(", "))" else empty end
        ] | join("; ")) end' <<<"$4"
}

check_network_mode() {
  judge --arg name "$1" '
    [.services // {} | to_entries[] | select(.value.network_mode == "host") | .key] as $host
    | if (.services // {} | length) == 0 then "FAIL P-S6 \($name): the render has no service"
      elif ($host | length) == 0
      then "ok   P-S6 \($name): no service uses network_mode: host (\(.services | length) services)"
      else "FAIL P-S6 \($name): network_mode host on \($host | join(", "))" end' <<<"$2"
}

run_static() {
  local base prod test_runs
  base=$(render "$BASE") || fatal "$BASE does not render"
  prod=$(render "$BASE" "$PROD") || fatal "$BASE $PROD do not render"
  test_runs=$(render "$BASE" "$PROD" "$TEST") || fatal "$BASE $PROD $TEST do not render"

  echo "== host port mappings, as service host IP:host port->container port/protocol"
  check_ports P-S1 "production ($BASE + $PROD)" "$PROD_PORTS" "$prod"
  check_ports P-S2 "development ($BASE)" "$DEV_PORTS" "$base"
  check_ports P-S3 "test runs ($BASE + $PROD + $TEST)" "$TEST_PORTS" "$test_runs"

  echo "== the host network"
  check_network_mode "production" "$prod"
  check_network_mode "development" "$base"
  check_network_mode "test runs" "$test_runs"
}

command -v jq >/dev/null || fatal "jq is not installed"
command -v docker >/dev/null || fatal "docker is not installed"
case ${1-} in
  static) run_static ;;
  *) fatal "usage: $0 static" ;;
esac
finish
