# VPS unattended upgrades

The production VPS (Ubuntu 24.04 in an unprivileged LXC container on Mikrus) installs Ubuntu
security updates automatically with `unattended-upgrades`.
`scripts/configure-unattended-upgrades.sh` turns this on and checks it. Like
`scripts/configure-ufw.sh` and `scripts/configure-fail2ban.sh`, it is run by hand. The deploy
workflow neither copies nor runs it.

The scope is the operating system's packages from Ubuntu's archive. The application's images are
updated separately (see [APT packages and Docker images](#apt-packages-and-docker-images)).

## Policy

| | What | Set by |
|---|---|---|
| On | Refresh the package lists daily | `APT::Periodic::Update-Package-Lists "1"` |
| On | Install updates from Ubuntu's security pocket daily | `APT::Periodic::Unattended-Upgrade "1"` and the default `Allowed-Origins` |
| On | Schedule both with apt's systemd timers | `apt-daily.timer`, `apt-daily-upgrade.timer` |
| Off | Updates from `noble-updates`, `noble-backports`, `noble-proposed` | Not in `Allowed-Origins` (commented out in `50unattended-upgrades`) |
| Off | Updates from the Docker and NodeSource repositories | Not in `Allowed-Origins` (see [What gets installed](#what-gets-installed)) |
| Off | Download every upgradable package in advance | `APT::Periodic::Download-Upgradeable-Packages "0"` |
| Off | Reboot | `Unattended-Upgrade::Automatic-Reboot "false"` |
| Off | Remove packages | `Unattended-Upgrade::Remove-Unused-Kernel-Packages`, `Remove-New-Unused-Dependencies` and `Remove-Unused-Dependencies`, all `"false"` |
| Off | Clean the apt cache | `APT::Periodic::AutocleanInterval "0"`. `CleanInterval`, `MaxAge` and `MaxSize` stay unset, which means off |

### A commented-out option is not always off

`50unattended-upgrades` lists the removal options commented out, with `"true"` for two of them.
They are not off: unattended-upgrades 2.9 (the Ubuntu 24.04 version) defaults
`Remove-Unused-Kernel-Packages` and `Remove-New-Unused-Dependencies` to `true` in its code. Left
unset, every run would remove unused kernels and the dependencies that the run itself left unused.
`Remove-Unused-Dependencies` and `Automatic-Reboot` default to `false`. The script sets all four
explicitly, so the whole policy is in one file and a different default in a later version cannot
change it.

## What gets installed

`Allowed-Origins` does not select security fixes. It selects repositories. unattended-upgrade turns
each entry into an origin and suite, for example `${distro_id}:${distro_codename}-security` into
`o=Ubuntu,a=noble-security`. The entry matches a repository whose `Release` file has
`Origin: Ubuntu` and `Suite: noble-security`. A newer version from a matching repository is
installed, whatever it changes. The script keeps Ubuntu 24.04's default entries:

| Entry | Repository | In practice |
|---|---|---|
| `${distro_id}:${distro_codename}` | `noble`, the release pocket | Frozen since the release, so it brings no upgrades. It lets a security update pull in a new dependency from the release |
| `${distro_id}:${distro_codename}-security` | `noble-security` | The security updates. Now and then it also carries the fix for a regression caused by an earlier security update |
| `${distro_id}ESMApps:${distro_codename}-apps-security`, `${distro_id}ESM:${distro_codename}-infra-security` | Ubuntu Pro (ESM) | Match nothing. These repositories exist only on a machine attached to Ubuntu Pro |

As a result:

- An upgrade happens only if every package it changes comes from an allowed origin. A security
  update that needs a newer dependency from `noble-updates` is kept back, and the log says so.
- If `noble-updates` has an even newer version, the `noble-security` version is installed, provided
  it is newer than the installed one.
- Docker's repository has `Origin: Docker` (and `Suite: noble`), and NodeSource's has
  `Origin: . nodistro`, so neither matches. A third-party repository whose `Release` file claimed
  `Origin: Ubuntu` would match. `apt-cache policy` shows the `o=` and `a=` of every repository.
- Held packages (`apt-mark showhold`) are skipped.

Nothing else downloads packages in advance. `apt-daily.service` runs
`unattended-upgrade --download-only`, which fetches only what the install will need.
`Download-Upgradeable-Packages "1"` would also run `apt-get --download-only dist-upgrade`, which
fetches every upgradable package, including those from `noble-updates`, Docker and NodeSource.

After a successful install, unattended-upgrade deletes the `.deb` files it downloaded in that run
(`Keep-Debs-After-Install` is `false` by default). Other files in `/var/cache/apt/archives` stay,
so this is not cache cleaning. With autoclean off, keeping these downloads would make the cache
grow with every update.

## APT packages and Docker images

| What | Updated by | When |
|---|---|---|
| Ubuntu packages, security fixes (`noble-security`) | unattended-upgrades | Daily, automatically |
| Ubuntu packages, other fixes (`noble-updates`) | You: `sudo apt-get update && sudo apt-get upgrade` | By hand |
| Docker Engine, containerd and the Compose plugin (Docker's repository); Node.js (NodeSource) | You, with the same command | By hand |
| The app's images from GHCR, and the other images in the Compose files | The deploy workflow (`deploy-on-vps.yml`) | On every deploy |

The containers do not use the host's packages. Each image brings its own libraries, so a security
update on the host does not patch a container, and a deploy does not patch the host.

An updated library is used only by processes that start after the update. Services that use it
keep the old copy until they restart. If needrestart is installed, its configuration decides
which services are restarted after an upgrade, and its default `override_rc` list excludes
services whose names start with `docker`.

## Requirements

- Ubuntu 24.04 with systemd. The script refuses other releases: the package defaults, apt's units
  and `apt.systemd.daily` were checked for 24.04 only.
- Root.
- Outbound access to the Ubuntu archive, for the daily runs and for installing the package if it is
  missing (on the VPS it is installed already). UFW allows outgoing traffic
  ([VPS_FIREWALL.md](VPS_FIREWALL.md#policy)).

## Files and units

| Path | Change |
|---|---|
| `/etc/apt/apt.conf.d/20auto-upgrades` | Replaced with the four `APT::Periodic` values from [Policy](#policy). The package manages this file with ucf |
| `/etc/apt/apt.conf.d/52nimuairy-unattended-upgrades` | Created with the four `Unattended-Upgrade` values. apt reads it after `50unattended-upgrades`, so its values win. No package owns it, so no upgrade rewrites it |
| `/etc/apt/apt.conf.d/50unattended-upgrades` | Not changed. Its defaults are the policy |
| `/var/backups/nimuairy-unattended-upgrades/` | `<file>.<YYYYmmddHHMMSS>` before a file is replaced. `masked-units.<YYYYmmddHHMMSS>` lists the units it unmasked. A backup inside `apt.conf.d` would make apt print a notice on every run |
| `apt-daily.service`, `apt-daily-upgrade.service` | Unmasked. The script never starts them; the timers do |
| `apt-daily.timer`, `apt-daily-upgrade.timer` | Unmasked, enabled and started |
| `unattended-upgrades.service` | Not changed. It makes a shutdown wait for a running upgrade, so dpkg is not cut off. The script warns if it is not enabled |
| debconf answer `unattended-upgrades/enable_auto_updates` | Set to `false`, only when the script installs the package. It stays `false`: installing the package by hand later writes no `20auto-upgrades`, so updates stay off until the script runs, and `dpkg-reconfigure unattended-upgrades` offers "No" as its default |

| Timer | Starts | Which runs | When |
|---|---|---|---|
| `apt-daily.timer` | `apt-daily.service` | `apt-get update`, then `unattended-upgrade --download-only` | 06:00 and 18:00, each plus a random delay of up to 12 hours |
| `apt-daily-upgrade.timer` | `apt-daily-upgrade.service` | `unattended-upgrade` | 06:00 plus a random delay of up to 60 minutes |

Both services run `/usr/lib/apt/apt.systemd.daily`, which skips a step that already ran within its
interval (one day). Both timers are `Persistent=true`: a run missed while the VPS was off happens
after the next start, within the same random delay.

## Apply

The script:

1. Checks root, Ubuntu 24.04, systemd and the required commands.
2. Checks the four units. Each must be apt's own file in `/usr/lib/systemd/system`. A unit masked in
   `/etc/systemd/system` is unmasked later. A runtime mask (in `/run/systemd/system`) stops the
   script: a plain unmask does not remove it, and something may recreate it at boot, so find out
   where it comes from first. Drop-ins are listed as a warning.
3. Writes its two files into a copy of `/etc/apt/apt.conf.d` and checks the merged configuration
   apt reads from the copy. The checks are:
   - the values from [Policy](#policy);
   - `APT::Periodic::Enable` unset or `1`;
   - `Allowed-Origins` limited to the four defaults, including the security pocket;
   - no `Origins-Pattern`.

   A file that apt reads later and that changes any of this, for example one that adds
   `-updates`, stops the script before anything changes.
4. Lists the changes, with a diff for each file it replaces, and asks before applying them.
   Without a terminal it refuses. When nothing would change, it does not ask, so a rerun is a check.
5. Installs `unattended-upgrades` if it is missing, without recommended packages. First it answers
   the package's debconf question with "no". With the default "yes", the package would write a
   `20auto-upgrades` that turns updates on before the check; with "no" it writes none. The answer
   stays "no" afterwards (see [Files and units](#files-and-units)). Then the script repeats the
   check from step 3, now with the package's files.
6. Backs up each file that differs, then replaces it. If the newest backup of a file is identical,
   it is reused instead of copied again.
7. Checks the configuration in `/etc/apt`. Unmasks the masked units, then enables and starts the
   timers. It never starts the `.service` units.
8. Checks that all four units load from `/usr/lib/systemd/system`, that both timers are enabled and
   active, and that the configuration still matches. Then it prints `systemctl list-timers` for both
   timers.

If a step fails after a change, the script lists the changes made so far. It does not undo them:
fix the cause and rerun it, or follow [Rollback](#rollback).

Apart from installing `unattended-upgrades` when it is missing, the script never installs,
upgrades or removes a package. It never reboots, and it does not touch SSH, UFW, Fail2ban or
Docker.

To run it:

1. Copy the script from your machine:

   ```bash
   scp -P <ssh-port> scripts/configure-unattended-upgrades.sh <user>@<vps-host>:/tmp/
   ```

2. Run it on the VPS, read the listed changes and answer `y`:

   ```bash
   sudo bash /tmp/configure-unattended-upgrades.sh
   ```

The `NEXT` column at the end shows when each timer fires first. If the timers last ran before they
were masked, the first run catches up within the random delay: within 60 minutes for the upgrade.
If they never ran, the first upgrade is at the next 06:00 plus the delay. Your own apt commands
cannot run at the same time as a timer run. apt's lock makes whichever starts second wait, or
stop with `Could not get lock`.

## Verify

```bash
systemctl list-timers apt-daily.timer apt-daily-upgrade.timer   # NEXT: the next run of each
systemctl status apt-daily.timer apt-daily-upgrade.timer        # enabled, active (waiting)
apt-config dump | grep -E '^(APT::Periodic|Unattended-Upgrade::(Allowed-Origins|Remove|Automatic-Reboot))'
sudo unattended-upgrade --dry-run --debug
```

The dry run reads the same configuration as the real run and installs nothing. In its output:

- `Allowed origins are: o=Ubuntu,a=noble, o=Ubuntu,a=noble-security, o=UbuntuESMApps,a=noble-apps-security, o=UbuntuESM,a=noble-infra-security`
  confirms the origins.
- `Packages that will be upgraded:` lists only packages with a newer version in `noble-security`.
  When there is nothing to do, the line is `No packages found that can be upgraded unattended …`
  instead.

It takes the same lock as a timer run and does not wait for it. During a timer run it exits with
`Lock file is already taken` or `Cache lock can not be acquired`. Run it again once
`systemctl is-active apt-daily.service apt-daily-upgrade.service` no longer shows `active`.

Rerunning the script is the quickest full check. While everything is in place it changes nothing
and ends with `Nothing changed`.

## Inspect

```bash
journalctl -u apt-daily.service -u apt-daily-upgrade.service --since -2d   # each run and its result
sudo less /var/log/unattended-upgrades/unattended-upgrades.log           # installed, kept back, and why
sudo less /var/log/unattended-upgrades/unattended-upgrades-dpkg.log      # dpkg's output per upgrade
ls -l --time-style=long-iso /var/lib/apt/periodic/                       # when each step last ran
cat /var/run/reboot-required.pkgs 2>/dev/null                            # packages that ask for a reboot (see below)
```

logrotate rotates the logs in `/var/log/unattended-upgrades/`.

## No reboot, no removal

- Nothing reboots the VPS or restarts the container (`Automatic-Reboot "false"`). You decide when
  to restart (see [Limitations](#limitations) for what a restart does in LXC). An update that asks
  for a reboot creates `/var/run/reboot-required`, but only if `update-notifier-common` is
  installed: packages such as libc6 call its `notify-reboot-required` only when it is there
  (`dpkg -s update-notifier-common`). Without it, the file never appears, and services that use an
  updated library keep running the old copy until you restart them.
- No package is removed: not unused kernels, not dependencies an upgrade left unused, not older
  unused packages. `apt-get autoremove` stays a manual step.
- The apt cache is not cleaned beyond the downloads described in
  [What gets installed](#what-gets-installed).

## Rollback

This turns automatic updates off and restores the state from before the first run. Use the
**oldest** backups in `/var/backups/nimuairy-unattended-upgrades/`:

```bash
sudo systemctl disable --now apt-daily.timer apt-daily-upgrade.timer
ls /var/backups/nimuairy-unattended-upgrades/
sudo systemctl mask $(cat /var/backups/nimuairy-unattended-upgrades/masked-units.<timestamp>)
sudo cp /var/backups/nimuairy-unattended-upgrades/20auto-upgrades.<timestamp> /etc/apt/apt.conf.d/20auto-upgrades
sudo rm /etc/apt/apt.conf.d/52nimuairy-unattended-upgrades
```

`masked-units.<timestamp>` exists only if the script unmasked units. Without it, skip the `mask`
line. To pause updates without restoring anything, the first line is enough. Running the script
again turns them back on.

`disable --now` stops the timers, not a run in progress. If
`systemctl is-active apt-daily-upgrade.service` says `active`, wait for it to finish. Stopping it
during an install can leave dpkg half-configured.

Then check:

```bash
systemctl list-timers --all apt-daily.timer apt-daily-upgrade.timer   # no NEXT
apt-config dump | grep -E '^APT::Periodic'                             # "0" values again
```

## Limitations

- **LXC and the kernel.** The VPS is an unprivileged LXC container on the provider's kernel and has
  no kernel package of its own (`uname -r` shows the host's kernel). Kernel security updates are the
  provider's job. Restarting the container restarts its processes on the same host kernel; it does
  not apply a kernel update. After an update of libc or systemd, `/var/run/reboot-required` (see
  [No reboot, no removal](#no-reboot-no-removal)) means at most "restart the container".
- **Unknown masks.** It is not known who masked the units. If provider tooling masks them again,
  updates stop silently. After the next container restart, check `systemctl list-timers` and rerun
  the script, which reports any mask.
- **ucf.** Package upgrades and `dpkg-reconfigure unattended-upgrades` pass `20auto-upgrades` to
  ucf. Without a terminal, as in an unattended upgrade, ucf keeps the script's version and saves
  the package's next to it as `20auto-upgrades.ucf-dist`, which apt ignores. Run by hand, it asks.
  If you let it replace the file, rerun the script.
- **`ConditionACPower`.** Both services run only on AC power. systemd counts a machine without
  power-supply information as on AC, which is normal for servers. If the journal says the condition
  check skipped a service, this is why.
- **First run.** The first upgrade can come before the first list refresh, because the refresh has
  a random delay of up to 12 hours. It then uses the lists from the last `apt-get update`.
- **Other updates.** Non-security fixes and updates from Docker and NodeSource are never installed
  automatically (see [APT packages and Docker images](#apt-packages-and-docker-images)). Upgrade
  them by hand regularly.
- **Ubuntu 24.04 only.** The defaults above were checked for unattended-upgrades
  `2.9.1+nmu4ubuntu1`, apt 2.8 and systemd 255.

## Tests

`scripts/configure-unattended-upgrades-test.sh` runs the script in disposable systemd
`ubuntu:24.04` containers. It covers the refusals that must change nothing, conflicting
configuration, a first run on the audited VPS state, reruns, manual edits, a package reconfigure
(ucf), the rollback above, a fresh install and injected failures of `apt-get` and `systemctl`. It needs Docker with privileged
containers and network access, takes a few minutes and changes nothing on the host. Run it after
changing the script:

```bash
bash scripts/configure-unattended-upgrades-test.sh
```
