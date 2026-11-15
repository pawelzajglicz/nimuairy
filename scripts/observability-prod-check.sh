#!/usr/bin/env bash
# Checks the stack's production port policy and Grafana's production password (docs/OBSERVABILITY.md,
# Resource limits; docs/S4b_DESIGN_CONTRACT.md, sections 5.1, 6 and 8.4).
#
#   static   Renders the stack three ways and checks the renders:
#            - P-S1, production (compose.yaml + compose.prod.yaml): only Grafana's 127.0.0.1:3000;
#            - P-S2, development (compose.yaml): the seven development mappings;
#            - P-S3, test runs (+ compose.test.yaml): Grafana's and the five the test scripts use;
#            - P-S4, production: Grafana's environment is the development one without
#              GF_SECURITY_ADMIN_PASSWORD and with GF_SECURITY_ADMIN_PASSWORD__FILE, anonymous
#              access and sign-up stay off, Grafana mounts exactly the one secret, the top-level
#              secrets hold exactly that one, from observability/secrets/, and Grafana's entrypoint
#              is the start guard;
#            - P-S5, development: no secret and no start guard, so it needs no secret file, and
#              Grafana keeps admin/admin;
#            - P-S6: no service of the three renders uses network_mode: host, which would bypass
#              port publishing.
#   runtime  Checks the running stack, which must come from exactly compose.yaml + compose.prod.yaml:
#            in CI after phase B's recreate, and on the VPS from S6, each run there with separate
#            consent. Never with compose.test.yaml up: its five mappings fail P-R1 and P-R2 by design.
#            - P-R1: the host port bindings of the stack's containers, in HostConfig.PortBindings and
#              in docker port, are each exactly P-S1's set, and no container uses the host network;
#            - P-R2: on the host, 127.0.0.1 refuses a connection on each development port that
#              production removes, and Grafana's 127.0.0.1:3000/api/health answers 200;
#            - P-R3: Grafana's Config.Env has no GF_SECURITY_ADMIN_PASSWORD and has its __FILE
#              variable;
#            - P-R4: Grafana accepts the configured login and refuses admin:admin, an anonymous API
#              request and sign-up, each with the status and the message pinned below.
#   seed STATE    CI phase A only, with compose.test.yaml up: sends Tempo a trace with a new ID, reads
#            it back through Grafana's Tempo datasource, waits until Tempo's WAL has new content, and
#            writes the trace and the Tempo and Grafana containers and volumes to the file STATE.
#   verify STATE  CI phase B only, after the recreate, P-V1: Tempo and Grafana are new containers on
#            the volumes STATE names, Grafana's datasources answer OK with the configured login, the
#            seeded trace is still found, and Tempo's storage belongs to 10001:10001.
#
# A mapping is the tuple (service, host IP, host port, container port, protocol). The checks compare
# sets, never a count, so an extra or missing mapping, one on another service, a host IP other than
# 127.0.0.1 (none means every interface), a port range, an ephemeral host port or another protocol
# fails. Compose's mode is not compared: it matters only in Swarm. The sets are pinned on purpose: a
# mapping changed in a Compose file fails here until its set changes with it, in the same commit.
# The same holds for Grafana's secret and start guard. The Grafana checks name variables, never
# their values, so a password set by mistake does not reach the output.
#
# static needs jq and only renders the files. runtime, seed and verify need no jq, which the VPS is
# not assumed to have (docs/S4b_DESIGN_CONTRACT.md, B8): runtime uses bash, docker, curl and
# coreutils' timeout and od; seed and verify, for CI only, also date, sleep, mv and rm. They find the
# stack's containers through its Compose project, never by container_name. OBSERVABILITY_COMPOSE_FILES
# (space-separated, from the repository root) replaces compose.yaml and compose.prod.yaml, as in the
# limits check, for a copy of the stack under another project name; the pinned sets stay the same.
# The Grafana login is GRAFANA_AUTH (user:password), or else admin and the secret file next to the
# first file; there is no default, and the user must be admin. curl gets it on stdin, never as an
# argument, and nothing prints it.
# runtime starts and changes nothing. seed and verify start short-lived probes that only read Tempo's
# volume, without network or capabilities; on exit they remove their own, found by this run's label.
set -euo pipefail
# Git Bash would otherwise rewrite the /run/secrets path it passes to jq, and the probes' container
# paths, into Windows paths.
export MSYS_NO_PATHCONV=1

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
GRAFANA_SECRET=grafana_admin_password
GRAFANA_SECRET_TARGET=/run/secrets/grafana_admin_password
# The start guard (docs/S4b_DESIGN_CONTRACT.md, section 6.3) as the container receives it. The
# render escapes each $ as $$, as the overlay does, so the check unescapes it first.
GRAFANA_GUARD='f=/run/secrets/grafana_admin_password
if [ ! -f "$f" ] || [ ! -r "$f" ] || [ ! -s "$f" ]; then echo "FATAL: $f is missing, not a regular file, unreadable or empty" >&2; exit 1; fi
if [ "$(< "$f")" = admin ]; then echo "FATAL: $f holds the development password" >&2; exit 1; fi
exec /run.sh "$@"
'
# runtime, seed and verify.
read -ra FILES <<<"${OBSERVABILITY_COMPOSE_FILES:-$BASE $PROD}"
# P-S1's one mapping, Grafana's: the only host port production publishes.
GRAFANA_URL=http://127.0.0.1:3000
# The test overlay's OTLP/HTTP port. seed runs only while it is up.
OTLP_URL=http://127.0.0.1:4318/v1/traces
# Grafana's Tempo datasource (observability/grafana/provisioning/datasources/datasources.yml). Once
# production has removed Tempo's host ports, Grafana's datasource proxy reaches its API from the host.
TEMPO_VIA_GRAFANA=/api/datasources/proxy/uid/tempo
TEMPO_USER=10001:10001
# The live store's WAL, Tempo 3.1's first write of an accepted trace (the smoke test's T-3).
TEMPO_WAL=/var/tempo/live-store/traces
# P-R4's refusals as Grafana 13.0.2 words them (S4b.2, PR #120). An update that rewords one fails
# here until it changes too.
MESSAGE_BAD_LOGIN='Invalid username or password'
MESSAGE_ANONYMOUS='Unauthorized'
MESSAGE_NO_SIGN_UP='User signup is disabled'
PROBE=observability-prod-check
RUN_LABEL=$PROBE.run
# What seed hands to verify, in this order, each with the only form verify accepts. The file is
# parsed, never sourced, and holds no secret.
TIMESTAMP='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$'
VOLUME_NAME='^[A-Za-z0-9][A-Za-z0-9_.-]*$'
STATE_KEYS=(trace_id marker tempo_container grafana_container tempo_volume tempo_volume_created
  grafana_volume grafana_volume_created)
declare -A STATE_FORMAT=(
  [trace_id]='^[0-9a-f]{32}$'
  [marker]="^$PROBE-[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9a-f]{8}\$"
  [tempo_container]='^[0-9a-f]{64}$'
  [grafana_container]='^[0-9a-f]{64}$'
  [tempo_volume]=$VOLUME_NAME
  [tempo_volume_created]=$TIMESTAMP
  [grafana_volume]=$VOLUME_NAME
  [grafana_volume_created]=$TIMESTAMP
)
declare -A STATE=() CONTAINER=() SERVICE_OF=() WAL_BEFORE=()
STACK_IDS=()
WAL=()
PROBES=0
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
pass() { echo "ok   $1"; }
fail() {
  echo "FAIL $1"
  failures+=("$1")
}
info() { echo "info $1"; }
need() {
  local command
  for command in "$@"; do command -v "$command" >/dev/null || fatal "$command is not installed"; done
}
# The items after the first argument as one string, joined by the first argument.
joined() {
  local separator=$1 out
  shift
  printf -v out "%s$separator" "$@"
  printf '%s' "${out%"$separator"}"
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

# Compose resolves the secret's relative file against the project directory, the base file's, and
# renders it as an absolute path, on Windows with backslashes.
expected_secret_file() {
  local dir
  dir=$(cd "${BASE%/*}" && pwd) || fatal "cannot resolve ${BASE%/*}"
  if command -v cygpath >/dev/null; then dir=$(cygpath -m "$dir"); fi
  echo "$dir/secrets/$GRAFANA_SECRET"
}

# Runs one P-S4 check, a jq expression over Grafana in the base render ($bg) and in the production
# render ($pg) that prints one line. $secret, $target, $file and $guard hold the expected values.
check_grafana() {
  judge -n --arg secret "$GRAFANA_SECRET" --arg target "$GRAFANA_SECRET_TARGET" --arg file "$3" \
    --arg guard "$GRAFANA_GUARD" '
    input as $base | input as $prod
    | ($base.services.grafana // null) as $bg | ($prod.services.grafana // null) as $pg
    | if $bg == null or $pg == null then "FAIL P-S4: Grafana is missing from the base or the production render"
      else '"$4"' end' <<<"$1"$'\n'"$2"
}

check_grafana_production() {
  local file
  file=$(expected_secret_file)
  # Exactly two differences from the base render. The base file's admin must be there to remove.
  check_grafana "$1" "$2" "$file" '
    ($bg.environment // {}) as $be | ($pg.environment // {}) as $pe
    | ($be | del(.GF_SECURITY_ADMIN_PASSWORD) + {GF_SECURITY_ADMIN_PASSWORD__FILE: $target}) as $want
    | ([$want, $pe] | map(keys[]) | unique) as $names
    | [ ($names[] as $n | select(($pe | has($n)) and ($want | has($n) | not)) | "unexpected \($n)"),
        ($names[] as $n | select(($want | has($n)) and ($pe | has($n) | not)) | "missing \($n)"),
        ($names[] as $n | select(($want | has($n)) and ($pe | has($n)) and $want[$n] != $pe[$n]) | "changed \($n)")
      ] as $diff
    | if ($be | has("GF_SECURITY_ADMIN_PASSWORD") | not)
      then "FAIL P-S4 environment: the base render has no GF_SECURITY_ADMIN_PASSWORD for the overlay to remove"
      elif ($diff | length) == 0
      then "ok   P-S4 environment: the base render'"'"'s without GF_SECURITY_ADMIN_PASSWORD and with GF_SECURITY_ADMIN_PASSWORD__FILE=\($target) (\($pe | length) variables)"
      else "FAIL P-S4 environment: expected the base render'"'"'s without GF_SECURITY_ADMIN_PASSWORD and with GF_SECURITY_ADMIN_PASSWORD__FILE=\($target); \($diff | join(", "))" end'
  # Pinned here too: equality with the base render would pass if the base file turned them on.
  check_grafana "$1" "$2" "$file" '
    [("GF_AUTH_ANONYMOUS_ENABLED", "GF_USERS_ALLOW_SIGN_UP") | select($pg.environment[.] != "false")] as $on
    | if ($on | length) == 0
      then "ok   P-S4 anonymous access and sign-up: GF_AUTH_ANONYMOUS_ENABLED and GF_USERS_ALLOW_SIGN_UP are \"false\""
      else "FAIL P-S4 anonymous access and sign-up: \($on | map("\(.) is not \"false\"") | join(", "))" end'
  # Without a target, Compose mounts a secret at /run/secrets/<source>.
  check_grafana "$1" "$2" "$file" '
    def entry: if type == "object"
      then "\(.source // "<no source>") at \(.target // "<the default target>")"
        + (((keys - ["source", "target"]) | join(", ")) | if . == "" then "" else " with \(.)" end)
      else tostring end;
    ($pg.secrets // []) as $s
    | if ($s | length) == 1 and ($s[0] | type) == "object" and (($s[0] | keys) - ["source", "target"]) == []
         and $s[0].source == $secret and ($s[0].target // "/run/secrets/\($secret)") == $target
      then "ok   P-S4 secrets: Grafana mounts exactly \($secret) at \($target)"
      else "FAIL P-S4 secrets: expected exactly \($secret) at \($target), got \($s | map(entry) | join(", ") | if . == "" then "none" else . end)" end'
  # Compose adds the secret's name; the file must be its only source.
  check_grafana "$1" "$2" "$file" '
    ($prod.secrets // {}) as $ts | ($ts[$secret] // {}) as $t
    | if ($ts | keys) != [$secret]
      then "FAIL P-S4 top-level secrets: expected exactly \($secret), got \($ts | keys | join(", ") | if . == "" then "none" else . end)"
      elif (($t | keys) - ["name"]) != ["file"]
      then "FAIL P-S4 top-level secrets: \($secret) must come from a file only, it has \(($t | keys) - ["name"] | join(", "))"
      elif ($t.file | gsub("\\\\"; "/")) != $file
      then "FAIL P-S4 top-level secrets: \($secret) is the file \($t.file), expected \($file)"
      else "ok   P-S4 top-level secrets: exactly \($secret), from the file \($file)" end'
  check_grafana "$1" "$2" "$file" '
    ["/bin/bash", "-c", $guard, "run.sh"] as $want
    | ($pg.entrypoint // null) as $e
    | if $e == null then "FAIL P-S4 entrypoint: Grafana has none, so no start guard"
      elif ($e | type) != "array" then "FAIL P-S4 entrypoint: not a list"
      else ($e | map(if type == "string" then gsub("\\$\\$"; "$") else . end)) as $got
        | if $got == $want
          then "ok   P-S4 entrypoint: the start guard, /bin/bash -c <guard> run.sh, as the container receives it"
          else "FAIL P-S4 entrypoint: not the start guard; element(s) \([range(0; [($got | length), 4] | max) | select($got[.] != $want[.]) | tostring] | join(", ")) differ" end
      end'
}

# The development credentials are pinned too, so the base file keeps admin/admin
# (docs/S4b_DESIGN_CONTRACT.md, section 8.4). Mismatches are named, not their values.
check_development_needs_no_secret() {
  judge '
    (.services.grafana // null) as $g
    | [ if (.secrets // {} | length) > 0 then "top-level secrets \(.secrets | keys | join(", "))" else empty end,
        if $g == null then "no grafana service"
        else (if ($g.environment // {} | has("GF_SECURITY_ADMIN_PASSWORD__FILE")) then "Grafana has GF_SECURITY_ADMIN_PASSWORD__FILE" else empty end),
          (if ($g.secrets // [] | length) > 0 then "Grafana mounts secrets" else empty end),
          (if $g.entrypoint != null then "Grafana sets an entrypoint" else empty end),
          (("GF_SECURITY_ADMIN_USER", "GF_SECURITY_ADMIN_PASSWORD") as $n
            | select(($g.environment // {})[$n] != "admin") | "\($n) is not admin")
        end
      ] as $problems
    | if ($problems | length) == 0
      then "ok   P-S5 development: no top-level secret, and Grafana has no GF_SECURITY_ADMIN_PASSWORD__FILE, no secret and no entrypoint (so the image runs /run.sh without the start guard); it needs no secret file and keeps GF_SECURITY_ADMIN_USER and GF_SECURITY_ADMIN_PASSWORD admin"
      else "FAIL P-S5 development: \($problems | join("; "))" end' <<<"$1"
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

  echo "== Grafana's password: the production secret (P-S4), none in development (P-S5)"
  check_grafana_production "$base" "$prod"
  check_development_needs_no_secret "$base"

  echo "== the host network"
  check_network_mode "production" "$prod"
  check_network_mode "development" "$base"
  check_network_mode "test runs" "$test_runs"
}

compose() {
  local file args=()
  for file in "${FILES[@]}"; do args+=(-f "$file"); done
  docker compose "${args[@]}" "$@"
}

# The strings of a JSON array of strings such as PROD_PORTS, one per line, without jq.
json_strings() {
  local rest=$1 re='"([^"]*)"'
  while [[ $rest =~ $re ]]; do
    printf '%s\n' "${BASH_REMATCH[1]}"
    rest=${rest#*"${BASH_REMATCH[0]}"}
  done
}

random_hex() {
  local hex
  hex=$(od -An -N"$1" -tx1 /dev/urandom) || fatal "cannot read /dev/urandom"
  hex=${hex//[!0-9a-f]/}
  ((${#hex} == $1 * 2)) || fatal "od gave no $1 random bytes"
  printf '%s' "$hex"
}

# The stack's containers as Compose finds them through its project: orphans, stopped and one-off
# containers included, never by container_name. Fills CONTAINER (service -> ID), SERVICE_OF and
# STACK_IDS, and checks that each service of the render has exactly one container, running, and that
# the project has no other: a missing container would otherwise shrink the sets checked below.
discover() {
  local out id svc state services=() ids=() problems=()
  local -A wanted=() count=()
  out=$(compose config --services) || fatal "${FILES[*]} do not render"
  mapfile -t services <<<"$out"
  for svc in "${services[@]}"; do if [[ -n $svc ]]; then wanted[$svc]=1; fi; done
  ((${#wanted[@]})) || fatal "the render of ${FILES[*]} has no service"
  out=$(compose ps -a -q) || fatal "docker compose ps failed"
  [[ -n $out ]] || fatal "the stack has no container; start it with ${FILES[*]}"
  mapfile -t ids <<<"$out"
  out=$(docker inspect -f '{{.Id}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Status}}' \
    "${ids[@]}") || fatal "docker inspect of the stack's containers failed"
  while IFS='|' read -r id svc state; do
    [[ -n $id ]] || continue
    [[ -n $svc ]] || svc='<no service label>'
    STACK_IDS+=("$id")
    SERVICE_OF[$id]=$svc
    CONTAINER[$svc]=$id
    count[$svc]=$((${count[$svc]-0} + 1))
    if [[ -z ${wanted[$svc]-} ]]; then
      problems+=("container ${id:0:12} of service $svc, which ${FILES[*]} do not have")
    elif [[ $state != running ]]; then
      problems+=("$svc is $state")
    fi
  done <<<"$out"
  for svc in "${services[@]}"; do
    case ${count[$svc]-0} in
      1) ;;
      0) problems+=("$svc has no container") ;;
      *) problems+=("$svc has ${count[$svc]} containers") ;;
    esac
  done
  if ((${#problems[@]})); then
    fail "the stack: $(joined '; ' "${problems[@]}")"
    return 1
  fi
  pass "the stack: exactly one running container for each of the ${#services[@]} services of ${FILES[*]}, and no other"
}

# A binding written as the static checks write a mapping: service host IP:host port->port/protocol.
mapping() { printf '%s %s:%s->%s\n' "$1" "${3:-<every interface>}" "${4:-<ephemeral>}" "$2"; }

# Compares mappings, one per line, with P-S1's set, as a multiset: an entry found twice fails too.
compare_with_production() {
  local name=$1 entry n expected=() missing=() extra=() twice=() problems=()
  local -A want=() have=()
  mapfile -t expected < <(json_strings "$PROD_PORTS")
  for entry in "${expected[@]}"; do want[$entry]=1; done
  while IFS= read -r entry; do
    if [[ -n $entry ]]; then have[$entry]=$((${have[$entry]-0} + 1)); fi
  done <<<"$2"
  for entry in "${expected[@]}"; do
    if [[ -z ${have[$entry]-} ]]; then missing+=("$entry"); fi
  done
  for entry in "${!have[@]}"; do
    n=${have[$entry]}
    if [[ -z ${want[$entry]-} ]]; then
      extra+=("$entry")
    elif ((n > 1)); then
      twice+=("$entry")
    fi
  done
  if ((${#missing[@]})); then problems+=("missing $(joined ', ' "${missing[@]}")"); fi
  if ((${#extra[@]})); then problems+=("unexpected $(joined ', ' "${extra[@]}")"); fi
  if ((${#twice[@]})); then problems+=("listed more than once $(joined ', ' "${twice[@]}")"); fi
  if ((${#problems[@]})); then
    fail "$name: $(joined '; ' "${problems[@]}")"
  else
    pass "$name: exactly the ${#expected[@]} expected mapping(s): $(joined ', ' "${expected[@]}")"
  fi
}

# P-R1. HostConfig.PortBindings is what Compose asked Docker to publish; docker port is what Docker
# published, from the container's network settings. Both must be P-S1's set.
check_bindings() {
  local out id svc port ip host_port line host bindings='' published='' on_host=() modes=()
  if out=$(docker inspect -f '{{$s := index .Config.Labels "com.docker.compose.service"}}
    {{- range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{$s}}|{{$p}}|{{.HostIp}}|{{.HostPort}}{{println}}{{end}}{{end}}' \
    "${STACK_IDS[@]}"); then
    # A | between the fields keeps an empty host IP in its place; read would collapse spaces.
    while IFS='|' read -r svc port ip host_port; do
      if [[ -n $svc ]]; then bindings+=$(mapping "$svc" "$port" "$ip" "$host_port")$'\n'; fi
    done <<<"$out"
    compare_with_production "P-R1 HostConfig.PortBindings of the stack's ${#STACK_IDS[@]} containers" "$bindings"
  else
    fail "P-R1 HostConfig.PortBindings: docker inspect failed"
  fi
  for id in "${STACK_IDS[@]}"; do
    if ! out=$(docker port "$id"); then
      published+="${SERVICE_OF[$id]} <docker port failed>"$'\n'
      continue
    fi
    # Lines such as "3000/tcp -> 127.0.0.1:3000" or "3000/tcp -> [::]:3000".
    while IFS= read -r line; do
      [[ -n $line ]] || continue
      host=${line#* -> }
      ip=${host%:*}
      ip=${ip#\[}
      ip=${ip%\]}
      published+=$(mapping "${SERVICE_OF[$id]}" "${line%% -> *}" "$ip" "${host##*:}")$'\n'
    done <<<"$out"
  done
  compare_with_production "P-R1 docker port of the stack's ${#STACK_IDS[@]} containers" "$published"
  if ! out=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}|{{.HostConfig.NetworkMode}}' \
    "${STACK_IDS[@]}"); then
    fail "P-R1 network mode: docker inspect failed"
    return 0
  fi
  while IFS='|' read -r svc line; do
    [[ -n $svc ]] || continue
    modes+=("$svc $line")
    if [[ $line == host ]]; then on_host+=("$svc"); fi
  done <<<"$out"
  if ((${#on_host[@]})); then
    fail "P-R1 network mode: host on $(joined ', ' "${on_host[@]}"), which bypasses port publishing"
  else
    pass "P-R1 network mode: no container uses the host network ($(joined ', ' "${modes[@]}"))"
  fi
}

# One TCP connection by bash itself, bounded by timeout: on a failure bash prints libc's text for the
# errno, which no curl version changes (curl's exit code 7 covers every failed connect, and its
# message differs between versions). Prints connected, refused, or what else happened.
tcp_connect() {
  local out status=0
  out=$(timeout 5 bash -c 'exec 3<>"/dev/tcp/$1/$2"' tcp-connect "$1" "$2" 2>&1) || status=$?
  if ((status == 0)); then
    echo connected
  elif ((status == 124)); then
    echo "no answer within 5 s"
  elif ((status == 1)) && [[ $out == *': Connection refused'* ]]; then
    echo refused
  else
    echo "exit $status: ${out//$'\n'/ | }"
  fi
}

# P-R2, from the host. Only ECONNREFUSED passes for a removed port: a timeout or another error proves
# nothing. The positive controls show that the method sees a listener, and that Grafana answers.
check_connections() {
  local entry host result status out local_address production=() removed=() listening=()
  local -A in_production=()
  mapfile -t production < <(json_strings "$PROD_PORTS")
  for entry in "${production[@]}"; do in_production[$entry]=1; done
  while IFS= read -r entry; do
    if [[ -z ${in_production[$entry]-} ]]; then removed+=("$entry"); fi
  done < <(json_strings "$DEV_PORTS")
  ((${#removed[@]})) || fatal "DEV_PORTS has no mapping that production removes"
  for entry in "${removed[@]}"; do
    host=${entry#* }
    host=${host%%->*}
    result=$(tcp_connect "${host%:*}" "${host##*:}")
    if [[ $result == refused ]]; then
      pass "P-R2 $host refuses a connection (${entry%% *}'s development port, removed in production)"
    else
      fail "P-R2 $host: $result, expected Connection refused (${entry%% *}'s development port, removed in production)"
    fi
  done
  for entry in "${production[@]}"; do
    host=${entry#* }
    host=${host%%->*}
    result=$(tcp_connect "${host%:*}" "${host##*:}")
    if [[ $result == connected ]]; then
      pass "P-R2 positive control: $host accepts a connection, so this method sees a listener"
    else
      fail "P-R2 positive control: $host: $result, expected a connection"
    fi
  done
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$GRAFANA_URL/api/health" </dev/null) || true
  if [[ $status == 200 ]]; then
    pass "P-R2 positive control: $GRAFANA_URL/api/health answers 200"
  else
    fail "P-R2 positive control: $GRAFANA_URL/api/health answers ${status:-nothing}, expected 200"
  fi
  # What listens depends on Docker's userland proxy, so this is information only.
  if command -v ss >/dev/null && out=$(ss -Hltn 2>/dev/null); then
    # ss -Hltn columns: state, Recv-Q, Send-Q, local address:port, peer.
    while read -r _ _ _ local_address _; do
      for entry in "${removed[@]}" "${production[@]}"; do
        host=${entry#* }
        host=${host%%->*}
        if [[ $local_address == *":${host##*:}" ]]; then listening+=("$local_address"); fi
      done
    done <<<"$out"
    if ((${#listening[@]})); then
      info "P-R2 ss: listeners on these ports: $(joined ', ' "${listening[@]}")"
    else
      info "P-R2 ss: no listener on these ports"
    fi
  else
    info "P-R2 ss is not available, so no listener list"
  fi
}

# P-R3. Read by name only: if the password were in Config.Env by mistake, nothing prints it, and the
# loop splits the variable without a here-string, which older bash would write to a temporary file.
check_grafana_env() {
  local env rest line plain=0 file=0 other=0
  if ! env=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1"); then
    fail "P-R3 Grafana's Config.Env: docker inspect failed"
    return 0
  fi
  rest=$env$'\n'
  while [[ -n $rest ]]; do
    line=${rest%%$'\n'*}
    rest=${rest#*$'\n'}
    case $line in
      GF_SECURITY_ADMIN_PASSWORD=*) plain=$((plain + 1)) ;;
      "GF_SECURITY_ADMIN_PASSWORD__FILE=$GRAFANA_SECRET_TARGET") file=$((file + 1)) ;;
      GF_SECURITY_ADMIN_PASSWORD__FILE=*) other=$((other + 1)) ;;
    esac
  done
  if ((plain == 0 && file == 1 && other == 0)); then
    pass "P-R3 Grafana's Config.Env: no GF_SECURITY_ADMIN_PASSWORD, and GF_SECURITY_ADMIN_PASSWORD__FILE=$GRAFANA_SECRET_TARGET once"
  else
    fail "P-R3 Grafana's Config.Env: GF_SECURITY_ADMIN_PASSWORD $plain time(s), expected none; GF_SECURITY_ADMIN_PASSWORD__FILE=$GRAFANA_SECRET_TARGET $file time(s), expected once; GF_SECURITY_ADMIN_PASSWORD__FILE with another value $other time(s), expected none"
  fi
}

# Escapes \ and " for a quoted string in a curl config file, one character at a time: the
# replacement rules of ${var//pattern/string} differ between bash versions. Sets the variable named $1.
escape_for_curl() {
  local s=$2 out='' c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case $c in
      \\ | \") out+="\\$c" ;;
      *) out+=$c ;;
    esac
  done
  printf -v "$1" '%s' "$out"
}

# The Grafana login: GRAFANA_AUTH, as CI exports it, or else admin and the secret file that the
# production overlay mounts. $(< file) drops trailing newlines as the image's /run.sh does, so this is
# the value Grafana got. There is no default: admin:admin must never pass as the configured login.
load_credentials() {
  local dir=. file
  if [[ -n ${GRAFANA_AUTH-} ]]; then
    [[ $GRAFANA_AUTH == *:* ]] || fatal "GRAFANA_AUTH is not user:password"
    GRAFANA_USER=${GRAFANA_AUTH%%:*}
    GRAFANA_PASSWORD=${GRAFANA_AUTH#*:}
    CREDENTIALS_FROM=GRAFANA_AUTH
  else
    if [[ ${FILES[0]} == */* ]]; then dir=${FILES[0]%/*}; fi
    file=$dir/secrets/$GRAFANA_SECRET
    [[ -f $file && -r $file ]] || fatal "GRAFANA_AUTH is not set, and $file is not a readable file"
    GRAFANA_USER='admin'
    GRAFANA_PASSWORD=$(<"$file")
    CREDENTIALS_FROM=$file
  fi
  # Child processes need it no longer: curl gets it on stdin.
  unset GRAFANA_AUTH
  [[ -n $GRAFANA_USER && -n $GRAFANA_PASSWORD ]] || fatal "the Grafana user or password from $CREDENTIALS_FROM is empty"
  [[ $GRAFANA_USER$GRAFANA_PASSWORD != *[$'\n\r']* ]] || fatal "the Grafana login from $CREDENTIALS_FROM has more than one line"
  # P-R4 and P-V1 check the admin's password, and the admin keeps the name admin
  # (docs/S4b_DESIGN_CONTRACT.md, section 6.4), not another user's. The name is not printed: in a
  # GRAFANA_AUTH with its parts swapped, it would be the password.
  [[ $GRAFANA_USER == admin ]] || fatal "the Grafana user from $CREDENTIALS_FROM is not admin, the production admin user"
  # P-R4 expects admin:admin to be refused, so the configured password must not be admin.
  [[ $GRAFANA_PASSWORD != admin ]] || fatal "the Grafana password from $CREDENTIALS_FROM is the development one, admin"
}

# One request to Grafana. Prints the body, then a line with the HTTP status (000 without an answer).
# A login goes to curl on stdin as a config file (-K -): printf is a bash builtin, so it is in no
# process's arguments, and the pipe needs no file. $1: configured, admin (the development login, which
# must be refused) or none.
grafana_request() {
  local login=$1 method=$2 path=$3 data=${4-} user password args=(-sS --max-time 10 -w '\n%{http_code}')
  if [[ $method != GET ]]; then args+=(-X "$method"); fi
  if [[ -n $data ]]; then args+=(-H 'Content-Type: application/json' --data-binary "$data"); fi
  case $login in
    none)
      curl "${args[@]}" "$GRAFANA_URL$path" </dev/null
      return
      ;;
    configured)
      escape_for_curl user "$GRAFANA_USER"
      escape_for_curl password "$GRAFANA_PASSWORD"
      ;;
    admin) user=admin password=admin ;;
    *) fatal "grafana_request: unknown login $login" ;;
  esac
  printf 'user = "%s:%s"\n' "$user" "$password" | curl -K - "${args[@]}" "$GRAFANA_URL$path"
}

# One P-R4 check: the status, and for a refusal Grafana's JSON message. Never prints a body.
expect_grafana() {
  local name=$1 login=$2 method=$3 path=$4 data=$5 status=$6 message=$7 response got body
  response=$(grafana_request "$login" "$method" "$path" "$data") || true
  got=${response##*$'\n'}
  body=${response%$'\n'*}
  if [[ $got != "$status" ]]; then
    fail "$name: HTTP ${got:-nothing}, expected $status"
  elif [[ -n $message && $body != *"\"message\":\"$message\""* ]]; then
    fail "$name: HTTP $got without the message \"$message\""
  else
    pass "$name: HTTP $got${message:+, \"$message\"}"
  fi
}

# P-R4. The configured login goes first: one admin:admin failure per run stays far below Grafana's
# limit on failed logins. The sign-up bodies are valid; the dummy password is random, so no fixed
# login could come about even if sign-up were open.
check_grafana_auth() {
  local email=observability-prod-check@example.invalid dummy
  dummy=$(random_hex 16)
  expect_grafana "P-R4 the configured login ($GRAFANA_USER, from $CREDENTIALS_FROM) on GET /api/user" \
    configured GET /api/user '' 200 ''
  expect_grafana "P-R4 admin:admin on GET /api/user" admin GET /api/user '' 401 "$MESSAGE_BAD_LOGIN"
  expect_grafana "P-R4 anonymous GET /api/datasources" none GET /api/datasources '' 401 "$MESSAGE_ANONYMOUS"
  expect_grafana "P-R4 anonymous POST /api/user/signup" none POST /api/user/signup \
    "{\"email\":\"$email\"}" 401 "$MESSAGE_NO_SIGN_UP"
  expect_grafana "P-R4 anonymous POST /api/user/signup/step2" none POST /api/user/signup/step2 \
    "{\"email\":\"$email\",\"username\":\"$PROBE\",\"password\":\"$dummy\",\"code\":\"$PROBE\"}" 401 \
    "$MESSAGE_NO_SIGN_UP"
}

run_runtime() {
  load_credentials
  echo "== the running stack: ${FILES[*]}"
  discover || true
  [[ -n ${CONTAINER[grafana]-} ]] || fatal "the stack has no grafana container"
  echo "== P-R1 host port bindings, as service host IP:host port->container port/protocol"
  check_bindings
  echo "== P-R2 connections from the host"
  check_connections
  echo "== P-R3 Grafana's environment"
  check_grafana_env "${CONTAINER[grafana]}"
  echo "== P-R4 Grafana's authentication"
  check_grafana_auth
}

# The named volume mounted at $2 in container $1 and its creation time, as "name created".
volume_at() {
  local name created
  name=$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Type}} {{.Name}}{{end}}{{end}}" "$1") ||
    return 1
  [[ $name == "volume "?* ]] || return 1
  name=${name#volume }
  created=$(docker volume inspect -f '{{.CreatedAt}}' "$name") || return 1
  printf '%s %s\n' "$name" "$created"
}

# Runs sh code in a probe that mounts Tempo's volume read-only as Tempo's user, without network or
# capabilities, so it reads only what Tempo can read. Its last line is the exit status of the code's
# last command; without that line the probe did not run. The probe image is the stack's Prometheus,
# by ID, so nothing is pulled.
tempo_storage() {
  docker run --rm --name "$PROBE-$RUN_ID-$1" --label "$RUN_LABEL=$RUN_ID" --network none --read-only \
    --cap-drop ALL --security-opt no-new-privileges:true --user "$TEMPO_USER" \
    --mount "type=volume,src=$TEMPO_VOLUME,dst=/var/tempo,readonly,volume-nocopy" \
    --entrypoint sh "$PROBE_IMAGE" -c "$2"' 2>&1; echo "exit=$?"' 2>&1 || true
}

# The hashes of the WAL's non-empty files, as the smoke test's T-3 lists them; fills WAL. Any other
# line, or no exit=0, makes the listing incomplete, and the function fails.
wal_manifest() {
  local out line hash_line="^[0-9a-f]{64}  $TEMPO_WAL/"
  WAL=()
  PROBES=$((PROBES + 1))
  out=$(tempo_storage "tempo-wal-$PROBES" "find $TEMPO_WAL -type f -size +0c -exec sha256sum {} +")
  [[ ${out##*$'\n'} == exit=0 ]] || return 1
  while IFS= read -r line; do
    if [[ $line =~ $hash_line ]]; then
      WAL+=("$line")
    elif [[ $line != exit=0 ]]; then
      return 1
    fi
  done <<<"$out"
}

# Content that was not in the WAL before the seed trace: a new file, or a file with new content.
wal_written() {
  local line
  wal_manifest || return 1
  for line in "${WAL[@]}"; do
    if [[ -z ${WAL_BEFORE[$line]-} ]]; then return 0; fi
  done
  return 1
}

trace_found() {
  local response
  response=$(grafana_request configured GET "$TEMPO_VIA_GRAFANA/api/v2/traces/$1" 2>/dev/null) || return 1
  [[ ${response##*$'\n'} == 200 && $response == *"$2"* ]]
}

datasource_ok() {
  local response
  response=$(grafana_request configured GET "/api/datasources/uid/$1/health" 2>/dev/null) || return 1
  [[ ${response##*$'\n'} == 200 && $response == *'"status":"OK"'* ]]
}

# Retries a check every 2 s until it passes or the deadline (in SECONDS) has passed.
retry_until() {
  local deadline=$1 name=$2 start=$SECONDS
  shift 2
  until "$@"; do
    if ((SECONDS >= deadline)); then
      fail "$name (gave up after $((SECONDS - start)) s)"
      return 1
    fi
    sleep 2
  done
  pass "$name (after $((SECONDS - start)) s)"
}

# Tempo, Grafana, the probe image and Tempo's volume, for seed and verify, which need them all.
find_containers() {
  local svc
  discover || finish
  for svc in tempo grafana prometheus; do
    [[ -n ${CONTAINER[$svc]-} ]] || fatal "the stack has no $svc container"
  done
  PROBE_IMAGE=$(docker inspect -f '{{.Image}}' "${CONTAINER[prometheus]}") || fatal "no image for the probes"
}

run_seed() {
  local state=$1 v trace_id span_id marker now span resource key deadline listed=false
  rm -f -- "$state" "$state.partial" || fatal "cannot remove the old $state"
  load_credentials
  echo "== the stack before the recreate: ${FILES[*]}"
  find_containers
  v=$(volume_at "${CONTAINER[tempo]}" /var/tempo) || fatal "tempo has no named volume at /var/tempo"
  read -r 'STATE[tempo_volume]' 'STATE[tempo_volume_created]' <<<"$v"
  v=$(volume_at "${CONTAINER[grafana]}" /var/lib/grafana) || fatal "grafana has no named volume at /var/lib/grafana"
  read -r 'STATE[grafana_volume]' 'STATE[grafana_volume_created]' <<<"$v"
  STATE[tempo_container]=${CONTAINER[tempo]}
  STATE[grafana_container]=${CONTAINER[grafana]}
  TEMPO_VOLUME=${STATE[tempo_volume]}

  echo "== a trace with a new ID"
  # A complete listing of the WAL before the trace, or a change afterwards would prove nothing.
  for _ in 1 2 3; do
    if wal_manifest; then
      for v in "${WAL[@]}"; do WAL_BEFORE[$v]=1; done
      listed=true
      break
    fi
    sleep 2
  done
  $listed || fatal "no complete listing of Tempo's WAL ($TEMPO_WAL) before the trace"
  pass "Tempo's WAL listed before the trace: ${#WAL[@]} non-empty file(s)"
  trace_id=$(random_hex 16)
  span_id=$(random_hex 8)
  marker=$PROBE-$RUN_ID
  now=${EPOCHREALTIME//[!0-9]/}000
  span='{"traceId":"'$trace_id'","spanId":"'$span_id'","name":"'$marker'","kind":1,"startTimeUnixNano":"'$((now - 1000000))'","endTimeUnixNano":"'$now'"}'
  resource='{"attributes":[{"key":"service.name","value":{"stringValue":"'$PROBE'"}}]}'
  if ! curl -fsS --max-time 10 -o /dev/null -H 'Content-Type: application/json' \
    -d '{"resourceSpans":[{"resource":'"$resource"',"scopeSpans":[{"spans":['"$span"']}]}]}' "$OTLP_URL"; then
    fail "Tempo accepts the trace $trace_id at $OTLP_URL"
    finish
  fi
  pass "Tempo accepts the trace $trace_id (span $marker) at $OTLP_URL"
  # By ID: Tempo returns a trace about 2 s after its request; search would take about 30 s.
  deadline=$((SECONDS + 30))
  retry_until "$deadline" "Grafana reads the trace through its Tempo datasource ($TEMPO_VIA_GRAFANA), the path verify uses" \
    trace_found "$trace_id" "$marker" || finish
  # The trace then survives the recreate only by Tempo's WAL replay, whatever its shutdown flushes.
  deadline=$((SECONDS + 45))
  retry_until "$deadline" "Tempo wrote new data to its WAL ($TEMPO_WAL) after accepting the trace" wal_written || finish
  STATE[trace_id]=$trace_id
  STATE[marker]=$marker

  for key in "${STATE_KEYS[@]}"; do
    [[ ${STATE[$key]-} =~ ${STATE_FORMAT[$key]} ]] || fatal "seed: $key is '${STATE[$key]-}', which verify would refuse"
  done
  # 0600, and in place only when complete, so verify never reads a partial file.
  (umask 077 && for key in "${STATE_KEYS[@]}"; do printf '%s=%s\n' "$key" "${STATE[$key]}"; done >"$state.partial") ||
    fatal "cannot write $state.partial"
  mv -f -- "$state.partial" "$state" || fatal "cannot move $state.partial to $state"
  pass "the state for verify is in $state: the trace, Tempo ${STATE[tempo_container]:0:12} on ${STATE[tempo_volume]}, Grafana ${STATE[grafana_container]:0:12} on ${STATE[grafana_volume]}"
}

# Reads seed's file strictly: every key once, in its only accepted form, and nothing else.
read_state() {
  local file=$1 line key value
  [[ -f $file && ! -L $file ]] || fatal "no state file $file; seed writes it in phase A"
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line == *=* ]] || fatal "$file: a line without ="
    key=${line%%=*}
    value=${line#*=}
    [[ -n ${STATE_FORMAT[$key]-} ]] || fatal "$file: unknown key '$key'"
    [[ -z ${STATE[$key]+set} ]] || fatal "$file: $key more than once"
    [[ $value =~ ${STATE_FORMAT[$key]} ]] || fatal "$file: $key is malformed"
    STATE[$key]=$value
  done <"$file"
  for key in "${STATE_KEYS[@]}"; do
    [[ -n ${STATE[$key]+set} ]] || fatal "$file: no $key"
  done
}

run_verify() {
  local v svc name path expected deadline storage line shown=0 tempo_now='' tempo_same=false
  read_state "$1"
  load_credentials
  echo "== the recreated stack: ${FILES[*]}"
  find_containers
  # Without these the checks below could pass on state that no recreate touched. A new grafana-data
  # volume, in particular, would get the same password from the secret file.
  for svc in tempo grafana; do
    if [[ ${CONTAINER[$svc]} != "${STATE[${svc}_container]}" ]]; then
      pass "P-V1 $svc was recreated: ${STATE[${svc}_container]:0:12} before, ${CONTAINER[$svc]:0:12} now"
    else
      fail "P-V1 $svc is still the container seed saw (${CONTAINER[$svc]:0:12}), so nothing shows a recreate"
    fi
  done
  # The volume each container mounts now, compared with the one seed recorded.
  for svc in tempo:/var/tempo grafana:/var/lib/grafana; do
    name=${svc%%:*}
    path=${svc#*:}
    expected="${STATE[${name}_volume]} ${STATE[${name}_volume_created]}"
    if ! v=$(volume_at "${CONTAINER[$name]}" "$path"); then
      fail "P-V1 $name: no named volume can be read at $path now, expected the volume seed saw, $expected"
      continue
    fi
    if [[ $name == tempo ]]; then tempo_now=${v%% *}; fi
    if [[ $v == "$expected" ]]; then
      pass "P-V1 $name uses the volume seed saw at $path: $v"
      if [[ $name == tempo ]]; then tempo_same=true; fi
    else
      fail "P-V1 $name at $path: '$v', expected the volume seed saw, $expected"
    fi
  done

  echo "== P-V1 after the recreate"
  # up --wait waits for Grafana's health check, not for Tempo, which replays its WAL first.
  deadline=$((SECONDS + 120))
  for svc in prometheus loki tempo; do
    retry_until "$deadline" "P-V1 Grafana's datasource $svc answers OK with the configured login" datasource_ok "$svc" ||
      true
  done
  retry_until "$deadline" "P-V1 the seeded trace ${STATE[trace_id]} is found through Grafana's Tempo datasource" \
    trace_found "${STATE[trace_id]}" "${STATE[marker]}" || true
  # T-4 on the volume Tempo mounts now, never on the state file's in its place: on any other volume,
  # its owners would say nothing about the storage that had to survive the recreate.
  name="P-V1 everything in Tempo's storage belongs to $TEMPO_USER"
  if [[ -z $tempo_now ]]; then
    echo "skip $name (no volume can be read at /var/tempo now; the state file's volume is not checked in its place)"
    return 0
  fi
  if ! $tempo_same; then
    echo "skip $name (Tempo mounts $tempo_now now, not the volume seed saw, ${STATE[tempo_volume]})"
    return 0
  fi
  TEMPO_VOLUME=$tempo_now
  # As in the smoke test: as Tempo's user without capabilities, so find also fails on a directory that
  # user cannot list or enter. It reads no file's content.
  storage=$(tempo_storage tempo-storage 'find /var/tempo 2>/dev/null | wc -l | sed "s/^ */entries=/"
    find /var/tempo ! -user 10001 -o ! -group 10001')
  if [[ ${storage%%$'\n'*} =~ ^entries=[0-9]+$ && ${storage#*$'\n'} == exit=0 ]]; then
    pass "$name, and $TEMPO_USER can traverse all of it (${storage%%$'\n'*} in $TEMPO_VOLUME)"
  else
    while IFS= read -r line && ((shown < 5)); do
      if [[ ! $line =~ ^(entries|exit)= ]]; then
        echo "     $line"
        shown=$((shown + 1))
      fi
    done <<<"$storage"
    fail "$name (the probe's other lines above, on $TEMPO_VOLUME; ${storage##*$'\n'})"
  fi
}

# Only this run's probes, by label: a name prefix would also match other runs' probes. -v, as --rm
# would: the Prometheus image declares a volume, so each probe has an anonymous one.
cleanup() {
  local ids=()
  mapfile -t ids < <(docker ps -aq --filter "label=$RUN_LABEL=$RUN_ID" 2>/dev/null)
  if ((${#ids[@]})); then docker rm -f -v "${ids[@]}" >/dev/null 2>&1 || true; fi
}

case ${1-} in
  static)
    need jq docker
    run_static
    ;;
  runtime)
    (($# == 1)) || fatal "usage: $0 runtime"
    need docker curl timeout od
    docker info >/dev/null 2>&1 || fatal "the Docker engine does not answer"
    run_runtime
    ;;
  seed | verify)
    (($# == 2)) && [[ -n $2 ]] || fatal "usage: $0 $1 <state file>"
    need docker curl od date sleep mv rm
    docker info >/dev/null 2>&1 || fatal "the Docker engine does not answer"
    # Unique per run: it labels and names the run's probes, so parallel runs do not collide.
    RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)-$$-$(random_hex 4)
    trap cleanup EXIT
    # Exiting through the EXIT trap removes the probes of an interrupted run too.
    trap 'exit 130' INT
    trap 'exit 143' TERM
    "run_$1" "$2"
    ;;
  *) fatal "usage: $0 static | runtime | seed <state file> | verify <state file>" ;;
esac
finish
