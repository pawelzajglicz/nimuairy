# VPS Fail2ban

Fail2ban on the production VPS (Ubuntu 24.04 on Mikrus) bans source addresses that keep failing
SSH logins. `scripts/configure-fail2ban.sh` installs and configures it. The firewalls in
[VPS_FIREWALL.md](VPS_FIREWALL.md) decide which ports are reachable. Fail2ban decides which
addresses lose access to SSH for a while.

The scope is a single jail, `sshd`. The deploy workflow neither copies nor runs the script. It is
run by hand, like `scripts/configure-ufw.sh`.

## Configuration

The script writes `/etc/fail2ban/jail.d/nimuairy-sshd.local`. It does not edit the package's
`jail.conf`, `jail.local` or Ubuntu's `jail.d/defaults-debian.conf`. Fail2ban reads its file after
`jail.local` and `jail.d/*.conf`, though, so the values below take precedence over `[sshd]`
settings made there.

| Setting | Value | Meaning |
|---|---|---|
| `enabled` | `true` | The jail runs. Ubuntu's package enables it too; the file states it so it is complete on its own |
| `maxretry` | `5` | Failures from one address that trigger a ban |
| `findtime` | `10m` | The window in which failures are counted: 5 failures within 10 minutes mean a ban |
| `bantime` | `15m` | How long a ban lasts. It then ends on its own. Repeat offenders get the same 15 minutes (`bantime.increment` is off) |
| `port` | ports from `sshd -T` (`22` today) | The server port sshd listens on. The provider maps its external SSH port to it, so that is the port banned packets arrive on |
| `backend` | `systemd` | Failures are read from the systemd journal |
| ban action | `nftables` | Ubuntu's default (`defaults-debian.conf`), not set in the file |

The `sshd` filter runs in `normal` mode. An unknown user name (`Invalid user …`) and a wrong
password (`Failed password …`) count as failures. A rejected key on its own does not: sshd logs it
only as `Connection closed by authenticating user … [preauth]`, which the filter ignores. A
connection that offers more keys than sshd's `MaxAuthTries` (6 by default) does count, once, as
`maximum authentication attempts exceeded`. With many keys in an agent, connect with
`IdentitiesOnly yes` and the right key, or five such connections within 10 minutes get you banned.

The port is written out from `sshd -T`, not as `port = ssh`. `ssh` always means `22` (from
`/etc/services`), so after an SSH port change the jail would silently keep guarding the old port.
The script uses the same port detection as `configure-ufw.sh`, so the jail and the UFW rule cover
the same ports.

### Why the journal and not `/var/log/auth.log`

On Ubuntu 24.04, `/var/log/auth.log` exists only if rsyslog is installed. sshd's log is always in
the journal, and the jail matches it there with `_SYSTEMD_UNIT=sshd.service + _COMM=sshd`. The unit
is called `ssh.service` on Ubuntu, but the `_COMM=sshd` alternative matches its entries.

### How it works with UFW

Fail2ban's `nftables` action keeps its bans in its own nftables table, `inet f2b-table`. That
table has a set of banned addresses per IP family (`addr-set-sshd`, `addr6-set-sshd`) and a chain,
`f2b-chain`. The chain hooks into input with a priority just before the regular filter, and has
one `reject` rule per family for the SSH port(s). The rules are added at the first ban.

UFW on Ubuntu 24.04 writes its rules through iptables-nft into separate tables. Neither tool
changes the other's tables. A packet from a banned address is rejected in `f2b-chain` before UFW's
rules see it. Any other packet passes `f2b-chain`, and UFW decides as before. As a result:

- Bans are not shown by `ufw status`. `ufw reload` and `ufw enable` leave them in place.
- `ufw disable` does not lift a ban.
- The reject rule has no exception for established connections. A ban also cuts an open SSH
  session from that address.
- `systemctl stop fail2ban` deletes `inet f2b-table`, which lifts every ban. On the next start,
  bans that have not expired come back from fail2ban's database
  (`/var/lib/fail2ban/fail2ban.sqlite3`).

The `nftables` package is installed only for the `nft` command, which the action runs. Ubuntu's
package recommends `nftables | iptables`, and `iptables` is already there for UFW. So apt does not
install `nft` on its own, and without it every ban fails while the jail still lists the address as
banned. **Never enable `nftables.service`:** its `/etc/nftables.conf` starts with
`flush ruleset`, which would also delete UFW's rules.

## Before you apply

Make sure sshd sees the real client addresses. Mikrus forwards its SSH port to port `22` of the
VPS. If that forwarding replaced the source address with its own, all failures would count against
one address. The first ban would then lock out everyone, including the admin.

```bash
echo "$SSH_CONNECTION"   # without sudo: the first field is the address sshd sees for you
sudo journalctl _COMM=sshd --since -1d | grep -oE '(Invalid user .*|Failed password .*) from [0-9a-f.:]+' |
  awk '{ print $NF }' | sort | uniq -c | sort -rn | head
```

The first address should be your public IP, and the failures should come from many different
public addresses. If they all come from one private address (`10.x`, `172.16.x`–`172.31.x`,
`192.168.x`), do not apply the script.

## Apply

The script:

1. Checks root, Ubuntu 24.04, systemd and the required commands.
2. Reads the SSH port(s) from `sshd -T` and checks that something listens on each one. Then it
   checks that the journal has entries from sshd.
3. Installs only what is missing, without recommended packages:
   - `fail2ban`, version `1.0.2-3ubuntu0.1` or later from `noble-updates` (universe). The
     `1.0.2-3` build from the release pocket does not start on Python 3.12.
   - `nftables`, for `nft`.

   It never upgrades or removes a package.
4. Tests the whole configuration with the new file in a temporary copy of `/etc/fail2ban`
   (`fail2ban-client -t`). Only if that passes does it write
   `/etc/fail2ban/jail.d/nimuairy-sshd.local`:
   - An identical file is left alone.
   - A different file (a manual edit, or a changed SSH port) is shown as a diff and replaced only
     after you confirm. The old version is kept as `nimuairy-sshd.local.bak-<timestamp>`, which
     fail2ban does not load.
   - If `jail.local` or another file in `jail.d` that is read earlier also configures `[sshd]`, the
     script lists it and asks too, because its own file would replace stricter values set there.

   Without a terminal the script refuses whenever it would ask.
5. Enables and starts fail2ban. If the file changed, it restarts fail2ban instead, because a
   reload would keep the old port in the nftables rule. Current bans survive the restart.
6. Checks that the running jail has the values above, reads the journal and uses the `nftables`
   action. A file that overrides them makes the script fail and name the value.
7. Bans `192.0.2.1` and `2001:db8::1`, which are documentation addresses that are never routed.
   It checks that both reach the nftables sets and that the reject rules cover the SSH port(s),
   then unbans them. Because of this test, "Total banned" in the jail status goes up by 2 on
   every run.

It never runs ufw, never changes or restarts sshd, and never enables `nftables.service`.

To run it:

1. Keep your current SSH session open until [Verify](#verify) passes.
2. Copy the script from your machine:

   ```bash
   scp -P <ssh-port> scripts/configure-fail2ban.sh <user>@<vps-host>:/tmp/
   ```

3. Run it on the VPS:

   ```bash
   sudo bash /tmp/configure-fail2ban.sh
   ```

On the first install, the package starts fail2ban with Ubuntu's defaults (the `sshd` jail with a
10-minute ban). That lasts a few seconds, until the script applies its file.

## Verify

1. **SSH.** From a new terminal, open a second SSH connection through the provider-mapped port.
   Close the first session only after the second one works.
2. **Jail.**

   ```bash
   sudo systemctl is-active fail2ban
   sudo fail2ban-client status sshd   # "Journal matches: _SYSTEMD_UNIT=sshd.service + _COMM=sshd"
   ```

3. **Rerun.** Running the script again changes nothing while everything is in place, and repeats
   steps 6 and 7 of [Apply](#apply). That makes it the quickest full check.

## Inspect

```bash
sudo fail2ban-client status sshd          # current failures, banned addresses
sudo fail2ban-client get sshd banned      # banned addresses only
sudo fail2ban-client banned <ip>          # the jails in which <ip> is banned
sudo nft list table inet f2b-table        # what is actually blocked
sudo grep -E 'Ban|Unban' /var/log/fail2ban.log | tail -n 20   # ban history
sudo journalctl -u fail2ban               # service starts and stops
sudo journalctl _COMM=sshd -n 50          # what sshd logged, which is what the jail reads
```

Fail2ban logs to `/var/log/fail2ban.log` (`fail2ban-client get logtarget`), which logrotate rotates.

## Unban

```bash
sudo fail2ban-client set sshd unbanip <ip>
sudo fail2ban-client get sshd banned <ip>   # 0: not banned
```

This removes that one address from the nftables set and from fail2ban's database. There is no need
to stop fail2ban or change UFW.

## Troubleshooting

- **The jail counts no failures.** "Total failed" stays at `0` although the journal shows attempts.
  - `sudo journalctl _COMM=sshd -n 20` must show sshd's lines.
  - `sudo fail2ban-regex systemd-journal sshd` runs the filter over the journal and lists the lines
    it matched and missed.
  - From OpenSSH 9.8 on, sshd logs from a process called `sshd-session`. Ubuntu 24.04 has 9.6, but
    review the journal match after a release upgrade.
- **An address is listed as banned but not blocked,** or the script's test ban fails.
  - Look for `Failed to execute ban jail 'sshd' action 'nftables'` in `/var/log/fail2ban.log`.
  - Check `command -v nft` and `sudo nft list table inet f2b-table`.
  - The VPS is an LXC container that runs on the provider's kernel. If `nft` itself reports a
    kernel error there, only the provider can fix it.
- **fail2ban does not start.** Check `systemctl status fail2ban` and `journalctl -u fail2ban`.
  `No module named 'asynchat'` means the `1.0.2-3` build: run
  `apt-get update && apt-get install --only-upgrade fail2ban`.
- **The script reports a different value.** Fail2ban reads `jail.conf`, `jail.d/*.conf`,
  `jail.local` and then `jail.d/*.local`, each set in alphabetical order. Later files win, so only a
  `jail.d/*.local` file whose name sorts after `nimuairy-sshd.local` can override it.
  `sudo fail2ban-client -d | grep -E "'sshd', '(maxretry|findtime|bantime)'"` shows the merged
  values.

## Recovery

If your own address gets banned:

1. **Wait.** The ban ends on its own after 15 minutes. While it lasts, your packets are rejected
   before they reach sshd, so they do not prolong it.
2. **Use another network.** From a different address, for example a phone hotspot, log in and
   [unban](#unban) your address.
3. **Use the provider console.** If no other network is at hand, log in through the provider
   console in the Mikrus panel. It does not go through SSH, so Fail2ban does not affect it. Run
   `fail2ban-client set sshd unbanip <ip>` there.
4. **Stop fail2ban, as a last resort.** Do this only if fail2ban itself misbehaves, for example
   if it bans the wrong addresses again and again. From the console, run
   `systemctl stop fail2ban`. That lifts all bans and leaves UFW as it is. After fixing the cause,
   run `systemctl start fail2ban`. Bans that have not expired come back, so unban your address
   again if it is among them.

Do not run `ufw disable` because of a ban. UFW does not hold the ban, so disabling it lifts nothing
and opens every port.

## Limitations

- The deploy does not run the script. Rerun it by hand after changing the SSH port: until then the
  jail guards only the old port(s). See the SSH port procedure in
  [VPS_FIREWALL.md](VPS_FIREWALL.md#limitations).
- Bans work only as long as sshd sees the real client addresses (see
  [Before you apply](#before-you-apply)).
- No address is exempt (`ignoreip`). An admin who keeps guessing passwords is banned like anyone
  else.
- Fail2ban slows down password guessing. It does not replace key-only authentication.
- The script supports Ubuntu 24.04 only. The package version, the journal backend and the sshd
  filter were checked for that release.
