#!/usr/bin/env bash
# Tests scripts/configure-unattended-upgrades.sh in disposable systemd ubuntu:24.04 containers, so
# nothing changes on this machine or on the VPS. Needs Docker that can run privileged containers
# and network access to the Ubuntu archive. Takes a few minutes. Run from the repository root:
#   bash scripts/configure-unattended-upgrades-test.sh
set -euo pipefail
# Git Bash on Windows would turn the container paths below into Windows paths.
export MSYS_NO_PATHCONV=1

readonly SCRIPT=${0%/*}/configure-unattended-upgrades.sh
readonly UNITS='apt-daily.service apt-daily-upgrade.service apt-daily.timer apt-daily-upgrade.timer'
readonly CONF=/etc/apt/apt.conf.d
readonly BACKUPS=/var/backups/nimuairy-unattended-upgrades
readonly BASE_IMAGE=nimuairy-uu-test:base-$$ INSTALLED_IMAGE=nimuairy-uu-test:installed-$$
# What the audit found on the VPS: every periodic job off.
readonly VPS_AUTO_UPGRADES='APT::Periodic::Update-Package-Lists "0";
APT::Periodic::Unattended-Upgrade "0";
APT::Periodic::Download-Upgradeable-Packages "0";
APT::Periodic::AutocleanInterval "0";'

[[ -r $SCRIPT ]] || { echo "ERROR: $SCRIPT not found" >&2; exit 1; }
containers=()
images=()
cleanup() {
  ((${#containers[@]})) && docker rm -f "${containers[@]}" >/dev/null 2>&1
  ((${#images[@]})) && docker rmi "${images[@]}" >/dev/null 2>&1
  return 0
}
trap cleanup EXIT

# Runs $3 in a container from $2 and saves the result as image $1.
build() {
  local name=nimuairy-uu-build-$$ log
  if ! log=$(docker run --name "$name" "$2" bash -euc "$3" 2>&1); then
    docker rm -f "$name" >/dev/null
    printf 'ERROR: building %s failed:\n%s\n' "$1" "$log" >&2
    exit 1
  fi
  docker commit "$name" "$1" >/dev/null
  docker rm "$name" >/dev/null
  images+=("$1")
}

# Starts a container from $1 with systemd as PID 1, copies the script in and sets c to its id.
start() {
  local state=
  c=$(docker run -d --privileged --cgroupns=private "$1" /usr/lib/systemd/systemd)
  containers+=("$c")
  for _ in {1..60}; do
    state=$(docker exec "$c" systemctl is-system-running 2>/dev/null || true)
    [[ $state == running || $state == degraded ]] && break
    sleep 1
  done
  [[ $state == running || $state == degraded ]] || { echo "ERROR: systemd did not come up ($state)" >&2; exit 1; }
  docker exec -i "$c" sh -c 'cat >/tmp/configure.sh' <"$SCRIPT"
}

in_c() { docker exec "$c" bash -c "$1"; }
# Writes stdin to the file $1 in the container.
put() { docker exec -i "$c" sh -c "cat >'$1'"; }
conf() { in_c "eval \"\$(apt-config shell v '$1')\"; printf %s \"\$v\""; }

# Runs the script without a terminal, as user $1 (default root). Sets out and rc.
run() {
  rc=0
  out=$(docker exec -u "${1:-root}" "$c" bash /tmp/configure.sh 2>&1) || rc=$?
  shown=false
}
# Runs the script in a pseudo-terminal and answers $1 to its prompt. Sets out and rc.
run_tty() {
  rc=0
  out=$(printf '%s\n' "$1" | docker exec -i "$c" script -qec 'bash /tmp/configure.sh' /dev/null 2>&1) || rc=$?
  out=${out//$'\r'/}
  shown=false
}

# Everything the script may change: apt.conf.d, the units, the backups and the package.
snapshot() {
  in_c "cd $CONF && sha256sum -- * && stat -c '%n %Y' -- *
    for u in $UNITS; do echo \"\$u \$(systemctl is-enabled \$u 2>/dev/null) \$(systemctl is-active \$u)\"; done
    ls -A $BACKUPS 2>/dev/null || true
    dpkg-query -W -f='\${Status}\n' unattended-upgrades 2>/dev/null || true"
}
# Runs $1 in the container to set up a case, then records the state the script must not change.
prepare() {
  in_c "$1"
  before=$(snapshot)
}

passed=0 failed=0 shown=false
check() {
  local what=$1
  shift
  if "$@"; then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "  FAIL: $what" >&2
  if ! $shown; then
    shown=true
    echo "  Output (exit $rc):" >&2
    while IFS= read -r line; do echo "    | $line" >&2; done <<<"$out"
  fi
}
has() { grep -qF -- "$1" <<<"$out"; }
lacks() { ! grep -qF -- "$1" <<<"$out"; }
# True if the output has a line with $1 before a line with $2.
in_order() {
  local first second
  first=$(grep -nF -m 1 -- "$1" <<<"$out" | cut -d: -f1)
  second=$(grep -nF -m 1 -- "$2" <<<"$out" | cut -d: -f1)
  [[ -n $first && -n $second ]] && ((first < second))
}
exit_is() { [[ $rc == "$1" ]]; }
same() { [[ $1 == "$2" ]]; }
unchanged() { [[ $(snapshot) == "$before" ]]; }
section() { echo "== $*"; }

check_policy_applied() {
  local key
  for key in Update-Package-Lists=1 Unattended-Upgrade=1 Download-Upgradeable-Packages=0 AutocleanInterval=0; do
    check "APT::Periodic::${key%=*} is ${key#*=}" same "$(conf "APT::Periodic::${key%=*}")" "${key#*=}"
  done
  for key in Remove-Unused-Kernel-Packages Remove-New-Unused-Dependencies Remove-Unused-Dependencies \
    Automatic-Reboot; do
    check "Unattended-Upgrade::$key is false" same "$(conf "Unattended-Upgrade::$key")" false
  done
  for key in $UNITS; do
    check "$key is not masked" same "$(in_c "systemctl show -P LoadState $key")" loaded
  done
  for key in apt-daily.timer apt-daily-upgrade.timer; do
    check "$key is enabled" same "$(in_c "systemctl is-enabled $key")" enabled
    check "$key is active" same "$(in_c "systemctl is-active $key")" active
  done
  # The timers may only schedule the services. An empty InvocationID means it never started.
  for key in apt-daily.service apt-daily-upgrade.service; do
    check "$key was not started" same "$(in_c "systemctl show -P InvocationID $key")" ''
  done
}

# A package upgrade reruns the postinst, which passes 20auto-upgrades to ucf. Without a terminal,
# as in an unattended upgrade of unattended-upgrades itself, ucf must keep the script's file.
check_reconfigure_keeps_file() {
  local ours
  ours=$(in_c "sha256sum <$CONF/20auto-upgrades")
  in_c 'dpkg-reconfigure -fnoninteractive unattended-upgrades >/dev/null 2>&1'
  check "$1: package reconfigure keeps 20auto-upgrades" same "$(in_c "sha256sum <$CONF/20auto-upgrades")" "$ours"
  check "$1: apt prints no notices after it" same "$(in_c 'apt-config dump 2>&1 >/dev/null')" ''
  check "$1: Unattended-Upgrade is still 1" same "$(conf APT::Periodic::Unattended-Upgrade)" 1
}

echo "Building the test images (systemd, dbus; then unattended-upgrades in the audited VPS state)..."
build "$BASE_IMAGE" ubuntu:24.04 "
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends systemd dbus >/dev/null
  # The Docker image turns apt's periodic jobs off with APT::Periodic::Enable. The VPS does not.
  rm $CONF/docker-disable-periodic-update
  for u in $UNITS; do ln -s /dev/null /etc/systemd/system/\$u; done"
build "$INSTALLED_IMAGE" "$BASE_IMAGE" "
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends unattended-upgrades >/dev/null
  printf '%s\n' '$VPS_AUTO_UPGRADES' >$CONF/20auto-upgrades"

section "Refusals that change nothing (package installed, units masked)"
start "$INSTALLED_IMAGE"
prepare true
run nobody
check "non-root: exits 1" exit_is 1
check "non-root: asks for root" has "ERROR: run as root"
check "non-root: changes nothing" unchanged

prepare 'rm /etc/os-release && sed "s/^VERSION_ID=.*/VERSION_ID=\"22.04\"/" /usr/lib/os-release >/etc/os-release'
run
check "Ubuntu 22.04: exits 1" exit_is 1
check "Ubuntu 22.04: names the version" has "supports Ubuntu 24.04 only, found 'ubuntu 22.04'"
check "Ubuntu 22.04: changes nothing" unchanged
in_c 'ln -sf ../usr/lib/os-release /etc/os-release'

prepare 'mv /usr/bin/apt-config /root/'
run
check "no apt-config: exits 1" exit_is 1
check "no apt-config: names the package" has "'apt-config' not found; install the apt package"
check "no apt-config: changes nothing" unchanged
in_c 'mv /root/apt-config /usr/bin/'

prepare 'mv /usr/lib/systemd/system/apt-daily-upgrade.timer /root/ && systemctl daemon-reload'
run
check "missing unit file: exits 1" exit_is 1
check "missing unit file: says to reinstall apt" has "apt-daily-upgrade.timer not found. apt ships it"
check "missing unit file: changes nothing" unchanged
in_c 'mv /root/apt-daily-upgrade.timer /usr/lib/systemd/system/ && systemctl daemon-reload'

prepare 'systemctl mask --runtime apt-daily.timer >/dev/null 2>&1'
run
check "runtime mask: exits 1" exit_is 1
check "runtime mask: explains it" has "apt-daily.timer is masked in /run/systemd/system (a runtime mask)"
check "runtime mask: names the fix" has "systemctl unmask --runtime apt-daily.timer"
check "runtime mask: changes nothing" unchanged
in_c 'systemctl unmask --runtime apt-daily.timer >/dev/null 2>&1'

prepare 'rm /etc/systemd/system/apt-daily.service && cp /usr/lib/systemd/system/apt-daily.service /etc/systemd/system/ && systemctl daemon-reload'
run
check "replaced unit: exits 1" exit_is 1
check "replaced unit: names the copy" has "loaded from '/etc/systemd/system/apt-daily.service'"
check "replaced unit: changes nothing" unchanged
in_c 'ln -sf /dev/null /etc/systemd/system/apt-daily.service && systemctl daemon-reload'

prepare true
run
check "no terminal: exits 1" exit_is 1
check "no terminal: lists the changes" has "- Unmask $UNITS."
check "no terminal: shows the diff" has '+APT::Periodic::Unattended-Upgrade "1";'
check "no terminal: refuses" has "rerun from an interactive shell to confirm these changes; nothing was changed."
check "no terminal: changes nothing" unchanged

run_tty n
check "answer n: exits 1" exit_is 1
check "answer n: says so" has "Nothing was changed."
check "answer n: changes nothing" unchanged

# Each case is a file that apt reads after the script's files, and the message it must cause.
# shellcheck disable=SC2016
conflicts=(
  'APT::Periodic::Enable "0";'
  "APT::Periodic::Enable is '0'"
  'APT::Periodic::Download-Upgradeable-Packages "1";'
  "APT::Periodic::Download-Upgradeable-Packages is '1' instead of '0'"
  'APT::Periodic::AutocleanInterval "7";'
  "APT::Periodic::AutocleanInterval is '7' instead of '0'"
  'APT::Periodic::CleanInterval "1";'
  "APT::Periodic::CleanInterval is '1', so apt.systemd.daily would delete cached packages"
  'Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}-updates"; };'
  "Allowed-Origins includes '\${distro_id}:\${distro_codename}-updates'"
  'Unattended-Upgrade::Allowed-Origins { "Docker:${distro_codename}"; };'
  "Allowed-Origins includes 'Docker:\${distro_codename}'"
  'Unattended-Upgrade::Origins-Pattern { "origin=. nodistro"; };'
  "Origins-Pattern includes 'origin=. nodistro'"
  '#clear Unattended-Upgrade::Allowed-Origins;'
  "Allowed-Origins lacks '\${distro_id}:\${distro_codename}-security'"
  'Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";'
  "Unattended-Upgrade::Remove-Unused-Kernel-Packages is 'true' instead of 'false'"
  'Unattended-Upgrade::Remove-New-Unused-Dependencies "true";'
  "Unattended-Upgrade::Remove-New-Unused-Dependencies is 'true' instead of 'false'"
  'Unattended-Upgrade::Automatic-Reboot "true";'
  "Unattended-Upgrade::Automatic-Reboot is 'true' instead of 'false'"
  'APT::Periodic::Unattended-Upgrade "0"'
  "apt cannot read the configuration with this script's files"
)
for ((i = 0; i < ${#conflicts[@]}; i += 2)); do
  put "$CONF/99zz-test" <<<"${conflicts[i]}"
  before=$(snapshot)
  run
  check "conflict ${conflicts[i]}: exits 1" exit_is 1
  check "conflict ${conflicts[i]}: names it" has "${conflicts[i + 1]}"
  check "conflict ${conflicts[i]}: changes nothing" unchanged
  in_c "rm $CONF/99zz-test"
done

section "First run on the audited VPS state, rerun, manual edit, rollback"
start "$INSTALLED_IMAGE"
orig=$(in_c "sha256sum <$CONF/20auto-upgrades")
run_tty y
check "first run: exits 0" exit_is 0
check "first run: shows the diff" has '-APT::Periodic::Update-Package-Lists "0";'
check "first run: creates the policy file" has "- Create $CONF/52nimuairy-unattended-upgrades:"
check "first run: unmasks the units" has "Unmasked $UNITS"
check "first run: restrictions written before updates are turned on" \
  in_order "Created $CONF/52nimuairy-unattended-upgrades." "Replaced $CONF/20auto-upgrades;"
check "first run: lists the timers" has "NEXT"
check "first run: no warning" lacks "WARNING"
check_policy_applied
check "first run: old 20auto-upgrades backed up" same "$(in_c "sha256sum <$BACKUPS/20auto-upgrades.*")" "$orig"
check "first run: masked units recorded" same "$(in_c "cat $BACKUPS/masked-units.*")" "$(tr ' ' '\n' <<<"$UNITS")"
check "first run: files are 644" same "$(in_c "stat -c %a $CONF/20auto-upgrades $CONF/52nimuairy-unattended-upgrades")" $'644\n644'
check "first run: apt prints no notices" same "$(in_c 'apt-config dump 2>&1 >/dev/null')" ''
dry=$(in_c 'unattended-upgrade --dry-run --debug 2>&1' || true)
check "first run: unattended-upgrade allows only Ubuntu's origins" grep -qF \
  'Allowed origins are: o=Ubuntu,a=noble, o=Ubuntu,a=noble-security, o=UbuntuESMApps,a=noble-apps-security, o=UbuntuESM,a=noble-infra-security' <<<"$dry"

before=$(snapshot)
run
check "rerun: exits 0 without a terminal" exit_is 0
check "rerun: no prompt" lacks "Apply these changes?"
check "rerun: reports nothing changed" has "Nothing changed; everything was already in place."
check "rerun: changes nothing, no new backup" unchanged
check_reconfigure_keeps_file "debconf answer true"

prepare "sed -i 's/Download-Upgradeable-Packages \"0\"/Download-Upgradeable-Packages \"1\"/' $CONF/20auto-upgrades"
edited=$(in_c "sha256sum <$CONF/20auto-upgrades")
run
check "manual edit, no terminal: exits 1" exit_is 1
check "manual edit, no terminal: shows the edit" has '-APT::Periodic::Download-Upgradeable-Packages "1";'
check "manual edit, no terminal: changes nothing" unchanged
run_tty y
check "manual edit: exits 0" exit_is 0
check "manual edit: replaced" has "Replaced $CONF/20auto-upgrades; the previous version is $BACKUPS/20auto-upgrades."
check "manual edit: edited version backed up" same "$(in_c "sha256sum <\$(ls $BACKUPS/20auto-upgrades.* | tail -n 1)")" "$edited"
check "manual edit: policy file not backed up" same "$(in_c "ls $BACKUPS | grep -c 52nimuairy || true")" 0
# The same edit again: its newest backup is identical, so no third copy.
in_c "sed -i 's/Download-Upgradeable-Packages \"0\"/Download-Upgradeable-Packages \"1\"/' $CONF/20auto-upgrades"
run_tty y
check "same edit again: exits 0" exit_is 0
check "same edit again: reuses the identical backup" same "$(in_c "ls $BACKUPS/20auto-upgrades.* | wc -l")" 2

# The commands of docs/VPS_UNATTENDED_UPGRADES.md, Rollback, with the oldest backups.
in_c "systemctl disable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null
  systemctl mask \$(cat \$(ls $BACKUPS/masked-units.* | head -n 1)) 2>/dev/null
  cp \$(ls $BACKUPS/20auto-upgrades.* | head -n 1) $CONF/20auto-upgrades
  rm $CONF/52nimuairy-unattended-upgrades"
check "rollback: 20auto-upgrades restored" same "$(in_c "sha256sum <$CONF/20auto-upgrades")" "$orig"
check "rollback: Unattended-Upgrade is 0 again" same "$(conf APT::Periodic::Unattended-Upgrade)" 0
for unit in $UNITS; do
  check "rollback: $unit masked again" same "$(in_c "systemctl is-enabled $unit" || true)" masked
done
check "rollback: timers stopped" same "$(in_c 'systemctl is-active apt-daily.timer apt-daily-upgrade.timer' || true)" $'inactive\ninactive'
run_tty y
check "run after rollback: exits 0" exit_is 0
check_policy_applied

section "Package not installed"
start "$BASE_IMAGE"
run_tty y
check "install: exits 0" exit_is 0
check "install: announced" has "- Install unattended-upgrades."
check "install: installed" same "$(in_c "dpkg-query -W -f='\${Status}' unattended-upgrades")" 'install ok installed'
check "install: debconf answer kept off" grep -q 'enable_auto_updates: false' <<<"$(in_c 'debconf-show unattended-upgrades')"
# With that answer the postinst writes no 20auto-upgrades. Its default would have written one that
# turns updates on, which the script would then have had to replace.
check "install: postinst left updates off" has "Created $CONF/20auto-upgrades."
check "install: nothing to back up" same "$(in_c "ls $BACKUPS")" "$(in_c "ls $BACKUPS | grep masked-units")"
check "install: debconf change reported" has "  - set the debconf answer unattended-upgrades/enable_auto_updates to false"
check_policy_applied
check_reconfigure_keeps_file "debconf answer false"

section "Package install fails"
start "$BASE_IMAGE"
put /usr/local/sbin/apt-get <<'EOF'
#!/bin/sh
case " $* " in *" install "*) echo "E: injected install failure" >&2; exit 100 ;; esac
exec /usr/bin/apt-get "$@"
EOF
prepare 'chmod +x /usr/local/sbin/apt-get'
run_tty y
check "install failure: exits with apt-get's status" exit_is 100
check "install failure: shows apt's error" has "E: injected install failure"
check "install failure: reports the debconf answer" has "  - set the debconf answer unattended-upgrades/enable_auto_updates to false"
check "install failure: reports nothing else" lacks "  - installed unattended-upgrades"
check "install failure: no other change" unchanged

section "Units already unmasked and active, with a drop-in"
start "$INSTALLED_IMAGE"
in_c "systemctl unmask $UNITS 2>/dev/null && systemctl enable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null
  mkdir -p /etc/systemd/system/apt-daily.timer.d
  printf '[Timer]\nRandomizedDelaySec=1h\n' >/etc/systemd/system/apt-daily.timer.d/override.conf
  systemctl daemon-reload"
run_tty y
check "unmasked: exits 0" exit_is 0
check "unmasked: nothing to unmask" lacks "Unmask"
check "unmasked: timers left alone" lacks "Enable and start"
check "unmasked: drop-in reported" has "WARNING: apt-daily.timer has drop-ins that change it: /etc/systemd/system/apt-daily.timer.d/override.conf"
check "unmasked: no masked-units record" same "$(in_c "ls $BACKUPS | grep -c masked-units || true")" 0
check_policy_applied

section "systemctl unmask fails"
start "$INSTALLED_IMAGE"
put /usr/local/sbin/systemctl <<'EOF'
#!/bin/sh
[ "$1" = unmask ] && { echo "Failed to unmask (injected)" >&2; exit 1; }
exec /usr/bin/systemctl "$@"
EOF
in_c 'chmod +x /usr/local/sbin/systemctl'
run_tty y
check "unmask failure: exits 1" exit_is 1
check "unmask failure: shows the error" has "Failed to unmask (injected)"
check "unmask failure: lists what changed" has "The script stopped after these changes:"
check "unmask failure: lists the replaced file" has "  - replaced $CONF/20auto-upgrades; the previous version is"
check "unmask failure: lists the new file" has "  - created $CONF/52nimuairy-unattended-upgrades"
check "unmask failure: points to rollback" has "docs/VPS_UNATTENDED_UPGRADES.md, Rollback"
check "unmask failure: units still masked" same "$(in_c 'systemctl is-enabled apt-daily.timer' || true)" masked

section "systemctl start fails for apt-daily-upgrade.timer"
start "$INSTALLED_IMAGE"
put /usr/local/sbin/systemctl <<'EOF'
#!/bin/sh
[ "$1" = start ] && [ "$2" = apt-daily-upgrade.timer ] && { echo "Job failed (injected)" >&2; exit 1; }
exec /usr/bin/systemctl "$@"
EOF
in_c 'chmod +x /usr/local/sbin/systemctl'
run_tty y
check "start failure: exits 1" exit_is 1
check "start failure: shows the error" has "Job failed (injected)"
check "start failure: lists the unmask" has "  - unmasked $UNITS"
check "start failure: lists the started timer" has "  - started apt-daily.timer"
check "start failure: other timer not active" same "$(in_c 'systemctl is-active apt-daily-upgrade.timer' || true)" inactive

echo "$passed passed, $failed failed"
((failed == 0))
