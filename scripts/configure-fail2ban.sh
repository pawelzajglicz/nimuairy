#!/usr/bin/env bash
# Installs Fail2ban and applies the SSH jail (see docs/VPS_FAIL2BAN.md): failed SSH logins are read
# from the systemd journal, and an address with too many is banned on the SSH port(s) through
# nftables. Safe to rerun. It never runs ufw and never changes or restarts sshd. Run as root on the VPS.
set -euo pipefail
# apt-cache output is parsed below and apt translates it. gettext reads LANGUAGE before LC_ALL, so
# both are reset.
export LC_ALL=C LANGUAGE=

# The first Ubuntu 24.04 build that runs on Python 3.12 (LP: #2055114). 1.0.2-3 from the release
# pocket fails to start.
readonly MIN_VERSION=1.0.2-3ubuntu0.1
readonly JAIL_FILE=/etc/fail2ban/jail.d/nimuairy-sshd.local
# Documentation addresses (RFC 5737, RFC 3849). They are never routed, so banning them blocks no one.
readonly TEST_IPV4=192.0.2.1 TEST_IPV6=2001:db8::1

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

installed() {
  [[ $(dpkg-query -W -f='${Status}' "$1" 2>/dev/null) == 'install ok installed' ]]
}

[[ $EUID -eq 0 ]] || fail "run as root: sudo bash $0"
# The package version, the journal backend and the sshd filter were checked for this release only.
[[ -r /etc/os-release ]] || fail "/etc/os-release not found, so the OS is unknown"
# shellcheck source=/dev/null
os=$(. /etc/os-release && echo "${ID:-} ${VERSION_ID:-}")
[[ $os == 'ubuntu 24.04' ]] || fail "this script supports Ubuntu 24.04 only, found '$os'"
[[ -d /run/systemd/system ]] || fail "systemd is not running, but the jail reads sshd's log from its journal"
for cmd in sshd:openssh-server ss:iproute2 journalctl:systemd systemctl:systemd apt-get:apt dpkg-query:dpkg; do
  command -v "${cmd%%:*}" >/dev/null || fail "'${cmd%%:*}' not found; install the ${cmd#*:} package"
done

# The same port detection as configure-ufw.sh, so the jail and the UFW rule cover the same port(s).
# It is repeated rather than shared because each script is copied to the VPS on its own.
# Each listenaddress line of sshd -T ends with the port of a socket sshd listens on, including ports
# set per ListenAddress, which the port lines leave out.
sshd_out=$(sshd -T 2>&1) || fail "sshd -T failed, so the SSH port is unknown: $sshd_out"
mapfile -t ssh_ports < <(awk '$1 == "listenaddress" { sub(/.*:/, "", $2); print $2 }' <<<"$sshd_out" | sort -un)
((${#ssh_ports[@]})) || fail "sshd -T lists no listenaddress, so the SSH port is unknown"
for port in "${ssh_ports[@]}"; do
  [[ $port =~ ^[0-9]+$ ]] || fail "unexpected SSH port '$port' in the sshd -T output"
  # Ubuntu 24.04 normally starts sshd from ssh.socket, which picks up a changed Port only after a
  # daemon-reload and socket restart. Until then sshd -T names a port nothing listens on.
  [[ -n $(ss -Hltn "sport = :$port") ]] ||
    fail "sshd -T reports port $port, but nothing listens on $port/tcp. Make SSH listen there first" \
      "(on Ubuntu 24.04: systemctl daemon-reload && systemctl restart ssh.socket), check it, then rerun."
done
ports=$(IFS=,; echo "${ssh_ports[*]}")

# The sshd filter reads journal entries with _COMM=sshd. If there are none, the jail would never
# count a failed login.
[[ -n $(journalctl -q --no-pager -n 1 _COMM=sshd) ]] ||
  fail "the systemd journal has no entries from sshd, so the jail would never see a failed login." \
    "Check that sshd logs to the journal (journalctl -u ssh) and that journald keeps logs (Storage=), then rerun."

cat <<EOF
SSH port(s) from sshd -T: ${ssh_ports[*]}
Keep this SSH session open. When the script ends, open a second SSH connection and close this one
only after the second one works.
EOF

packages=()
if installed fail2ban; then
  version=$(dpkg-query -W -f='${Version}' fail2ban)
  dpkg --compare-versions "$version" ge "$MIN_VERSION" ||
    fail "fail2ban $version is installed, but versions before $MIN_VERSION fail to start on Ubuntu 24.04." \
      "Upgrade it (apt-get update && apt-get install --only-upgrade fail2ban), then rerun."
else
  packages+=(fail2ban)
fi
# Ubuntu's default ban action is nftables, but the package only recommends "nftables | iptables", and
# ufw already pulls in iptables. Without nft every ban fails, while the jail still lists the address
# as banned.
command -v nft >/dev/null || packages+=(nftables)
if ((${#packages[@]})); then
  echo "Installing: ${packages[*]}"
  apt-get update
  if ! installed fail2ban; then
    candidate=$(apt-cache policy fail2ban | awk '$1 == "Candidate:" { print $2 }')
    if [[ -z $candidate || $candidate == '(none)' ]] || ! dpkg --compare-versions "$candidate" ge "$MIN_VERSION"; then
      fail "apt offers fail2ban '${candidate:-none}', but $MIN_VERSION or later is needed. Enable the" \
        "universe component and the noble-updates pocket, then rerun."
    fi
  fi
  # The recommended whois and python3-pyinotify are not used by this jail.
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
fi
command -v nft >/dev/null || fail "'nft' not found after installing nftables"

lift_test_ban() {
  fail2ban-client set sshd unbanip "$TEST_IPV4" "$TEST_IPV6" >/dev/null || return
  test_ban_active=false
}

# Once the test ban below has started, any exit lifts it: an error, a failed check or a signal (a
# dropped SSH session sends SIGHUP). The signal traps turn a signal into an exit so this runs, and
# further signals are ignored while it does.
cleanup() {
  trap '' HUP INT TERM
  if $test_ban_active && ! lift_test_ban; then
    echo "WARNING: the test ban of $TEST_IPV4 and $TEST_IPV6 could not be lifted. It ends after the" \
      "bantime, or run: fail2ban-client set sshd unbanip $TEST_IPV4 $TEST_IPV6" >&2
  fi
  rm -rf "$tmp"
}
test_ban_active=false
tmp=$(mktemp -d)
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# The new file is tested in a copy of /etc/fail2ban, so the live configuration changes only once the
# whole configuration parses. The test only warns about a wrong value, which is why the values of the
# running jail are checked as well.
cp -a /etc/fail2ban "$tmp/etc"
new=$tmp/etc/jail.d/${JAIL_FILE##*/}
cat >"$new" <<EOF
# Managed by scripts/configure-fail2ban.sh (docs/VPS_FAIL2BAN.md in the nimuairy repository).
# A rerun shows any manual change and asks before replacing it.
[sshd]
enabled  = true
# Ubuntu 24.04 always has sshd's log in the journal. /var/log/auth.log exists only with rsyslog.
backend  = systemd
# The port(s) sshd listens on, from sshd -T. Rerun the script after changing the SSH port.
port     = $ports
maxretry = 5
findtime = 10m
bantime  = 15m
EOF
test_out=$(fail2ban-client -c "$tmp/etc" -t 2>&1) ||
  fail "the fail2ban configuration test failed, so nothing was changed:"$'\n'"$test_out"

changed=true
if [[ -e $JAIL_FILE ]] && cmp -s "$new" "$JAIL_FILE"; then
  changed=false
  echo "$JAIL_FILE is up to date."
else
  confirm=false
  if [[ -e $JAIL_FILE ]]; then
    echo "$JAIL_FILE differs from what this script writes (- current, + new):"
    diff -u "$JAIL_FILE" "$new" || true
    confirm=true
  fi
  # fail2ban reads jail.local and jail.d/*.conf before jail.d/*.local, and jail.d/*.local in name
  # order, so this file wins over the sshd settings in those files. That may weaken stricter values
  # set there, so it needs the same confirmation as a manual edit. defaults-debian.conf only enables
  # the jail.
  overridden=()
  for file in /etc/fail2ban/jail.local /etc/fail2ban/jail.d/*.conf /etc/fail2ban/jail.d/*.local; do
    [[ -f $file && $file != "$JAIL_FILE" && $file != /etc/fail2ban/jail.d/defaults-debian.conf ]] || continue
    [[ $file == /etc/fail2ban/jail.d/*.local && $file > $JAIL_FILE ]] && continue
    if grep -q '^[[:space:]]*\[sshd\]' "$file"; then
      overridden+=("$file")
    fi
  done
  if ((${#overridden[@]})); then
    echo "These files also configure the sshd jail. $JAIL_FILE takes precedence over them, so its"
    echo "enabled, backend, port, maxretry, findtime and bantime replace theirs:"
    printf '  %s\n' "${overridden[@]}"
    confirm=true
  fi
  if $confirm; then
    [[ -t 0 ]] || fail "rerun from an interactive shell to confirm writing $JAIL_FILE; nothing was changed."
    read -r -p "Write $JAIL_FILE? [y/N] " answer
    if [[ ! $answer =~ ^[Yy]([Ee][Ss])?$ ]]; then
      echo "$JAIL_FILE left unchanged."
      exit 1
    fi
  fi
  if [[ -e $JAIL_FILE ]]; then
    # fail2ban reads only *.conf and *.local from jail.d, so the backup is not loaded.
    backup=$JAIL_FILE.bak-$(date +%Y%m%d%H%M%S)
    cp -p "$JAIL_FILE" "$backup"
    install -m 644 "$new" "$JAIL_FILE"
    echo "Replaced $JAIL_FILE. The previous version is $backup."
  else
    install -m 644 "$new" "$JAIL_FILE"
    echo "Created $JAIL_FILE."
  fi
fi

systemctl enable --quiet fail2ban
if ! systemctl is-active --quiet fail2ban; then
  systemctl start fail2ban
elif $changed; then
  # A reload keeps the jail's existing nftables rule, so a changed port would stay unprotected. A
  # restart rebuilds the rule, and fail2ban restores current bans from its database.
  systemctl restart fail2ban
fi
# fail2ban-server is a simple service, so systemctl returns before the jail is up.
for _ in {1..20}; do
  fail2ban-client status sshd >/dev/null 2>&1 && break
  sleep 0.5
done
status=$(fail2ban-client status sshd 2>&1) ||
  fail "the sshd jail is not running: $status. See journalctl -u fail2ban and /var/log/fail2ban.log."

# Only a jail.d/*.local file whose name sorts after this one can override these values.
expect() {
  local want=$1 got
  shift
  got=$(fail2ban-client get sshd "$@" 2>&1) || fail "fail2ban-client get sshd $* failed: $got"
  [[ $got == "$want" ]] ||
    fail "the running sshd jail has $* = '$got' instead of '$want'. A file in /etc/fail2ban/jail.d" \
      "that sorts after ${JAIL_FILE##*/} overrides it; fail2ban-client -d shows the merged configuration."
}
[[ $status == *'Journal matches:'* ]] ||
  fail "the sshd jail does not read the systemd journal. Another file overrides backend in $JAIL_FILE."
# The last line lists the action names, separated by ", ".
actions=$(fail2ban-client get sshd actions)
grep -Eq '(^|, )nftables(,|$)' <<<"${actions##*$'\n'}" ||
  fail "the sshd jail does not use the nftables ban action: $actions"
expect 5 maxretry
expect 600 findtime
expect 900 bantime
expect "$ports" action nftables port

# The jail reporting an address as banned does not prove it is blocked (see the nft check above), so
# the test addresses are looked up in the nftables sets, and the reject rules must cover the SSH
# port(s). nft prints one port as "dport 22" and several as "dport { 22, 2222 }".
if ((${#ssh_ports[@]} == 1)); then
  dport="dport $ports"
else
  dport="dport { ${ports//,/, } }"
fi
# Set before the ban, so a ban that fails halfway is lifted as well.
test_ban_active=true
fail2ban-client set sshd banip "$TEST_IPV4" "$TEST_IPV6" >/dev/null
chain=$(nft list chain inet f2b-table f2b-chain 2>&1) || true
blocked=true
for entry in "addr-set-sshd ip $TEST_IPV4" "addr6-set-sshd ip6 $TEST_IPV6"; do
  read -r set_name family ip <<<"$entry"
  if ! nft get element inet f2b-table "$set_name" "{ $ip }" >/dev/null 2>&1 ||
    ! grep -qF "tcp $dport $family saddr @$set_name reject" <<<"$chain"; then
    blocked=false
  fi
done
lift_test_ban
$blocked ||
  fail "a test ban of $TEST_IPV4 and $TEST_IPV6 did not produce a reject rule for port(s) $ports in" \
    "nftables, so bans would not block SSH. Current chain:"$'\n'"$chain"$'\n'"See the action errors in" \
    "/var/log/fail2ban.log and docs/VPS_FAIL2BAN.md, Troubleshooting."

echo "$status"
cat <<EOF
The sshd jail bans an address for 15m after 5 failed logins within 10m, on port(s) $ports.
A test ban of $TEST_IPV4 and $TEST_IPV6 reached nftables and was lifted.
Now open a second SSH connection. If you get banned, see docs/VPS_FAIL2BAN.md, Recovery.
EOF
