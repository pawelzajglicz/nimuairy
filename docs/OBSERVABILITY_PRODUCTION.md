# Observability in production

This is the operator guide for the observability stack in `observability/` on the production VPS:
how to deliver it, reach Grafana, inspect, update and troubleshoot it, and what it does and does
not cover. [OBSERVABILITY.md](OBSERVABILITY.md) explains how the stack works; this guide does not
repeat it.

## Contents

- [Status and scope](#status-and-scope) and [Conventions](#conventions)
- [Architecture and invariants](#architecture-and-invariants)
- [Delivering files to the VPS](#delivering-files-to-the-vps)
- [Host configuration and the Grafana secret](#host-configuration-and-the-grafana-secret)
- [Accessing Grafana](#accessing-grafana)
- [Diagnostics without published ports](#diagnostics-without-published-ports)
- [Lifecycle](#lifecycle)
- [Routine checks](#routine-checks)
- [Resources](#resources)
- [Updating images and configuration](#updating-images-and-configuration)
- [Rotating the Grafana password](#rotating-the-grafana-password)
- [Retention, persistent data and data loss](#retention-persistent-data-and-data-loss)
- [Troubleshooting](#troubleshooting)
- [Security and telemetry data](#security-and-telemetry-data)
- [What is monitored, and what is not](#what-is-monitored-and-what-is-not)
- [Open items for S6 and later](#open-items-for-s6-and-later)

## Status and scope

- **The stack has not been deployed to the VPS yet.** Its first deployment is S6, which needs its
  own approval. Nothing in this guide has been run on the VPS.
  - Procedures marked **Verify at S6** depend on facts about the VPS that S6 confirms first.
  - Procedures marked **Not validated** have not been run anywhere.
- **The application is not connected to the stack.** That is S7, a separate stage with its own
  approval and implementation. Until then the stack monitors only itself
  ([What is monitored, and what is not](#what-is-monitored-and-what-is-not)).
- The production configuration is the result of S4b: only Grafana is published, on `127.0.0.1:3000`;
  Grafana's password comes from a secret file; Tempo runs as a non-root user. The decisions and their
  evidence are in [S4b_DESIGN_CONTRACT.md](S4b_DESIGN_CONTRACT.md). Resource limits and their
  evidence are in [VPS_RESOURCE_BUDGET.md](VPS_RESOURCE_BUDGET.md); postponed work is in
  [DEFERRED_WORK.md](DEFERRED_WORK.md); the host firewall is in [VPS_FIREWALL.md](VPS_FIREWALL.md).

## Conventions

- **Where a command runs.** Each block says so:
  - **VPS, read-only**: changes nothing;
  - **VPS, changes runtime state**: starts, stops, restarts or recreates containers, or changes files;
  - **VPS, destructive**: deletes data;
  - **Local**: on the operator's machine, in a clone of the repository.
- **Local commands that build and copy the archive need Bash**: Git Bash or WSL on Windows. They use
  Bash syntax, `sha256sum` and GNU tar, so they do not run in PowerShell. The `ssh` tunnel commands
  are plain OpenSSH.
- **VPS commands run as `deploy`, in `/var/nimuairy-observability`.** That directory belongs to
  `deploy`. The relative paths below (`observability/…`, `scripts/…`) and the production check depend
  on that working directory. The commands assume Bash as `deploy`'s shell (**Verify at S6**).
  - `deploy` runs `docker` through its Docker access, which S6 confirms on the VPS. **Docker access
    is effectively root:** whoever can run `docker` can start a privileged container that mounts the
    host's file system. Treat the `deploy` account and its keys accordingly.
- **Placeholders** in angle brackets must be replaced before a command runs: `<sha>` (a full
  40-character commit SHA), `<service>`, `<ssh-port>`, `<user>`, `<vps-host>`, `<local-port>`. The
  repository records no VPS host, SSH port or login, and neither does this guide.
- **Every production Compose command names exactly two files, in this order**, and nothing else:

  ```bash
  docker compose -f observability/compose.yaml -f observability/compose.prod.yaml <command>
  ```

  - Without the production overlay, Compose would recreate the containers without their limits,
    with the seven development ports published again and with the development password `admin`
    for a new Grafana database ([OBSERVABILITY.md, Resource limits](OBSERVABILITY.md#resource-limits)).
  - **Never add `observability/compose.test.yaml`** on the VPS. It is for CI and local test runs only,
    and publishes five more ports.
  - **Never pass `-p` or set `COMPOSE_PROJECT_NAME`.** The project name `nimuairy-observability`
    comes from `observability/compose.yaml`; another name would start a second stack with new, empty
    volumes.
  - The commands in [OBSERVABILITY.md](OBSERVABILITY.md) that pass only `observability/compose.yaml`
    are for development. So are the repair hints that the smoke test and the proxy outage check
    print. Never run them on the VPS.

## Architecture and invariants

The stack is its own Compose project, `nimuairy-observability`, with six services: Prometheus,
Loki, Tempo, Alloy, `docker-socket-proxy` and Grafana. Its files live in
`/var/nimuairy-observability/observability/`. The application is a separate project in
`/var/nimuairy`, deployed by `.github/workflows/deploy-on-vps.yml`. Starting, stopping or removing
the application does not start, stop or remove the stack, and the reverse.

**Published ports.** The production render publishes exactly one host port: Grafana on
`127.0.0.1:3000`. Prometheus, Loki, Tempo and Alloy have their host ports removed by
`observability/compose.prod.yaml`, and the socket proxy publishes none. The services reach one
another over the Docker networks.

**Unpublished is not unreachable.** A process on the VPS host can still connect to a container's
address on any port it listens on, on internal networks too. Removing the published ports takes
away stable loopback endpoints; it is no isolation boundary against processes or users on the host
([S4b contract, §4.4](S4b_DESIGN_CONTRACT.md#44-what-the-port-policy-protects-and-what-it-does-not)).

**Networks** ([OBSERVABILITY.md, Networks](OBSERVABILITY.md#networks)):

| Network | Members | Carries |
|---|---|---|
| `nimuairy-observability` | Prometheus, Tempo; the backend from S7, which joins it as an external network | Traces to `tempo:4318`; Prometheus's scrape of `backend-nimuairy:9464` (from S7) |
| `nimuairy-observability_stack` | Prometheus, Tempo, Loki, Grafana, Alloy | Grafana's queries; Alloy's pushes to Loki; Prometheus's scrape of Alloy |
| `nimuairy-observability_docker-api` (internal) | Alloy, `docker-socket-proxy` | Alloy's Docker API calls |

Keep the definition of `nimuairy-observability` unchanged: once the backend is attached, Docker
cannot recreate it.

**Volumes**, named `nimuairy-observability_<name>` by Compose:

| Volume | Service | Mounted at | Holds |
|---|---|---|---|
| `prom-data` | prometheus | `/prometheus` | Metrics (TSDB, WAL) |
| `loki-data` | loki | `/loki` | Logs: chunks, index, compactor state |
| `tempo-data` | tempo | `/var/tempo` | Traces: WAL, blocks |
| `grafana-data` | grafana | `/var/lib/grafana` | `grafana.db`: users, the admin password, anything made in the UI |
| `alloy-data` | alloy | `/var/lib/alloy/data` | How far each container's log was read (positions) and Alloy's seed. Not the logs themselves |

**Invariants to keep:**
- every command that creates or recreates containers passes exactly the two production files;
- `observability/compose.test.yaml`, `-p` and `COMPOSE_PROJECT_NAME` are never used on the VPS;
- no port is published besides Grafana's `127.0.0.1:3000`, not even for a diagnosis;
- the `nimuairy-observability` network's definition stays as it is;
- the stack and the application are operated as separate projects.

## Delivering files to the VPS

There is no deployment workflow for the stack. The operator delivers it by hand, as an archive of
two paths from one explicit commit:

- `observability/`;
- `scripts/observability-prod-check.sh`, the production check.

The archive is built from a full commit SHA, never from a branch name: a branch moves, and the
revision on the VPS must stay identifiable.

### Build the archive

**Local, in Bash** (Git Bash or WSL on Windows, not PowerShell). Choose the commit: normally a merge
commit on `master` whose CI passed.

```bash
sha=<sha>
[[ $sha =~ ^[0-9a-f]{40}$ ]] && echo "full SHA" || echo "STOP: not a full 40-character SHA"
git fetch origin
git cat-file -e "$sha^{commit}" && git merge-base --is-ancestor "$sha" origin/master \
  && echo "on origin/master" || echo "STOP: unknown commit, or not on origin/master"
git archive --format=tar -o "nimuairy-observability-$sha.tar" "$sha" observability scripts/observability-prod-check.sh
git get-tar-commit-id < "nimuairy-observability-$sha.tar"
tar -tf "nimuairy-observability-$sha.tar"
sha256sum "nimuairy-observability-$sha.tar"
```

- `git get-tar-commit-id` prints the commit that `git archive` stored in the archive. It must equal
  `$sha`.
- `tar -tf` must list only `observability/…` and `scripts/observability-prod-check.sh`.
- Note the `sha256sum` value for the check on the VPS.

**What the archive contains:**
- **Tracked files only, at that commit.** Ignored files never enter it: `observability/.env` and
  `observability/secrets/` stay on the machine where they are and are never distributed.
- **Repository-relative paths**, such as `observability/compose.yaml`. Extracted into
  `/var/nimuairy-observability`, they give the layout the Compose files and the production check
  expect.
- Text files with LF line endings, also when the archive is built on Windows (`.gitattributes`).

### Copy and extract

**Local, in Bash**, in the same shell as above:

```bash
scp -P <ssh-port> "nimuairy-observability-$sha.tar" <user>@<vps-host>:
```

`scp` puts the file in the home directory of `<user>`, the SSH account. The steps below expect it
in `deploy`'s home directory, readable by `deploy`. So either:
- `<user>` is `deploy`; or
- an administrative account moves the archive to `deploy`'s home and gives it to `deploy` (owner
  `deploy`, readable by it).

Which account the operator connects as is settled at S6
([Open items](#open-items-for-s6-and-later)); this guide assumes neither.

**VPS, changes files**, as `deploy`:

First check the archive:

```bash
cd ~
sha=<sha>
sha256sum "nimuairy-observability-$sha.tar"
tar -tf "nimuairy-observability-$sha.tar"
```

Compare the `sha256sum` with the local value, and check the listing as above. Stop if either
differs. Then extract, in the same shell:

```bash
r=/var/nimuairy-observability/REVISION
if ! (umask 022 && tar -xf "nimuairy-observability-$sha.tar" -C /var/nimuairy-observability); then
  echo "STOP: extraction failed; REVISION not changed" >&2
  false
elif ! { printf '%s %s\n' "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$r.tmp" && mv -f "$r.tmp" "$r"; }; then
  echo "STOP: extracted $sha, but REVISION could not be written; it still names the previous revision" >&2
  false
else
  echo "extracted $sha; REVISION updated"
fi
```

- **Each failure is reported on its own and ends with a non-zero status.** The block ends with
  `false`, not `exit`, so pasted into an interactive shell it does not close the SSH session.
- **A failed extraction never touches `REVISION`.** GNU tar exits non-zero when it reports an error,
  for example a target it cannot open or a file it cannot write.
  - It can still have changed some files before the error, so the disk can hold a mixture of both
    revisions.
  - `REVISION` keeps naming the previous revision, which no longer matches the disk exactly.
  - Fix the cause, then extract the same archive again.
- **A failed `REVISION` write leaves the old marker in place.** The new marker goes to
  `REVISION.tmp` first and replaces `REVISION` only once it is complete. The extracted files are then
  the new revision while `REVISION` still names the previous one. Fix the cause, for example the
  directory's permissions or a full disk, and run the block again. A leftover `REVISION.tmp` is
  harmless.
- The subshell sets `umask 022` for the extraction only. When `deploy` extracts, tar applies the
  umask to the archive's modes (files `0664`, directories and the script `0775`). With `022` the
  files become `0644` and the directories `0755`. The containers' non-root users must be able to
  read their configuration files; a stricter umask, such as `077`, would lock them out.
  **Verify at S6** the resulting owners and modes.
- The extracted files belong to `deploy`. The directory and everything in it must already belong to
  `deploy` (S6 creates it).

**What extraction does and does not do:**
- **It overwrites** each file in the archive that already exists. GNU tar replaces it with a new
  file, so a running container that bind-mounts it keeps reading the old one until it restarts
  ([Lifecycle](#lifecycle)).
- **It never deletes** anything. A file removed from the repository stays on the VPS until the
  operator removes it.
- **It leaves files that are not in the archive alone**, so `observability/.env` and
  `observability/secrets/` survive.
- **Never delete the directory or its contents before extracting**, and use no tar option that
  unlinks or deletes files: that would destroy `observability/.env` and the Grafana secret.
- Extracting changes no container. What the containers run changes only with the steps in
  [Updating images and configuration](#updating-images-and-configuration).

### Check for stale files

**VPS, read-only** (bash):

```bash
cd /var/nimuairy-observability
sha=<sha>
LC_ALL=C comm -13 \
  <(tar -tf ~/"nimuairy-observability-$sha.tar" | sed 's:/$::' | LC_ALL=C sort) \
  <(find observability scripts | LC_ALL=C sort)
```

It lists what is on disk but not in the archive. Expected are only `observability/.env`,
`observability/secrets` and `observability/secrets/grafana_admin_password`. Anything else is left
over from an earlier revision: review each entry, and remove it on its own only if it is obsolete.
Never remove the expected three.

### Identify the deployed revision

**VPS, read-only:**

```bash
cat /var/nimuairy-observability/REVISION
```

`REVISION` holds the SHA of the last archive that was extracted without an error, and the time of
that extraction. The extraction step above writes it, so it is only as reliable as that step.
- **It identifies the files on disk, not what the containers run.** The containers keep their
  configuration until the update steps recreate or restart them
  ([Updating images and configuration](#updating-images-and-configuration)).
- Keep the archive of the current revision and of the previous one in `deploy`'s home, for a
  rollback.

## Host configuration and the Grafana secret

Two untracked files hold what differs per host. Their initial creation belongs to S6.

### The Docker socket's group

`docker-socket-proxy` runs as user `65534` with the Docker socket's group, set as
`DOCKER_SOCKET_GID` in `observability/.env`. Compose reads that file from the project directory,
the directory of the first Compose file, `observability/`.

- **The value** is the socket's numeric group:

  ```bash
  stat -c %g /var/run/docker.sock
  ```

- **The file** holds exactly one line, `DOCKER_SOCKET_GID=<gid>`. Keep everything else out of it:
  Compose also reads its own settings, such as `COMPOSE_PROJECT_NAME`, from a `.env` file.

**VPS, read-only:**

```bash
cd /var/nimuairy-observability
stat -c %g /var/run/docker.sock
grep '^DOCKER_SOCKET_GID=' observability/.env
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml config | grep 65534
```

The last line shows the proxy's `user` as the render has it, `65534:<gid>`. Rendering the stack
prints no password ([S4b contract, §6.6](S4b_DESIGN_CONTRACT.md#66-where-the-value-can-appear-g-a)).
**Verify at S6** that the VPS's Compose reads `observability/.env`: CI never uses that file, it
passes the value through the job's environment.

**A wrong value fails closed:**
- The proxy cannot open the socket. Its log shows `socket not available` with `permission denied`,
  and it exits and restarts.
- It never becomes healthy, so `up --wait` fails, and Alloy, which waits for a healthy proxy, does
  not start.

If the socket's group changes, update the file, then run
`docker compose -f observability/compose.yaml -f observability/compose.prod.yaml up -d --wait --wait-timeout 180`:
the proxy's configuration has changed, so Compose recreates it.

### The Grafana admin password

| | Path |
|---|---|
| Source file, relative to the repository | `observability/secrets/grafana_admin_password` |
| On the VPS | `/var/nimuairy-observability/observability/secrets/grafana_admin_password` |
| In the Grafana container | `/run/secrets/grafana_admin_password` |

Git ignores `observability/secrets/`, so the file is never in the repository or in an archive.

**Requirements:**
- a regular file;
- not empty;
- not the development password `admin`;
- readable by Grafana's user, UID 472, inside the container. Compose bind-mounts the file with the
  host file's owner and mode;
- its parent directory, `observability/secrets/`, has mode `0700`;
- never stored in Git, and never printed.

**The start guard.** The production overlay wraps Grafana's entrypoint. If the file is missing, not
a regular file, unreadable, empty or `admin`, Grafana does not start. Its log then shows one of:
- `FATAL: /run/secrets/grafana_admin_password is missing, not a regular file, unreadable or empty`;
- `FATAL: /run/secrets/grafana_admin_password holds the development password`.

**Verify at S6:**
- the file's owner and mode. S4b leaves two options: `0644` in a `0700` directory owned by `deploy`,
  or `0400` owned by UID 472 ([S4b contract, §6.5](S4b_DESIGN_CONTRACT.md#65-supplying-the-secret));
- that Grafana reads the file through its bind mount with the chosen mode;
- the LXC's mapping of UIDs 472, 473 and 10001;
- that the account running the production check can read the file.

**VPS, read-only**: the file's properties, without its content:

```bash
f=/var/nimuairy-observability/observability/secrets/grafana_admin_password
if [ ! -e "$f" ]; then
  echo "STOP: missing"
elif [ ! -f "$f" ]; then
  echo "STOP: not a regular file"
elif [ ! -r "$f" ]; then
  echo "STOP: not readable by this account"
elif [ ! -s "$f" ]; then
  echo "STOP: empty"
elif grep -qxF admin "$f"; then
  echo "STOP: holds the development password admin"
else
  rc=$?
  if [ "$rc" -eq 1 ]; then
    echo "ok: a non-empty regular file, not admin"
  else
    echo "STOP: grep failed with exit status $rc; nothing is verified"
  fi
fi
stat -c '%F, %s bytes, %U:%G, mode %a' "$f"
stat -c '%U:%G, mode %a' "${f%/*}"
```

- **It prints no content.** `grep -q` prints nothing, and `stat` shows only the type, size, owner
  and mode.
- **Only grep's exit status 1 counts as "not admin".** Status 0 is a match, and anything else is an
  error that verifies nothing. grep runs as an `if` condition, so a shell with `set -e` does not
  exit on its status 1, and `$?` in the `else` branch is grep's status.
- **A line that is exactly `admin` anywhere in the file** counts as a match. That is stricter than
  the start guard, which compares the whole content.
- **"Readable" means readable by the account that runs the check.** With the S4b option of a file
  owned by UID 472 with mode `0400`, `deploy` cannot read it, and the check stops there. Grafana's
  start guard then remains the check for UID 472.

**Handling the password:**
- **The password manager is the source of truth.** The file is a copy that Grafana needs at start.
- **Keep it out of command lines and shell history.** Type or paste it only into `read -rs`, and
  pass it on with the shell's built-in `printf` through a pipe or a redirect. Never as an argument,
  as `curl -u` would.
- **Never print it.** No `cat` of the file, no `set -x` while handling it, no screenshots, no
  pasting into tickets or chats.
- **Never print Grafana's process environment.** The image's start script exports the password to
  Grafana's main process, so `/proc/1/environ` in the Grafana container contains it.
  `docker inspect grafana` shows only the file's path.
- **Changing the file does not change the password.** Grafana uses it only when it creates
  `grafana.db` on an empty `grafana-data` volume. See
  [Rotating the Grafana password](#rotating-the-grafana-password).

## Accessing Grafana

Grafana is reached only through an SSH tunnel to its loopback port on the VPS:

```text
browser on the operator's machine
   |  http://127.0.0.1:<local-port>
local end of the SSH tunnel (bound to 127.0.0.1)
   |  the SSH connection
VPS 127.0.0.1:3000
   |
grafana container
```

**Local**, with OpenSSH:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:<local-port>:127.0.0.1:3000 -p <ssh-port> <user>@<vps-host>
```

For example, with local port `13000`:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:13000:127.0.0.1:3000 -p <ssh-port> <user>@<vps-host>
```

Then open <http://127.0.0.1:13000> and log in as `admin` with the production password, never with
the development `admin`/`admin`. Ctrl-C closes the tunnel.

- **Not local port 3000.** The development stack publishes Grafana on `127.0.0.1:3000`, and Alloy on
  `127.0.0.1:12345`, on the operator's machine. A tunnel on a port that is taken would leave the
  browser talking to the development Grafana. `ExitOnForwardFailure=yes` makes `ssh` exit instead of
  running without the tunnel.
- **The local end is bound to `127.0.0.1`**, so nothing else on the operator's network can use the
  tunnel. `-N` opens no remote shell.
- **No firewall change is needed.** The tunnel runs inside the existing SSH connection and ends on
  the VPS's loopback, and Grafana stays unreachable from the internet
  ([VPS_FIREWALL.md, Policy](VPS_FIREWALL.md#policy)).
- **Verify at S6** that the account used for the tunnel may forward TCP: sshd's
  `AllowTcpForwarding`, and no `restrict`, `no-port-forwarding` or limiting `permitopen` option on
  its key in `authorized_keys`.
- **Verify at S6** that working through a local port other than 3000 has no side effects.
  Grafana's root URL is not configured, so URLs it builds as absolute links, such as share links,
  use its default `http://localhost:3000/`. Opened on the operator's machine, such a link reaches
  the local port 3000, not the tunnel.

**PuTTY.** The same tunnel, configured in a saved session:

1. Session: Host Name `<vps-host>`, Port `<ssh-port>`, connection type SSH.
2. Connection → Data: Auto-login username `<user>`.
3. Connection → SSH → Auth (Credentials in newer versions): the private key file.
4. Connection → SSH: optionally "Don't start a shell or command at all", the equivalent of `-N`.
5. Connection → SSH → Tunnels: Source port `13000`, Destination `127.0.0.1:3000`, Local, then Add.
   Leave "Local ports accept connections from other hosts" unchecked.
6. Save the session, open it, and check in the Event Log (the window menu) that the local port
   forwarding started. PuTTY has no equivalent of `ExitOnForwardFailure`.

## Diagnostics without published ports

Inspect the services from containers that are already on their networks, from Grafana through the
tunnel, and from their logs. Do not publish a port for a diagnosis.

| Service (container) | Networks | Tools in its image | Check (read-only) |
|---|---|---|---|
| grafana | `stack` | `wget`, `curl` | `docker exec grafana wget -qO- http://localhost:3000/api/health`; data sources in the UI |
| prometheus | `nimuairy-observability`, `stack` | busybox `wget`, `nc` | `docker exec prometheus wget -qO- http://localhost:9090/-/ready` |
| loki | `stack` | none (distroless) | `docker exec prometheus wget -qO- http://loki:3100/ready` |
| tempo | `nimuairy-observability`, `stack` | none (distroless) | `docker exec prometheus wget -qO- http://tempo:3200/ready` |
| alloy | `stack`, `docker-api` | a shell, no `wget` or `curl` | `docker exec prometheus wget -qO- http://alloy:12345/-/ready`; its logs |
| docker-socket-proxy | `docker-api` (internal) | — | its health status and logs |

Prometheus is the vantage point because it shares a network with Loki, Tempo and Alloy and its image
has `wget`. A `wget` that exits with an error, for example on a `503`, means the service is not
ready. Loki reports ready only some 15 s after it starts.

**Grafana, through the tunnel:**
- Connections → Data sources: open Prometheus, Loki and Tempo and run each one's test.
- Explore runs queries against each data source, for example `up` in Prometheus.

**Prometheus targets.** **VPS, read-only:**

```bash
docker exec prometheus wget -qO- 'http://localhost:9090/api/v1/targets?state=active'
```

Each target has a `health` and a `lastError`. `prometheus` and `alloy` should be `up`.
`nimuairy-api` is down until S7, because the backend is not on the stack's network.

**Alloy and the socket proxy.** **VPS, read-only:**

```bash
docker logs --since 1h alloy 2>&1 | grep -E 'Unable to refresh target groups|could not inspect container info|could not fetch logs|could not transfer logs|error writing positions file|permission denied'
docker logs --since 1h docker-socket-proxy 2>&1 | grep -E 'blocked request|socket not available'
docker inspect -f '{{.State.Status}} {{.State.Health.Status}} restarts={{.RestartCount}}' docker-socket-proxy
```

What the messages mean is in
[OBSERVABILITY.md, Docker API access](OBSERVABILITY.md#docker-api-access):
- `Unable to refresh target groups` means discovery cannot reach the Docker API.
- `blocked request` lines show what the proxy refused. Alloy should never appear there.
- The proxy accepts only Alloy as a client: any other client gets `403` and a `blocked request`
  line. So there is no simple HTTP check of the proxy from another container.

### Optional: Alloy's UI through an SSH tunnel

**Verify at S6. Not a confirmed procedure.** Alloy's UI listens on port 12345 in its container, and
production publishes no host port for it. Never publish one to reach the UI. The procedure below
relies on the VPS host being able to connect to a container's address on a bridge network. Docker
documents that for Linux, and CI showed a host process reaching the proxy's address on the internal
`docker-api` network. It has not been verified in the VPS's LXC container.

1. **VPS, read-only:** Alloy's current address on the stack network:

   ```bash
   docker inspect -f '{{(index .NetworkSettings.Networks "nimuairy-observability_stack").IPAddress}}' alloy
   ```

2. **Local:** a tunnel from a free local port, here `13345`, to that address:

   ```bash
   ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:13345:<alloy-ip>:12345 -p <ssh-port> <user>@<vps-host>
   ```

3. Open <http://127.0.0.1:13345>. The component `loki.source.docker.containers` shows each target's
   `is_running` and `last_error`.

The address can change whenever the Alloy container is recreated, so read it again before each use.
This adds no published port: sshd on the VPS opens the connection to the container's address
itself. If the procedure fails at S6, use the fallbacks:
- Alloy's logs;
- `up{job="alloy"}` in Prometheus, which scrapes Alloy;
- the readiness check above.

## Lifecycle

All commands run as `deploy` in `/var/nimuairy-observability`.

**VPS, read-only:**

```bash
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml ps -a
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml logs --no-color --tail 200 <service>
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml logs --no-color --since 1h <service>
docker logs --tail 200 <container>
docker inspect -f '{{.Name}} {{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}} started={{.State.StartedAt}}' prometheus loki tempo alloy docker-socket-proxy grafana
```

- The container names are the service names: `prometheus`, `loki`, `tempo`, `alloy`,
  `docker-socket-proxy` and `grafana`.
- The `if` in the template is needed: Loki, Tempo and Alloy have no health check, so they have no
  health status to print.
- **Inspect with a template that names its fields.** A full `docker inspect` of an application
  container prints its secrets, which the application still passes as environment variables
  ([DEFERRED_WORK, S3](DEFERRED_WORK.md#s3--application-secrets-out-of-container-environment-variables)).

**VPS, changes runtime state:**

```bash
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml up -d --wait --wait-timeout 180
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml pull <service>
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml restart <service>
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml stop -t 30 <service>
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml start <service>
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml stop
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml start
```

| Command | What it does |
|---|---|
| `up -d --wait` | Creates the stack, or recreates each service whose configuration or image changed, then waits for health checks. It must always carry both files |
| `pull` | Only downloads images. Running containers change only with the next `up` |
| `restart`, `stop`, `start` | Act on the existing containers, which keep their settings. They do not apply a change to the Compose files |
| `stop` / `start` without a service | Stop or start the whole stack and keep its containers. Nothing is collected while it is stopped |

Rules:
- **Prefer targeted actions.** Restart the one service that has a problem, not the whole stack.
- **`up --wait` is no proof of health.** Loki, Tempo and Alloy have no health check, so `--wait`
  accepts them as soon as they run, even in a crash loop. Check their readiness afterwards
  ([Diagnostics](#diagnostics-without-published-ports)).
- **`up -d <service>`** also starts that service's dependencies.
- **A service stopped by hand stays stopped**, even across a daemon restart or a reboot:
  `restart: unless-stopped` does not restart it. Start it again with `start <service>`.
- **`RestartCount`** counts the restarts that the restart policy made, for example after a crash or
  an OOM kill of the main process. Use it as a trend: compare two readings, and note the time of
  any `start`, `stop` or `restart` you run by hand. How a manual operation affects the count is not
  verified here, so do not read a change in it right after one as a crash.
- **Changed configuration files need a restart.** Compose does not notice changes inside the
  bind-mounted configuration files, and a container keeps reading the file it started with. After a
  new archive changes one of them, restart its service:

  | Changed file | Then |
  |---|---|
  | `observability/compose.yaml`, `observability/compose.prod.yaml`, or `observability/.env` | `up -d --wait --wait-timeout 180` |
  | `observability/prometheus/prometheus.yml` | `restart prometheus` (it has no HTTP reload: the lifecycle API is off) |
  | `observability/loki/loki-config.yaml` | `restart loki` |
  | `observability/tempo/tempo.yaml` | `restart tempo` |
  | `observability/alloy/config.alloy` | `restart alloy` |
  | `observability/grafana/provisioning/…` | `restart grafana` |
  | `observability/compose.test.yaml`, `scripts/observability-prod-check.sh` | Nothing: neither is used by the running stack |

  **Verify at S6** that a restart picks up a file the extraction replaced.

**VPS, destructive. Do not use for routine maintenance.**

| Command | Removes | Keeps |
|---|---|---|
| `docker compose -f observability/compose.yaml -f observability/compose.prod.yaml down` | The six containers and the stack's three networks, including `nimuairy-observability` | The named volumes, so the data comes back with the next `up` |
| `docker compose -f observability/compose.yaml -f observability/compose.prod.yaml down -v` | The same, **and the five named volumes: every metric, log, trace and all Grafana state, without a backup** | Nothing of the stack's data |

- **Use `stop` for a temporary stop**, not `down`.
- **After S7**, the backend is attached to `nimuairy-observability`. Docker does not remove a network
  that a container still uses, so `down` can then fail to remove it. While the stack is gone, the
  backend's trace export fails. This follows from Docker's behaviour and has not been tested.
- **A new Grafana database after `down -v`** is initialized with the password in the secret file.

## Routine checks

Grouped by risk. Only the first group is meant for routine use.

### Routine, read-only

**VPS, read-only:**

```bash
cd /var/nimuairy-observability
docker compose -f observability/compose.yaml -f observability/compose.prod.yaml ps -a
docker inspect -f '{{.Name}} {{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}} started={{.State.StartedAt}}' prometheus loki tempo alloy docker-socket-proxy grafana
docker exec prometheus wget -qO- http://localhost:9090/-/ready
docker exec prometheus wget -qO- http://loki:3100/ready
docker exec prometheus wget -qO- http://tempo:3200/ready
docker exec prometheus wget -qO- http://alloy:12345/-/ready
docker exec grafana wget -qO- http://localhost:3000/api/health
df -hT /
docker system df
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}\t{{.PIDs}}' prometheus loki tempo alloy docker-socket-proxy grafana
```

- **Expected:** every container `running`, and Prometheus, Grafana and the proxy also `healthy`.
  Every readiness check answers. `restarts=` does not rise between checks. `oomkilled=false`.
- **Prometheus targets and Alloy's logs**: as under
  [Diagnostics](#diagnostics-without-published-ports).
- **Data sources**: Grafana, through the tunnel.
- **Disk use per volume:** `docker system df -v`. It is slower, and prints every image, container
  and volume.
- **Container log files**, an optional check that needs root, because `/var/lib/docker` is readable
  only by root:

  ```bash
  sudo sh -c 'du -sh /var/lib/docker/containers/*/*-json.log' | sort -h | tail
  ```

  Run as `deploy`, it needs `deploy` to have suitable `sudo` access, which is not established
  (**Verify at S6**). Otherwise run it from an administrative account, or leave it out.

### Deliberate: the production check

`scripts/observability-prod-check.sh runtime` verifies the running production stack:
- **P-R1:** Grafana's `127.0.0.1:3000` is the only port binding, and no container uses the host
  network;
- **P-R2:** the removed ports refuse connections on `127.0.0.1`, and Grafana's health endpoint
  answers;
- **P-R3:** Grafana's container environment holds no password;
- **P-R4:** Grafana's login behaves as configured.

**What it does not do:** it starts, stops and recreates no container and changes no Compose file or
other file. It runs Compose's `config` and `ps` on the two production files, `docker inspect` and
`docker port`, opens test connections to `127.0.0.1`, and prints no password
([OBSERVABILITY.md, Resource limits](OBSERVABILITY.md#resource-limits)).

**It is not free of side effects.** It sends real authentication requests to Grafana, listed below.
Its failed `admin:admin` login counts toward Grafana's protection against repeated failed logins for
`admin`, and so can contribute to a temporary lockout of that login.

**VPS, changes no container, but logs in to Grafana:**

```bash
cd /var/nimuairy-observability
bash scripts/observability-prod-check.sh runtime
```

**It is not a health probe.** Run it deliberately, with the operator's approval, for example after
S6's first start or after an update that touched Grafana or the ports. Never schedule it or repeat
it in a loop.
- **Each run logs in to Grafana:**
  - one successful login as `admin`, with the secret file's password;
  - **one failed login with `admin:admin`**;
  - three anonymous requests that must be refused.
- **Grafana limits failed logins per user.** Repeated runs, or runs next to other failed logins,
  can lock the `admin` login for a while. The threshold and the lockout time are not known for this
  configuration.
- **What a run needs:**
  - `bash`, `docker`, `curl`, and coreutils' `timeout` and `od` on the VPS, but no `jq`.
    **Verify at S6.**
  - The working directory `/var/nimuairy-observability`. The check reads the secret file next to
    `observability/compose.yaml`, so the account that runs it must be able to read that file
    (**Verify at S6**, with the file's mode).
  - `GRAFANA_AUTH` and `OBSERVABILITY_COMPOSE_FILES` unset. The first would put the password in the
    environment; the second would point the check at other files.
  - All six services running. A stopped service, the proxy included, fails it.
  - Nothing else on the VPS listening on `127.0.0.1` ports 9090, 3100, 3200, 4317, 4318 or 12345,
    which must refuse connections.

### Never on the VPS

These are CI and local tools. Each needs something production does not have, or changes the
running stack:
- `scripts/observability-smoke-test.sh`, which needs the test overlay's host ports and starts probe
  containers;
- `scripts/observability-proxy-resilience-check.sh`, which stops the socket proxy and pauses all
  log collection while it runs;
- `scripts/observability-exemplar-check.sh`, which needs the development ports and the backend;
- `scripts/observability-limits-check.sh runtime`, which needs `jq` and reads `memory.peak` and
  `pids.peak`. The VPS's kernel provides neither, so it cannot pass there;
- anything that uses `observability/compose.test.yaml`.

CI's checks run on a fresh runner, briefly and almost idle. A green CI run is no evidence about the
VPS.

## Resources

The stack's memory and PID limits are in `observability/compose.prod.yaml`. Their values, evidence
and conditions are in [VPS_RESOURCE_BUDGET.md, Container limits](VPS_RESOURCE_BUDGET.md#container-limits),
and its [Risks](VPS_RESOURCE_BUDGET.md#risks) apply as written.

The read-only checks in this guide are general:
- **`docker stats --no-stream`** is one reading. It shows no peak, and how it counts memory is
  explained in the budget.
- **`oomkilled=` is not enough on its own.** When the kernel kills a child process at the limit, the
  container keeps running and its restart count stays the same. Check `oomkilled=` together with
  `oom` and `oom_kill` in the container cgroup's `memory.events`
  ([OBSERVABILITY.md, Resource limits](OBSERVABILITY.md#resource-limits)). S6 defines how that
  reading is done for the stack.
- **`df -hT /` and `docker system df`** show disk use; the log `du` shows the container log files.
- **Host-level readings**, all read-only: [VPS_RESOURCE_BUDGET.md, Post-upgrade verification](VPS_RESOURCE_BUDGET.md#post-upgrade-verification).

The procedure in
[S4.4 Appendix A.3](S4.4_DESIGN_CONTRACT.md#a3-after-the-app-rollout-s444) applies to the
application's four containers (postgres, backend, frontend, cloudflared), not to the six
observability containers. The stack's own resource verification on the VPS belongs to S6.

## Updating images and configuration

**Nothing deploys the stack automatically:**
- `.github/workflows/deploy-on-vps.yml`, run through `release.yml`, deploys the application only. It
  copies the application's two Compose files and its backup script to `/var/nimuairy`, and never
  touches `/var/nimuairy-observability`.
- Its image cleanup removes only images built from this repository, so the stack's old images stay
  on disk.
- A merged Dependabot PR or a green CI run changes nothing on the VPS.

**Dependabot** proposes image tag bumps for `observability/compose.yaml`, weekly, after a 7-day
cooldown, one PR per image.

**CI's `observability` job** (`.github/workflows/ci.yml`) runs on every push to `master`, nightly at
02:00 UTC and on manual runs. On a pull request it runs when the PR touches any of:
- `observability/`;
- `compose.yaml`, `compose.override.yaml`, `compose.prod.yaml` or `compose.observability*.yaml`;
- the smoke test, the proxy outage check, the limits check or the production check;
- any workflow file.

What the job does:
- **Static checks:** it validates the renders, then runs the static modes of the limits and
  production checks.
- **Phase A:** it starts the stack with the base file, the production overlay and the test overlay.
  It runs the smoke test and the proxy outage check, then the limits check on the running stack.
- **Phase B:** it recreates every container from exactly the two production files. It runs the
  production check's `runtime` and the limits check again, and checks that a trace, Tempo's storage
  and Grafana's password survived.

What it does not cover:
- the backend: it is never started;
- the VPS's engine, kernel and LXC;
- `observability/.env`;
- long runs, retention and real load.

### Update sequence

1. **Choose the change.** Read the image's release notes, and take one image bump at a time. A new
   version can need configuration changes, can need more memory or threads than its limit allows,
   and can change its user or its storage layout.
   [OBSERVABILITY.md, Update](OBSERVABILITY.md#update) lists the known risks:
   - Alloy's Docker API calls and log messages, which the proxy and the outage check depend on;
   - Alloy's and Tempo's users and storage, which existing volumes depend on;
   - Grafana's login messages and its start script, which the production check and the start guard
     depend on;
   - the restart Prometheus needs after a configuration change.
2. **Choose the commit:** a merged commit on `master` whose CI passed.
3. **Local: see what changes** against the deployed revision, taken from `REVISION` on the VPS:

   ```bash
   git diff --stat <deployed-sha> <sha> -- observability scripts/observability-prod-check.sh
   ```

4. **Deliver** the archive ([Delivering files to the VPS](#delivering-files-to-the-vps)).
5. **VPS, changes runtime state:** pull the new image, then apply the change:

   ```bash
   docker compose -f observability/compose.yaml -f observability/compose.prod.yaml pull <service>
   docker compose -f observability/compose.yaml -f observability/compose.prod.yaml up -d --wait --wait-timeout 180
   ```

   `up` recreates the services whose configuration or image changed. Then restart each service whose
   bind-mounted configuration file changed ([Lifecycle](#lifecycle)).
6. **Check the result:**
   - the routine checks: state, readiness, restarts and OOM;
   - the recent logs of the changed service, and the proxy's log for `blocked request` lines from
     Alloy, since some of Alloy's calls happen only at start;
   - Grafana's login and its data sources;
   - Prometheus's targets;
   - `docker stats` against the service's limit;
   - that earlier data is still there, for example in Explore.

   Run the production check only deliberately (see its limits), for example when the change touched
   Grafana or the ports.
7. **Old images** stay on disk. If disk space requires it, remove one specific old image by name
   and tag with `docker image rm`, after the new version runs. No broad image or volume prune.

**Rollback** means delivering the previous revision's archive the same way, then the same steps. No
rollback has been tested, and an image that has already written its volume in a newer format may not
read it after a downgrade.

## Rotating the Grafana password

**The candidate procedure below is Not validated.** It is based on Grafana 13.0.2's source, read but
never run. Do not use it on production before it has been validated, for example in an isolated
environment, before or during S6.

**Three different things:**
- **Initial provisioning.** When Grafana starts on an empty `grafana-data` volume, it creates
  `grafana.db` and stores the secret file's password for `admin`.
- **The password in the existing database.** After that, the database alone decides. Changing the
  secret file, or restarting or recreating Grafana, changes nothing about it.
- **Replacing the file.** After the database's password has been changed, the file must be updated
  to the same value. Otherwise a future empty volume would get the old password, and the production
  check would log in with the wrong one.

**What Grafana 13.0.2's source shows** for
`grafana cli admin reset-admin-password --password-from-stdin`:
- **Input:** it reads one line from stdin and does not trim it. A single-line password with or
  without a final newline is read the same way.
- **Who:** it resets the password of user ID 1, the first admin (`--user-id`), and refuses a user
  who is not an admin.
- **Output:** on success it prints `Admin password changed successfully`. Some failures are not
  reported as errors, so **the exit status alone does not prove that the password changed**.
- **No argument form.** Without `--password-from-stdin` it takes the password as an argument, which
  would put it in the process list. Never use that form.

**Still to validate:**
- how `grafana cli` finds its configuration and database under `docker exec`;
- which user it runs as;
- the password policy it applies;
- its real exit status in each case;
- whether the running server accepts the new password without a restart.

**Candidate procedure. Not validated. VPS, changes the Grafana database.**

1. Generate the new password in the password manager: one line, without whitespace, quotes or
   backslashes. A hex string works, as CI generates one.
2. Write it to a new file next to the current one, without echoing it. The value is typed or pasted
   at the silent prompt:

   ```bash
   d=/var/nimuairy-observability/observability/secrets
   (umask 077 && IFS= read -rs pw && printf '%s' "$pw" > "$d/grafana_admin_password.new")
   ```

3. Feed the file to the CLI on stdin:

   ```bash
   docker exec -i grafana grafana cli admin reset-admin-password --password-from-stdin < "$d/grafana_admin_password.new"
   ```

   Continue only if it printed `Admin password changed successfully`.
4. Log in to Grafana through the tunnel with the new password. A wrong attempt counts as a failed
   login.
5. Give the new file the owner and mode chosen at S6, then replace the old one:

   ```bash
   mv -f "$d/grafana_admin_password.new" "$d/grafana_admin_password"
   ```

**If a step fails:**
- **Before the success message:** the database still has the old password. Keep the old file,
  delete the `.new` file, and do not restart Grafana; a restart does not help.
- **After the success message, if the new login fails:** do not retry blindly; each failure counts
  toward the lockout. Find out which password the database has before changing anything else.

## Retention, persistent data and data loss

| Component | Retention | Where it is set |
|---|---|---|
| Prometheus | 15 days | `--storage.tsdb.retention.time=15d` in `observability/compose.yaml` |
| Loki | 168 hours (7 days) | `limits_config.retention_period`, with `compactor.retention_enabled: true`, in `observability/loki/loki-config.yaml` |
| Tempo | 168 hours (7 days) | `overrides.defaults.compaction.block_retention` in `observability/tempo/tempo.yaml` |

- **These are time limits, not size limits.** Nothing caps how much disk the data uses within that
  time. With the application connected from S7, the amount grows with its traffic.
- **There are no backups of telemetry data**, by design. Data lost from a volume cannot be restored.
- **`scripts/backup-db.sh` backs up the application's PostgreSQL database only**
  ([README, Database backups](../README.md#database-backups)). It contains nothing from the stack.
- **Lost for good when its volume is removed:**
  - every metric, log and trace;
  - Grafana's database, with anything made in the UI and the current admin password;
  - Alloy's positions. Alloy then reads the collected containers' logs again from the start, which
    gives duplicates, or lines Loki rejects as too old.
- **What removes volumes:** `down -v`, `docker volume rm`, and `docker volume prune --all`. After a
  plain `down`, no container uses the stack's volumes any more, so `docker volume prune --all` would
  delete them. Run none of these as maintenance.
- **Container logs grow without a limit.** Docker's JSON log files of the stack's containers have
  no rotation: the Compose files set none, and the VPS's daemon had no rotation options when it was
  last read, on 2026-11-10 ([VPS_RESOURCE_BUDGET.md](VPS_RESOURCE_BUDGET.md#risks)). They grow
  independently of the retention above. **Verify at S6.**
- **Old images accumulate.** Each image bump leaves the old image on disk, because the
  application's deploy does not prune the stack's images.

## Troubleshooting

Start with the read-only checks, look at the one service concerned, and act on that service only.

| Symptom | Read-only checks | What it usually means, and what to do |
|---|---|---|
| A service restarts or stays unhealthy | the `docker inspect` template; `logs --tail 200 <service>`; for Loki, Tempo and Alloy their readiness | Read the first error after the start. Do not restart the whole stack |
| Grafana does not start | `docker logs grafana` | A `FATAL` line from the start guard: fix the secret file (requirements above). A directory at the file's path means the engine created it for a missing file, as seen on Docker Desktop. Restart Grafana afterwards |
| Grafana login refused | Which password the database has (the rotation history) | The database's password is not necessarily the file's ([Rotating](#rotating-the-grafana-password)). Repeated failures lock the login for a while. Do not retry in a loop |
| Grafana unreachable through the tunnel | the `ssh` output; `docker exec grafana wget -qO- http://localhost:3000/api/health` | A local port already in use (`ExitOnForwardFailure` stops `ssh`); TCP forwarding refused for the account; Grafana not running |
| Metrics missing | Prometheus targets | Before S7, `nimuairy-api` is down by design. After a change to `prometheus.yml`, Prometheus needs a restart |
| Traces missing | Tempo readiness; `docker logs tempo` | Before S7 nothing sends traces. `failed to create store: mkdir /var/tempo/wal/blocks: permission denied`, in a restart loop: see the volume row |
| Logs missing | the proxy's health and `blocked request` lines; Alloy's errors | Before S7 no container is labelled for collection. `Unable to refresh target groups`: Alloy cannot reach the Docker API through the proxy |
| The proxy restarts or is unhealthy | `docker logs docker-socket-proxy` | `socket not available` with `permission denied`: `DOCKER_SOCKET_GID` is wrong ([The Docker socket's group](#the-docker-sockets-group)) |
| The proxy is stopped (`exited`) | the `docker inspect` template | A proxy stopped by hand stays stopped: `start docker-socket-proxy` with both files |
| Alloy restarts with a permission error on `positions.yml`, or Tempo loops on `permission denied` | `docker logs alloy`, `docker logs tempo` | The volume holds files written as another user. The migrations in [OBSERVABILITY.md](OBSERVABILITY.md#alloy-volumes-written-by-root) are for development volumes. On production, run no ownership change without a separate, reviewed procedure |
| Disk filling up | `df -hT /`, `docker system df -v`, the log `du` | Container logs, telemetry within its retention, and old images all grow. Remove only specific things. No `down -v`, no broad prune |
| Memory pressure or OOM | `oomkilled=`, `docker stats`, the budget's host readings | A container at its limit. `oom_score_adj: 500` makes the kernel prefer the stack's processes over the application's when the whole VPS runs out of memory. It protects nothing. See [VPS_RESOURCE_BUDGET.md](VPS_RESOURCE_BUDGET.md#risks) |

**Benign at startup**
([OBSERVABILITY.md, Known warnings and limits](OBSERVABILITY.md#known-warnings-and-limits)):
- Prometheus says `--enable-feature=native-histograms` is a no-op.
- Grafana says `GF_FEATURE_TOGGLES_ENABLE` is deprecated. It also logs errors for unused
  provisioning directories and a bundled plugin.
- Loki logs one `empty ring` error while starting.
- Tempo warns that the metrics generator is not configured. About once a minute it logs
  `error calling scheduler … no jobs found`.

Errors that mean lost functionality are the ones under Docker API access and the permission errors
above.

**Known limits that stay open:**
- **Alloy starting while the proxy is down** is untested
  ([DEFERRED_WORK, S3.3b](DEFERRED_WORK.md#s33b--alloy-starting-while-the-socket-proxy-is-down)).
  That happens after a daemon restart or a reboot, when the restart policy starts containers in no
  particular order. Alloy retries the Docker API every 5 s, but what happens in that case was read
  in its source, not tested.
- **The proxy outage check** proves recovery from one controlled stop of 20 to 45 s. It proves
  nothing about other outages, daemon restarts or reboots.

## Security and telemetry data

What production protects, and what it does not:
- **Grafana is the only published endpoint**, on the VPS's loopback, reached through SSH. It
  requires a login: anonymous access and sign-up are off.
- **Unpublished does not mean unreachable** (see [Architecture](#architecture-and-invariants)):
  - processes and users on the VPS host can reach every container's address;
  - Prometheus, Loki and Tempo have no authentication at all;
  - their protection rests on the host having no untrusted users or services, which S6 confirms
    (U8).
- **Never expose a service as a shortcut**, not even briefly: no extra published port, no binding
  on another interface, no firewall rule.
- **The socket proxy is the only service that mounts the Docker socket.** It passes on only the read
  calls Alloy makes, and only from Alloy: listing containers and networks, inspecting a container
  and reading its logs ([Docker API access](OBSERVABILITY.md#docker-api-access)).
- **Docker access is root-equivalent.** That covers the members of the host's `docker` group,
  `deploy` included, and anything else that reaches the Docker API.
- **Through the proxy, Alloy can read the environment and the logs of every container.**
  - The `observability.logs=true` label decides what Alloy collects. It is not a security boundary
    of the Docker API.
  - The application still passes its secrets as environment variables
    ([DEFERRED_WORK, S3](DEFERRED_WORK.md#s3--application-secrets-out-of-container-environment-variables)),
    so a compromised Alloy could read them.
- **Grafana's password** is in Grafana's process environment, not in `docker inspect`. Never print
  it ([The Grafana admin password](#the-grafana-admin-password)).
- **Per-service hardening:**

  | Service | User | `cap_drop: [ALL]` and `no-new-privileges` |
  |---|---|---|
  | alloy | `473:473` | yes |
  | docker-socket-proxy | `65534:<socket group>`, read-only root file system | yes |
  | prometheus, loki, grafana | their images' users (`nobody`, `10001`, `472`) | no: deferred |
  | tempo | `10001:10001` | no: deferred |

  The missing settings are deferred
  ([DEFERRED_WORK, B7](DEFERRED_WORK.md#s4b--capability-drops-and-no-new-privileges-for-tempo-prometheus-loki-and-grafana)).

**Personal data in the telemetry**, from S7:
- server spans record `client.address` and `user_agent.original`;
- the frontend's nginx access logs record a client address for each request. Behind the Cloudflare
  Tunnel the address that nginx sees can be that of the `cloudflared` container rather than the
  visitor's. Which one ends up in the logs is not verified until S7;
- treat collected logs and traces as personal data.

## What is monitored, and what is not

**After S6** (the stack running on the VPS):
- **The stack itself:** Grafana with its three data sources, reached through the tunnel. Prometheus
  scrapes itself and Alloy.
- **`nimuairy-api` down:** the target is configured but stays down, because the backend is not
  connected.
- **No application logs:** Alloy collects only containers labelled `observability.logs=true`, and the
  application's production configuration labels none.
- **No traces:** Tempo receives nothing, because nothing sends to it.
- **No stack logs:** the stack's own containers are not labelled either. Read their logs with
  `docker logs`.

**After S7**, a separate stage with its own design, approval and implementation:
- the backend's traces reach Tempo (`tempo:4318`);
- Prometheus scrapes the backend's metrics (`backend-nimuairy:9464`);
- Alloy collects the backend's and the frontend's logs, as `compose.observability.yaml` labels them,
  if S7 applies that configuration.

S7 needs three things that do not exist yet:
- a production variant of the application's observability overlay (only the development variant
  exists);
- a change to the application's deployment;
- a backend image that contains the OpenTelemetry agent.

**No alerting.** The repository configures none of:
- alert rules, for Prometheus or for Loki;
- an Alertmanager;
- Grafana contact points, notification policies or SMTP.

So nothing notifies the operator. Dashboards and metrics show problems only to someone who looks.

## Open items for S6 and later

| Item | Settled by |
|---|---|
| Compose on the VPS renders exactly Grafana's one port and reads `observability/.env` with the right `DOCKER_SOCKET_GID` | S6, before the first start ([S4b contract, §12.3](S4b_DESIGN_CONTRACT.md#123-dependencies-for-s6-and-s7)) |
| `deploy` owns `/var/nimuairy-observability` and has Docker access; Bash is its shell; the modes extraction leaves (umask) | S6 |
| How the archive reaches `deploy`'s home: `scp` as `deploy`, or as another account followed by a hand-over to `deploy` with a suitable owner and mode. Which SSH account the operator uses is not decided | S6 |
| `sudo` access for the optional container-log size check, for `deploy` or an administrative account | S6 |
| The Grafana secret's owner and mode, its readability by 472 through the bind mount, the LXC mapping of UIDs 472, 473 and 10001, and the production check's access to the file | S6 |
| No existing `nimuairy-observability_*` volumes before the first start (an existing `grafana-data` volume would ignore the secret), and no listener on `127.0.0.1:3000` or the removed ports | S6 |
| SSH forwarding for the account used for tunnels | S6 |
| The Alloy UI tunnel to a container address in the VPS's LXC | S6 |
| That a restart picks up a configuration file the extraction replaced | S6 |
| The production check's tools (`bash`, `docker`, `curl`, `timeout`, `od`), and each of its runs | S6, with the operator's consent per run |
| The `grafana cli admin reset-admin-password --password-from-stdin` procedure | Validation before relying on it, before or during S6 |
| Grafana's failed-login threshold and lockout time | Not determined |
| No untrusted users or services on the host (U8); a public IPv6 address and its firewall (U12) | S6 ([S4b contract, §12.1](S4b_DESIGN_CONTRACT.md#121-unverified-assumptions)) |
| Docker's JSON log rotation and the disk growth of logs, volumes and images | S6, then [VPS_RESOURCE_BUDGET.md, Outstanding verification](VPS_RESOURCE_BUDGET.md#outstanding-verification) |
| The stack's resource limits and use on the VPS | S6 |
| The address nginx logs behind the Cloudflare Tunnel, and the application's telemetry in general | S7 |
| Alloy starting while the proxy is down, after a daemon restart or a reboot | Deferred ([S3.3b](DEFERRED_WORK.md#s33b--alloy-starting-while-the-socket-proxy-is-down)) |
| `cap_drop` and `no-new-privileges` for Prometheus, Loki, Tempo and Grafana | Deferred ([B7](DEFERRED_WORK.md#s4b--capability-drops-and-no-new-privileges-for-tempo-prometheus-loki-and-grafana)) |
| The application's secrets in container environment variables | Deferred ([S3](DEFERRED_WORK.md#s3--application-secrets-out-of-container-environment-variables)) |
