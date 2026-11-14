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
#
# A mapping is the tuple (service, host IP, host port, container port, protocol). The checks compare
# sets, never a count, so an extra or missing mapping, one on another service, a host IP other than
# 127.0.0.1 (none means every interface), a port range, an ephemeral host port or another protocol
# fails. Compose's mode is not compared: it matters only in Swarm. The sets are pinned on purpose: a
# mapping changed in a Compose file fails here until its set changes with it, in the same commit.
# The same holds for Grafana's secret and start guard. The Grafana checks name variables, never
# their values, so a password set by mistake does not reach the output.
# The script only renders the files; it starts and changes nothing.
set -euo pipefail
# Git Bash would otherwise rewrite the /run/secrets path it passes to jq into a Windows path.
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

command -v jq >/dev/null || fatal "jq is not installed"
command -v docker >/dev/null || fatal "docker is not installed"
case ${1-} in
  static) run_static ;;
  *) fatal "usage: $0 static" ;;
esac
finish
