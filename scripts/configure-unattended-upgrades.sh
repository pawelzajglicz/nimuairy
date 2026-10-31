#!/usr/bin/env bash
# Turns on automatic Ubuntu security updates (see docs/VPS_UNATTENDED_UPGRADES.md): apt's timers
# refresh the package lists and run unattended-upgrade daily, limited to Ubuntu's default origins.
# It never reboots, removes packages or cleans the apt cache, and it never starts the apt-daily
# services itself. Safe to rerun. It does not touch SSH, UFW, Fail2ban or Docker. Run as root on the VPS.
set -euo pipefail
# apt translates its output, and the checks below compare it. gettext reads LANGUAGE before LC_ALL,
# so both are reset. APT_CONFIG would make apt read another configuration than the system's.
export LC_ALL=C LANGUAGE=
unset APT_CONFIG

readonly CONF_DIR=/etc/apt/apt.conf.d
readonly AUTO_FILE=$CONF_DIR/20auto-upgrades
# apt reads apt.conf.d in name order and later values win, so this file overrides
# 50unattended-upgrades. No package owns it, so no upgrade or dpkg-reconfigure rewrites it.
readonly POLICY_FILE=$CONF_DIR/52nimuairy-unattended-upgrades
# Not in apt.conf.d: apt would print a notice about every backup there on every run.
readonly BACKUP_DIR=/var/backups/nimuairy-unattended-upgrades
readonly UNIT_DIR=/usr/lib/systemd/system
readonly UNITS=(apt-daily.service apt-daily-upgrade.service apt-daily.timer apt-daily-upgrade.timer)
readonly TIMERS=(apt-daily.timer apt-daily-upgrade.timer)
# The Allowed-Origins of Ubuntu 24.04's 50unattended-upgrades. unattended-upgrade substitutes the
# variables itself, so apt-config shows them as written. The ESM origins match nothing without
# Ubuntu Pro.
# shellcheck disable=SC2016
readonly SECURITY_ORIGIN='${distro_id}:${distro_codename}-security'
# shellcheck disable=SC2016
readonly ALLOWED_ORIGINS=(
  '${distro_id}:${distro_codename}'
  "$SECURITY_ORIGIN"
  '${distro_id}ESMApps:${distro_codename}-apps-security'
  '${distro_id}ESM:${distro_codename}-infra-security'
)

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

installed() {
  [[ $(dpkg-query -W -f='${Status}' "$1" 2>/dev/null) == 'install ok installed' ]]
}

# The value apt reads for $1, or nothing if it is unset. If APT_CONFIG names an apt.conf, apt reads
# it first; that is how the new files are checked before they are written.
conf() {
  local v=
  eval "$(apt-config shell v "$1")"
  printf '%s' "$v"
}

# Prints one line for each way the configuration apt reads breaks the policy. A file read after
# the two this script writes can override them, so the merged values are checked, not the files.
policy_problems() {
  local key want got entry known security=false
  for key in Update-Package-Lists=1 Unattended-Upgrade=1 Download-Upgradeable-Packages=0 AutocleanInterval=0; do
    want=${key#*=}
    key=APT::Periodic::${key%=*}
    got=$(conf "$key")
    [[ $got == "$want" ]] || echo "$key is '$got' instead of '$want'"
  done
  # apt.systemd.daily compares Enable with 0 as a number, so only unset or 1 is a clear "on".
  got=$(conf APT::Periodic::Enable)
  if [[ -n $got && $got != 1 ]]; then
    echo "APT::Periodic::Enable is '$got', but apt.systemd.daily runs only when it is unset or 1"
  fi
  for key in APT::Periodic::CleanInterval APT::Periodic::MaxAge APT::Periodic::MaxSize \
    APT::Archives::MaxAge APT::Archives::MaxSize; do
    got=$(conf "$key")
    if [[ -n $got && $got != 0 ]]; then
      echo "$key is '$got', so apt.systemd.daily would delete cached packages"
    fi
  done
  # unattended-upgrade defaults Remove-Unused-Kernel-Packages and Remove-New-Unused-Dependencies to
  # true, so unset is not enough.
  for key in Remove-Unused-Kernel-Packages Remove-New-Unused-Dependencies Remove-Unused-Dependencies \
    Automatic-Reboot; do
    key=Unattended-Upgrade::$key
    got=$(conf "$key")
    [[ $got == false ]] || echo "$key is '${got:-unset}' instead of 'false'"
  done
  # The first line is the empty value of the list node itself.
  while IFS= read -r entry; do
    [[ -n $entry ]] || continue
    [[ $entry != "$SECURITY_ORIGIN" ]] || security=true
    for known in "${ALLOWED_ORIGINS[@]}"; do
      [[ $entry != "$known" ]] || continue 2
    done
    echo "Unattended-Upgrade::Allowed-Origins includes '$entry'"
  done < <(apt-config dump --format '%v%n' Unattended-Upgrade::Allowed-Origins)
  $security ||
    echo "Unattended-Upgrade::Allowed-Origins lacks '$SECURITY_ORIGIN', so no security update would be installed"
  while IFS= read -r entry; do
    if [[ -n $entry ]]; then
      echo "Unattended-Upgrade::Origins-Pattern includes '$entry'"
    fi
  done < <(apt-config dump --format '%v%n' Unattended-Upgrade::Origins-Pattern)
}

# $1 names what is checked, for the messages. The caller sets APT_CONFIG to check the copy.
check_policy() {
  local err problems line
  err=$(apt-config dump 2>&1 >/dev/null) || fail "apt cannot read $1: $err"
  problems=$(policy_problems)
  [[ -n $problems ]] || return 0
  {
    echo "ERROR: $1 breaks the policy:"
    while IFS= read -r line; do echo "  $line"; done <<<"$problems"
    echo "Another file in /etc/apt/apt.conf or /etc/apt/apt.conf.d sets these. List entries add up"
    echo "across files; for a single value the file read last wins. Find it with"
    echo "grep -rn '<key>' /etc/apt/apt.conf /etc/apt/apt.conf.d, fix it, then rerun."
  } >&2
  exit 1
}

# A copy of apt.conf.d with the new files in it, for check_policy. APT_CONFIG=$tmp/apt.conf makes
# apt read the copy instead of /etc/apt/apt.conf.d.
make_copy() {
  rm -rf "$tmp/apt.conf.d"
  cp -a "$CONF_DIR" "$tmp/apt.conf.d"
  cp "$tmp/new/"* "$tmp/apt.conf.d/"
  printf 'Dir::Etc::parts "%s";\n' "$tmp/apt.conf.d" >"$tmp/apt.conf"
}

# Sets saved to a backup of the file $1: the newest existing one if identical, else a new copy.
backup() {
  local name=${1##*/} backups
  backups=("$BACKUP_DIR/$name".*)
  saved=${backups[-1]}
  if [[ -f $saved ]] && cmp -s "$1" "$saved"; then
    return
  fi
  mkdir -p "$BACKUP_DIR"
  saved=$BACKUP_DIR/$name.$stamp
  cp -p "$1" "$saved"
}

[[ $EUID -eq 0 ]] || fail "run as root: sudo bash $0"
# The package defaults, the unit files and apt.systemd.daily were checked for this release only.
[[ -r /etc/os-release ]] || fail "/etc/os-release not found, so the OS is unknown"
# shellcheck source=/dev/null
os=$(. /etc/os-release && echo "${ID:-} ${VERSION_ID:-}")
[[ $os == 'ubuntu 24.04' ]] || fail "this script supports Ubuntu 24.04 only, found '$os'"
[[ -d /run/systemd/system ]] || fail "systemd is not running, but apt's timers are systemd units"
for cmd in systemctl:systemd apt-get:apt apt-config:apt dpkg-query:dpkg debconf-set-selections:debconf \
  cmp:diffutils diff:diffutils; do
  command -v "${cmd%%:*}" >/dev/null || fail "'${cmd%%:*}' not found; install the ${cmd#*:} package"
done

to_unmask=()
for unit in "${UNITS[@]}"; do
  [[ -f $UNIT_DIR/$unit ]] ||
    fail "$UNIT_DIR/$unit not found. apt ships it: apt-get install --reinstall apt, then rerun."
  # A plain unmask leaves a runtime mask in /run in place. is-enabled reports only the mask in /etc
  # when both exist, because /etc takes precedence, so the runtime one is looked up directly.
  if [[ $(readlink "/run/systemd/system/$unit" 2>/dev/null) == /dev/null ]]; then
    fail "$unit is masked in /run/systemd/system (a runtime mask). A plain unmask does not remove" \
      "it, and something may recreate it at boot. Find out where it comes from, remove it with" \
      "systemctl unmask --runtime $unit, then rerun. Nothing was changed."
  fi
  # is-enabled exits non-zero for masked units, so only its output counts.
  if [[ $(systemctl is-enabled "$unit" 2>/dev/null || true) == masked ]]; then
    to_unmask+=("$unit")
    continue
  fi
  fragment=$(systemctl show -P FragmentPath "$unit")
  [[ $fragment == "$UNIT_DIR/$unit" ]] ||
    fail "$unit is loaded from '$fragment' instead of $UNIT_DIR/$unit. Remove that copy, then rerun." \
      "Nothing was changed."
  dropins=$(systemctl show -P DropInPaths "$unit")
  if [[ -n $dropins ]]; then
    echo "WARNING: $unit has drop-ins that change it: $dropins. Check them with: systemctl cat $unit" >&2
  fi
done
timers_pending=false
for timer in "${TIMERS[@]}"; do
  if [[ $(systemctl is-enabled "$timer" 2>/dev/null || true) != enabled ]] ||
    ! systemctl is-active --quiet "$timer"; then
    timers_pending=true
  fi
done

install_package=false
if installed unattended-upgrades; then
  echo "unattended-upgrades $(dpkg-query -W -f='${Version}' unattended-upgrades) is installed."
else
  install_package=true
fi

stamp=$(date +%Y%m%d%H%M%S)
changes=()
on_exit() {
  local status=$?
  trap '' HUP INT TERM
  rm -rf "$tmp"
  if ((status != 0 && ${#changes[@]})); then
    echo "The script stopped after these changes:" >&2
    printf '  - %s\n' "${changes[@]}" >&2
    echo "Fix the error above and rerun, or undo them (docs/VPS_UNATTENDED_UPGRADES.md, Rollback)." >&2
  fi
}
tmp=$(mktemp -d)
trap on_exit EXIT
# A dropped SSH session sends SIGHUP. The traps turn signals into an exit, so on_exit still reports.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$tmp/new"
cat >"$tmp/new/${AUTO_FILE##*/}" <<'EOF'
// Managed by scripts/configure-unattended-upgrades.sh (docs/VPS_UNATTENDED_UPGRADES.md in the
// nimuairy repository). A rerun shows any manual change and asks before replacing it.
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
// unattended-upgrade downloads what it installs by itself. "1" would download every upgradable
// package, including those from -updates, Docker and NodeSource.
APT::Periodic::Download-Upgradeable-Packages "0";
APT::Periodic::AutocleanInterval "0";
EOF
cat >"$tmp/new/${POLICY_FILE##*/}" <<'EOF'
// Managed by scripts/configure-unattended-upgrades.sh (docs/VPS_UNATTENDED_UPGRADES.md in the
// nimuairy repository). A rerun shows any manual change and asks before replacing it.
// Read after 50unattended-upgrades, so these values win over it. unattended-upgrade defaults the
// first two to true, although 50unattended-upgrades only has them commented out.
Unattended-Upgrade::Remove-Unused-Kernel-Packages "false";
Unattended-Upgrade::Remove-New-Unused-Dependencies "false";
Unattended-Upgrade::Remove-Unused-Dependencies "false";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
# Without the package its 50unattended-upgrades is missing, so this check waits for the install.
if ! $install_package; then
  make_copy
  APT_CONFIG=$tmp/apt.conf check_policy "the configuration with this script's files"
fi

files_pending=()
for file in "$AUTO_FILE" "$POLICY_FILE"; do
  if [[ ! -e $file ]] || ! cmp -s "$tmp/new/${file##*/}" "$file"; then
    files_pending+=("$file")
  fi
done

if $install_package || ((${#files_pending[@]} + ${#to_unmask[@]})) || $timers_pending; then
  echo "Changes to make:"
  if $install_package; then
    echo "- Install unattended-upgrades. Automatic updates stay off until the checks after it pass."
  fi
  for file in "${files_pending[@]}"; do
    if [[ -e $file ]]; then
      echo "- Replace $file (- current, + new):"
      diff -u "$file" "$tmp/new/${file##*/}" || true
    else
      echo "- Create $file:"
      cat "$tmp/new/${file##*/}"
    fi
  done
  if ((${#to_unmask[@]})); then
    echo "- Unmask ${to_unmask[*]}."
  fi
  if $timers_pending; then
    echo "- Enable and start ${TIMERS[*]}. The services then run only when the timers fire."
  fi
  [[ -t 0 ]] || fail "rerun from an interactive shell to confirm these changes; nothing was changed."
  read -r -p "Apply these changes? [y/N] " answer
  if [[ ! $answer =~ ^[Yy]([Ee][Ss])?$ ]]; then
    echo "Nothing was changed."
    exit 1
  fi
fi

if $install_package; then
  # With the default answer, the postinst writes a 20auto-upgrades that turns updates on before the
  # configuration is checked. With "false" it writes none, and unset means off.
  echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean false' | debconf-set-selections
  changes+=("set the debconf answer unattended-upgrades/enable_auto_updates to false")
  echo "Installing: unattended-upgrades"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends unattended-upgrades
  installed unattended-upgrades || fail "unattended-upgrades is not installed after apt-get install"
  command -v unattended-upgrade >/dev/null || fail "'unattended-upgrade' not found after the install"
  changes+=("installed unattended-upgrades $(dpkg-query -W -f='${Version}' unattended-upgrades), with automatic updates off")
  make_copy
  APT_CONFIG=$tmp/apt.conf check_policy "the configuration with this script's files"
fi

# The restrictions go in before 20auto-upgrades turns updates on. A timer that fires in between, or
# a failed second write, then never finds updates on with unattended-upgrade's own defaults.
for file in "$POLICY_FILE" "$AUTO_FILE"; do
  new=$tmp/new/${file##*/}
  if [[ -e $file ]] && cmp -s "$new" "$file"; then
    echo "$file is up to date."
    continue
  fi
  if [[ -e $file ]]; then
    backup "$file"
    install -m 644 "$new" "$file"
    changes+=("replaced $file; the previous version is $saved")
  else
    install -m 644 "$new" "$file"
    changes+=("created $file")
  fi
  echo "${changes[-1]^}."
done
check_policy "the configuration in /etc/apt"

if ((${#to_unmask[@]})); then
  mkdir -p "$BACKUP_DIR"
  printf '%s\n' "${to_unmask[@]}" >"$BACKUP_DIR/masked-units.$stamp"
  systemctl unmask "${to_unmask[@]}"
  changes+=("unmasked ${to_unmask[*]}; $BACKUP_DIR/masked-units.$stamp lists them")
  echo "${changes[-1]^}."
fi
for timer in "${TIMERS[@]}"; do
  # The timers.target.wants link survives a mask, so an unmasked timer may be enabled already.
  if [[ $(systemctl is-enabled "$timer" 2>/dev/null || true) != enabled ]]; then
    systemctl enable --quiet "$timer"
    changes+=("enabled $timer")
    echo "${changes[-1]^}."
  fi
  # Starting a timer only schedules its service. It also clears the failed state a timer is left
  # in when its service gets masked while it runs.
  if ! systemctl is-active --quiet "$timer"; then
    systemctl start "$timer"
    changes+=("started $timer")
    echo "${changes[-1]^}."
  fi
done

for unit in "${UNITS[@]}"; do
  load=$(systemctl show -P LoadState "$unit")
  fragment=$(systemctl show -P FragmentPath "$unit")
  [[ $load == loaded && $fragment == "$UNIT_DIR/$unit" ]] ||
    fail "$unit is '$load' from '$fragment' instead of loaded from $UNIT_DIR/$unit"
done
for timer in "${TIMERS[@]}"; do
  state=$(systemctl is-enabled "$timer" 2>/dev/null || true)
  [[ $state == enabled ]] || fail "$timer is '$state' instead of enabled"
  systemctl is-active --quiet "$timer" || fail "$timer is not active. See: systemctl status $timer"
done
check_policy "the configuration in /etc/apt"
# This service makes a shutdown wait for a running upgrade, so dpkg is not cut off halfway.
state=$(systemctl is-enabled unattended-upgrades.service 2>/dev/null || true)
if [[ $state != enabled ]]; then
  echo "WARNING: unattended-upgrades.service is '${state:-not found}', so a shutdown or restart does" \
    "not wait for a running upgrade. This script leaves it as it is." >&2
fi

systemctl list-timers --all --no-pager "${TIMERS[@]}"
if ((${#changes[@]})); then
  echo "Changes made:"
  printf '  - %s\n' "${changes[@]}"
else
  echo "Nothing changed; everything was already in place."
fi
cat <<'EOF'
Ubuntu security updates are now installed automatically. NEXT above is when each timer fires next,
random delay included. A timer that ran before it was masked catches up within that delay (up to
12h for apt-daily, 60 min for apt-daily-upgrade). Nothing reboots and no package is removed.
See what the next run would install: sudo unattended-upgrade --dry-run --debug
EOF
