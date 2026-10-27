#!/usr/bin/env bash
# Applies the VPS firewall baseline with UFW (see docs/VPS_FIREWALL.md): incoming denied except SSH,
# outgoing allowed, routed denied, logging low. Safe to rerun: it never resets UFW or deletes rules,
# and it never changes or restarts sshd. Run as root on the VPS.
set -euo pipefail
# ufw translates its output, and the status check below parses it. ufw uses Python's gettext,
# which reads LANGUAGE before LC_ALL, so both are reset.
export LC_ALL=C LANGUAGE=

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || fail "run as root: sudo bash $0"
for cmd in ufw:ufw sshd:openssh-server ss:iproute2; do
  command -v "${cmd%%:*}" >/dev/null || fail "'${cmd%%:*}' not found; install the ${cmd#*:} package"
done

# With IPV6=no ufw leaves ip6tables alone, so IPv6 traffic would go unfiltered.
[[ -r /etc/default/ufw ]] || fail "/etc/default/ufw not found; is ufw installed?"
ipv6=$(sed -n 's/^IPV6=//p' /etc/default/ufw | tail -n 1 | tr -d '"')
[[ $ipv6 == yes ]] ||
  fail "IPv6 is not enabled for UFW (IPV6=${ipv6:-unset}). Set IPV6=yes in /etc/default/ufw, then rerun."

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

cat <<EOF
SSH port(s) from sshd -T: ${ssh_ports[*]}
Keep this SSH session open. When the script ends, open a second SSH connection and close this one
only after the second one works.
EOF

# The SSH rule goes in before the defaults and before enabling, so deny incoming never applies
# without it. ufw skips a rule that already exists and replaces in place one that differs only in
# comment, action or logging, so reruns add nothing.
for port in "${ssh_ports[@]}"; do
  ufw allow "$port/tcp" comment 'SSH (port from sshd -T)'
  added=$(ufw show added)
  grep -Eq "^ufw allow $port/tcp( |$)" <<<"$added" ||
    fail "the rule allowing $port/tcp is missing after adding it; defaults and enabling were skipped"
done

ufw default deny incoming
ufw default allow outgoing
ufw default deny routed
ufw logging low

# Captured rather than piped into grep -q: with pipefail, grep quitting early could fail the pipe.
ufw_status=$(ufw status)
if [[ $ufw_status == 'Status: active'* ]]; then
  echo "UFW is already active."
else
  [[ -t 0 ]] || fail "UFW is inactive. Rerun from an interactive shell to confirm enabling it; the rules" \
    "and defaults above are saved."
  read -r -p "UFW is inactive. Enable it now, with SSH allowed on port(s) ${ssh_ports[*]}? [y/N] " answer
  if [[ ! $answer =~ ^[Yy]([Ee][Ss])?$ ]]; then
    echo "UFW left inactive; the rules and defaults above are saved and apply once it is enabled."
    exit 1
  fi
  # --force skips ufw's own prompt, answered above.
  ufw --force enable
fi

ufw status verbose
echo "Now open a second SSH connection. If it fails, fix UFW from this session (docs/VPS_FIREWALL.md, Recovery)."
