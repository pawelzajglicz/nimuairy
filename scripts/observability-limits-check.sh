#!/usr/bin/env bash
# Checks the production resource limits (docs/OBSERVABILITY.md, Resource limits). The stack's
# limits live only in observability/compose.prod.yaml, the app's only in compose.prod.yaml.
#
#   static   Renders the stack with and without its overlay, the app with its production overlay,
#            and the app's development files, and checks the renders:
#            - every service of the stack gets mem_limit = memswap_limit, a pids_limit and
#              oom_score_adj 500, and nothing else changes;
#            - every service of the app gets its pinned mem_limit (APP_MEM_LIMITS_MIB) =
#              memswap_limit, a pids_limit and no oom_score_adj;
#            - no render has a CPU setting, a reservation or deploy.resources; the base and
#              development renders have no limits.
#   runtime  Checks the running stack against its render: the containers' HostConfig, the cgroup
#            files of their PID 1 (memory.max, memory.swap.max, pids.max, cpu.max, memory.events
#            and memory.events.local) and /proc/1/oom_score_adj. It reports memory.peak and
#            pids.peak, and the cgroup2 mount options, as info. It does not cover the app, which
#            is checked on the VPS (docs/S4.4_DESIGN_CONTRACT.md, Appendix A.3).
#
# The stack's values come from the render, so a changed limit needs no change here; the one number
# named for it is oom_score_adj 500, a decision rather than a sized value. The app's memory limits
# are pinned on purpose, to catch drift: a changed value in compose.prod.yaml fails here until
# APP_MEM_LIMITS_MIB changes with it. OBSERVABILITY_COMPOSE_FILES (space-separated, from the
# repository root) replaces the stack's two files, for example to check a copy of the stack started
# under another project name.
#
# runtime starts one short-lived probe per container. It shares only that container's PID
# namespace and the host's cgroup namespace, runs as nobody without capabilities or network, and
# only reads. The script starts, stops and changes nothing else. On exit it removes its own probes,
# found by a label with this run's ID, so it never touches another run's probes.
# CI runs both modes in the observability job. runtime verifies configuration, not protection.
# The script is for CI and local runs, not the VPS (docs/OBSERVABILITY.md, Resource limits).
set -euo pipefail
# Git Bash would otherwise rewrite the probe's /proc and /sys paths into Windows paths.
export MSYS_NO_PATHCONV=1

read -ra FILES <<<"${OBSERVABILITY_COMPOSE_FILES:-observability/compose.yaml observability/compose.prod.yaml}"
PROBE=observability-limits-check
# Unique per run: it labels and names the run's probes, so parallel runs do not collide.
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)-$$-$(od -An -N4 -tx4 /dev/urandom | tr -d ' ')
RUN_LABEL=$PROBE.run
# CPU limits and weights, and reservations: S4.4 sets none of them (docs/DEFERRED_WORK.md, CPU
# weights). deploy.resources is checked on its own.
CPU_AND_RESERVATION_KEYS='["cpus","cpu_shares","cpu_quota","cpu_period","cpu_count","cpu_percent","cpuset","cpu_rt_runtime","cpu_rt_period","mem_reservation"]'
OOM_SCORE_ADJ=500
# The app's selected memory limits in MiB (docs/VPS_RESOURCE_BUDGET.md, Container limits). Its PID
# limits are not pinned.
APP_MEM_LIMITS_MIB='{"backend": 1792, "postgres": 512, "frontend": 128, "cloudflared": 256}'
# compose.prod.yaml does not render without these (${VAR:?}). Dummy values: only resource keys are
# read.
APP_PROD_ENV=(APP_SHA=limits-check POSTGRES_PASSWORD=limits-check JWT_SECRET=limits-check
  CLOUDFLARED_TOKEN=limits-check)
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

# A render that must stay without limits: no service may carry a limit, CPU, reservation or
# deploy.resources key.
check_unlimited() {
  judge --arg name "$1" --argjson cpu "$CPU_AND_RESERVATION_KEYS" '
    [.services | to_entries[] | .key as $s | .value as $p
      | ((["mem_limit", "memswap_limit", "pids_limit", "oom_score_adj"] + $cpu)[]
          | select(. as $k | $p | has($k)) | "\($s).\(.)"),
        (if ($p.deploy.resources // null) != null then "\($s).deploy.resources" else empty end)
    ] as $found
    | if (.services | length) == 0 then "FAIL \($name): the render has no service"
      elif ($found | length) == 0
      then "ok   \($name): no limit, CPU, reservation or deploy.resources key (\(.services | length) services)"
      else "FAIL \($name) sets \($found | join(", "))" end' <<<"$2"
}

run_static() {
  local base prod app_prod dev dev_obs
  base=$(render "${FILES[0]}") || fatal "${FILES[0]} does not render"
  prod=$(render "${FILES[@]}") || fatal "${FILES[*]} do not render"
  # The exports end with the command substitution's subshell.
  app_prod=$(export "${APP_PROD_ENV[@]}" && render compose.yaml compose.prod.yaml) ||
    fatal "the app's production files do not render"
  dev=$(render compose.yaml compose.override.yaml) || fatal "the app's development files do not render"
  dev_obs=$(render compose.yaml compose.override.yaml compose.observability.yaml compose.observability.dev.yaml) ||
    fatal "the app's development files with the observability overlays do not render"

  echo "== the stack with its production overlay: ${FILES[*]}"
  # Both renders go in on stdin: as arguments they could exceed a command-line limit.
  judge -n --argjson cpu "$CPU_AND_RESERVATION_KEYS" --argjson adj "$OOM_SCORE_ADJ" '
    def mib: tonumber / 1048576;
    input as $base | input as $prod
    | ($base.services | keys) as $bk
    | ($prod.services | keys) as $pk
    | (if ($bk | length) == 0 then "FAIL the base render has no service"
       elif $pk == $bk then "ok   the overlay adds and removes no service (\($pk | length): \($pk | join(", ")))"
       else "FAIL the overlay changes the services: base \($bk | join(", ")), with the overlay \($pk | join(", "))" end),
      ([($prod | keys[]), ($base | keys[])] | unique | map(select(. != "services" and $prod[.] != $base[.]))) as $top
      | (if ($top | length) == 0 then "ok   the overlay changes nothing outside services"
         else "FAIL the overlay changes \($top | join(", ")) outside services" end),
      ($pk[] as $s | $prod.services[$s] as $p | ($base.services[$s] // {}) as $b
       | [ if ($p | has("mem_limit") | not) then "no mem_limit"
           elif ($p.mem_limit | tonumber) <= 0 then "mem_limit is not positive"
           else empty end,
           if ($p | has("memswap_limit") | not) then "no memswap_limit"
           elif ($p | has("mem_limit")) and ($p.memswap_limit | tonumber) != ($p.mem_limit | tonumber)
           then "memswap_limit \($p.memswap_limit | mib) MiB differs from mem_limit \($p.mem_limit | mib) MiB"
           else empty end,
           if (($p.pids_limit // 0) | tonumber) <= 0 then "no positive pids_limit" else empty end,
           if (($p.oom_score_adj // "unset") | tostring) != ($adj | tostring)
           then "oom_score_adj is \($p.oom_score_adj // "unset"), not \($adj)" else empty end,
           ($cpu[] as $k | select($p | has($k)) | "sets \($k)"),
           if ($p.deploy.resources // null) != null then "sets deploy.resources" else empty end,
           ([($p | keys[]), ($b | keys[])] | unique
             | map(select(IN("mem_limit", "memswap_limit", "pids_limit", "oom_score_adj") | not)
                   | select($p[.] != $b[.]))) as $changed
           | if ($changed | length) > 0 then "also changes \($changed | join(", "))" else empty end
         ] as $problems
       | if ($problems | length) == 0
         then "ok   \($s): mem_limit = memswap_limit = \($p.mem_limit | mib) MiB, pids_limit \($p.pids_limit), oom_score_adj \($p.oom_score_adj)"
         else "FAIL \($s): \($problems | join("; "))" end)' <<<"$base"$'\n'"$prod"

  # Unlike the stack's overlay, this one also sets images, secrets and cloudflared, so only the
  # resource keys are checked. The services must match the pinned ones, so a service added without
  # a pinned limit fails.
  echo "== the app with its production overlay: compose.yaml compose.prod.yaml"
  judge --argjson cpu "$CPU_AND_RESERVATION_KEYS" --argjson pinned "$APP_MEM_LIMITS_MIB" '
    def mib: tonumber / 1048576;
    (.services | keys) as $rk | ($pinned | keys) as $pk
    | (if $rk == $pk then "ok   the services match the pinned ones (\($rk | length): \($rk | join(", ")))"
       else "FAIL the render has the services \($rk | join(", ")), the pinned ones are \($pk | join(", "))" end),
      ($pk[] as $s | .services[$s] as $p
       | if $p == null then "FAIL \($s): not in the render"
         else [ if ($p | has("mem_limit") | not) then "no mem_limit"
                elif ($p.mem_limit | tonumber) != ($pinned[$s] * 1048576)
                then "mem_limit is \($p.mem_limit | mib) MiB, pinned \($pinned[$s]) MiB"
                else empty end,
                if ($p | has("memswap_limit") | not) then "no memswap_limit"
                elif ($p | has("mem_limit")) and ($p.memswap_limit | tonumber) != ($p.mem_limit | tonumber)
                then "memswap_limit \($p.memswap_limit | mib) MiB differs from mem_limit \($p.mem_limit | mib) MiB"
                else empty end,
                if (($p.pids_limit // 0) | tonumber) <= 0 then "no positive pids_limit" else empty end,
                if ($p | has("oom_score_adj")) then "sets oom_score_adj \($p.oom_score_adj)" else empty end,
                ($cpu[] as $k | select($p | has($k)) | "sets \($k)"),
                if ($p.deploy.resources // null) != null then "sets deploy.resources" else empty end
              ] as $problems
           | if ($problems | length) == 0
             then "ok   \($s): mem_limit = memswap_limit = \($p.mem_limit | mib) MiB as pinned, pids_limit \($p.pids_limit), no oom_score_adj"
             else "FAIL \($s): \($problems | join("; "))" end
         end)' <<<"$app_prod"

  echo "== renders that must stay without limits"
  check_unlimited "the stack without the overlay (${FILES[0]})" "$base"
  check_unlimited "the app in development (compose.yaml + compose.override.yaml)" "$dev"
  check_unlimited "the app in development with compose.observability.yaml and compose.observability.dev.yaml" "$dev_obs"
}

# Runs in the probe as busybox sh. /proc/1 is the container's PID 1; with the host's cgroup
# namespace its cgroup path is the full one under /sys/fs/cgroup. A file it cannot read is printed
# as unreadable, which fails the check.
PROBE_SCRIPT='
cg=/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/1/cgroup)
read_into() { if v=$(cat "$2" 2>/dev/null); then echo "$1=$v"; else echo "unreadable=$2"; fi; }
for f in memory.max memory.swap.max memory.peak pids.max pids.peak cpu.max; do read_into "$f" "$cg/$f"; done
for f in memory.events memory.events.local; do
  if [ -r "$cg/$f" ]; then awk -v f="$f" "{ print f \".\" \$1 \"=\" \$2 }" "$cg/$f"; else echo "unreadable=$cg/$f"; fi
done
read_into oom_score_adj /proc/1/oom_score_adj
echo "mount=$(grep " cgroup2 " /proc/self/mounts | head -n 1)"
'

# Compares a reading with what the render makes it; uses the caller's got and problems.
expect() { [[ ${got[$1]-} == "$2" ]] || problems+=("$1 is '${got[$1]-missing}', expected '$2'"); }

run_runtime() {
  local prod svc cid count image out line key mem swap pids adj i mount_shown=false
  local args=() services=() values=() problems=()
  local -A got=()
  local hostconfig=(Memory MemorySwap PidsLimit OomScoreAdj NanoCpus CpuQuota CpuShares MemoryReservation
    RestartCount Running OOMKilled)
  prod=$(render "${FILES[@]}") || fatal "${FILES[*]} do not render"
  for i in "${FILES[@]}"; do args+=(-f "$i"); done
  mapfile -t services < <(jq -r '.services | keys[]' <<<"$prod")
  ((${#services[@]})) || fatal "the render has no service"
  # The probes run the Prometheus image, which the stack already has and which has busybox.
  cid=$(docker compose "${args[@]}" ps -q prometheus)
  [[ -n $cid ]] || fatal "prometheus is not running; start the stack with ${FILES[*]}"
  image=$(docker inspect -f '{{.Image}}' "$cid")

  echo "== the running stack against its render: ${FILES[*]}"
  for svc in "${services[@]}"; do
    problems=()
    got=()
    read -r mem swap pids adj < <(jq -r --arg s "$svc" '.services[$s]
      | [.mem_limit, .memswap_limit, .pids_limit, .oom_score_adj] | map(. // 0 | tonumber) | @tsv' <<<"$prod")
    ((mem > 0)) || problems+=("the render sets no mem_limit")
    cid=$(docker compose "${args[@]}" ps -q "$svc")
    count=$(wc -w <<<"$cid")
    if ((count != 1)); then
      echo "FAIL $svc: $count running container(s), expected 1"
      failures+=("$svc: $count running container(s)")
      continue
    fi
    # HostConfig as Docker applied it. PidsLimit is a pointer, so an unset one prints as unset.
    read -ra values < <(docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}
      {{- if .HostConfig.PidsLimit}} {{.HostConfig.PidsLimit}}{{else}} unset{{end}} {{.HostConfig.OomScoreAdj}}
      {{- " "}}{{.HostConfig.NanoCpus}} {{.HostConfig.CpuQuota}} {{.HostConfig.CpuShares}} {{.HostConfig.MemoryReservation}}
      {{- " "}}{{.RestartCount}} {{.State.Running}} {{.State.OOMKilled}}' "$cid")
    for i in "${!hostconfig[@]}"; do got[${hostconfig[$i]}]=${values[$i]-}; done
    if ! out=$(docker run --rm --name "$PROBE-$RUN_ID-$svc" --label "$RUN_LABEL=$RUN_ID" \
      --pid "container:$cid" --cgroupns host --network none \
      --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 65534:65534 \
      --entrypoint sh "$image" -c "$PROBE_SCRIPT" 2>&1); then
      echo "FAIL $svc: the probe did not run: $out"
      failures+=("$svc: the probe did not run")
      continue
    fi
    while IFS= read -r line; do
      key=${line%%=*}
      if [[ $key == unreadable ]]; then problems+=("cannot read ${line#*=}"); else got[$key]=${line#*=}; fi
    done <<<"$out"

    expect Memory "$mem"
    expect MemorySwap "$swap"
    [[ ${got[MemorySwap]-} == "${got[Memory]-}" ]] || problems+=("MemorySwap differs from Memory")
    expect PidsLimit "$pids"
    expect OomScoreAdj "$adj"
    expect NanoCpus 0
    expect CpuQuota 0
    expect CpuShares 0
    expect MemoryReservation 0
    expect Running true
    expect OOMKilled false
    expect memory.max "$mem"
    expect memory.swap.max 0
    expect pids.max "$pids"
    expect cpu.max "max 100000"
    expect memory.events.local.oom 0
    expect memory.events.local.oom_kill 0
    expect memory.events.oom 0
    expect memory.events.oom_kill 0
    expect oom_score_adj "$adj"
    # The outage check stops and starts the proxy by hand. CI checks the proxy on its own afterwards,
    # so its restart count is info here.
    [[ $svc == docker-socket-proxy ]] || expect RestartCount 0

    if ((${#problems[@]})); then
      line=$(printf '%s; ' "${problems[@]}")
      echo "FAIL $svc: ${line%; }"
      failures+=("$svc")
    else
      echo "ok   $svc: Memory = MemorySwap = memory.max = $((mem / 1048576)) MiB, memory.swap.max 0, pids.max $pids, cpu.max max 100000, no CPU quota, shares or reservation; oom_score_adj $adj in HostConfig and on PID 1; oom and oom_kill 0; running, not OOM-killed"
    fi
    echo "info $svc: memory.peak $(awk -v p="${got[memory.peak]-0}" 'BEGIN { printf "%.1f", p / 1048576 }') of $((mem / 1048576)) MiB, pids.peak ${got[pids.peak]-missing} of $pids, RestartCount ${got[RestartCount]-missing}"
    if ! $mount_shown && [[ -n ${got[mount]-} ]]; then
      echo "info cgroup2 mount as a container in the host's cgroup namespace sees it: ${got[mount]}"
      mount_shown=true
    fi
  done
}

# Only this run's probes, by label: a name prefix would also match other runs' probes.
cleanup() {
  local ids=()
  mapfile -t ids < <(docker ps -aq --filter "label=$RUN_LABEL=$RUN_ID" 2>/dev/null)
  # -v, as --rm would: the Prometheus image declares a volume, so each probe has an anonymous one.
  if ((${#ids[@]})); then docker rm -f -v "${ids[@]}" >/dev/null 2>&1 || true; fi
}

command -v jq >/dev/null || fatal "jq is not installed"
docker info >/dev/null 2>&1 || fatal "the Docker engine does not answer"
case ${1-} in
  static) run_static ;;
  runtime)
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    run_runtime
    ;;
  *) fatal "usage: $0 static|runtime" ;;
esac
finish
