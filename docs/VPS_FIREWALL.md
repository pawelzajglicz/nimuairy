# VPS firewall

The production VPS (Ubuntu 24.04 on Mikrus) sits behind two independent firewalls.
`scripts/configure-ufw.sh` manages the second of them.

- **Mikrus provider firewall.** It runs outside the VPS and is configured in the Mikrus panel. It
  lets SSH in through a provider-managed port mapping to server port `22/tcp`, blocks all other
  inbound ports and allows outbound traffic.
- **UFW on the VPS.** This is the host's own netfilter rules. It is defence in depth: if the
  provider firewall is ever opened up or misconfigured, the host still refuses everything except
  SSH.

## Policy

| Traffic | Policy | Why |
|---|---|---|
| Incoming | deny, except TCP to sshd's port (`22` today) | The VPS serves nothing directly. SSH is the only way in |
| Outgoing | allow | cloudflared reaches Cloudflare (port 7844). Images are pulled from GHCR, dhi.io and Docker Hub, backups are uploaded to R2, plus apt, DNS and NTP |
| Routed | deny | The VPS is not a router |
| Logging | low | Blocked packets are logged without flooding the journal |

UFW's IPv6 support is enabled (`IPV6=yes` in `/etc/default/ufw`), so every rule covers IPv4 and
IPv6.

### Why 8000, 8080 and 5432 are not open

| Port | Service |
|---|---|
| 8080 | frontend (nginx) |
| 8000 | backend API |
| 5432 | Postgres |

These are container-internal ports. Opening any of them would bypass Cloudflare as the single
public entry point and put the API, or the database, directly on the internet. Postgres is also
on the internal `backend` network, so only the backend can reach it.

UFW is not what keeps these ports closed. When Docker publishes a container port, its own
iptables rules route that traffic to the container before UFW's rules see it. A published port
would therefore be reachable even though UFW denies it. What keeps the ports closed is that the
production Compose files (`compose.yaml` + `compose.prod.yaml`) publish no host ports. Only the
local dev and observability Compose files do, and they bind them to `127.0.0.1`.

### Why 80 and 443 are not open

The `cloudflared` container opens outbound connections to Cloudflare. Cloudflare terminates
public HTTPS and sends each request down that tunnel, and `cloudflared` forwards it to
`http://frontend:8080` on the Docker network. The VPS never accepts an inbound web connection.

## Inspect

```bash
sudo ufw status verbose     # active or not, defaults, logging, rules
sudo ufw status numbered    # rules with their numbers, for deleting one
sudo ufw show added         # rules as the commands that added them; works while UFW is inactive
sudo sshd -T | grep -E '^(port|listenaddress) '   # the ports sshd is configured for
```

`ufw status` lists each rule twice: an entry marked `(v6)` is the IPv6 copy of a rule, not a
duplicate. An `OpenSSH` rule is different. It is an app-profile rule (`status verbose` shows it as
`22/tcp (OpenSSH)`) and it overlaps a `22/tcp` rule, but ufw treats the two as separate rules.

To remove an overlapping rule by hand, run `sudo ufw delete <number>`. Delete one rule at a time
and run `ufw status numbered` again in between, because the numbers shift after every delete.
Always leave one SSH rule in place.

## Apply

The script:

1. Checks root, the required commands and `IPV6=yes`.
2. Reads the SSH port(s) from `sshd -T`, and checks that something listens on each one.
3. Allows TCP to those ports, with the comment `SSH (port from sshd -T)`.
4. Sets the defaults and logging from [Policy](#policy).
5. If UFW is inactive, asks before enabling it. Without a terminal it refuses to enable it.

It never resets UFW, deletes rules or touches sshd. Rerunning it is safe: ufw skips a rule that
already exists. A rule for the same port that differs only in comment, action or logging is
replaced in place by the plain `allow` rule. Rules for other ports, and app-profile rules such as
`OpenSSH`, are left as they are.

The deploy workflow does not copy this script, so copy it to the VPS yourself:

1. Keep your current SSH session open until [Verify](#verify) passes.
2. Copy the script from your machine:

   ```bash
   scp -P <ssh-port> scripts/configure-ufw.sh <user>@<vps-host>:/tmp/
   ```

3. Run it on the VPS:

   ```bash
   sudo bash /tmp/configure-ufw.sh
   ```

## Verify

1. **SSH.** From a new terminal, open a second SSH connection through the provider-mapped port.
   Close the first session only after the second one works.
2. **App.** Check the exact URL the deploy's smoke test uses: the `SMOKE_URL` variable of the
   `production` GitHub Environment. Replace `<SMOKE_URL>` with its value as it is, including any
   path. As in the smoke test in `deploy-on-vps.yml`, the check passes when `curl -f` succeeds,
   that is, for any status below 400 (redirects are not followed):

   ```bash
   curl -fsS -o /dev/null -w '%{http_code}\n' --max-time 30 '<SMOKE_URL>'
   ```

3. **Containers.** On the VPS, in `/var/nimuairy`:

   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml ps     # all services healthy
   docker logs --tail 20 cloudflared-nimuairy                 # "Registered tunnel connection"
   docker ps --format '{{.Names}}\t{{.Ports}}'                # no "->": no published ports
   sudo ss -Htlnp | grep -E ':(80|443|8000|8080|5432)\b'      # no output
   ```

## Recovery

UFW keeps established connections, so the session you kept open survives a bad rule. Fix the
problem from that session, either with `sudo ufw allow <port>/tcp` or with `sudo ufw disable`, and
then try a new connection again.

If no session is left, log in through the provider console in the Mikrus panel, run
`ufw disable`, and investigate from there.

## Limitations

- The provider firewall is configured separately in the Mikrus panel. The script can neither see
  it nor change it.
- Changing the SSH port is a manual procedure. First check in the Mikrus panel whether the
  provider's mapping can point at another server port. If it can't, keep `22`. If it can:
  1. Make sshd listen on the new port as well as on `22`. On Ubuntu 24.04 with socket
     activation, that also means `systemctl daemon-reload && systemctl restart ssh.socket`.
  2. Rerun the script, which then allows both ports.
  3. Point the provider's mapping at the new port and check a new connection through it.
  4. Only then remove `22` from sshd. The script never deletes the old `22/tcp` rule, so remove it
     by hand (see [Inspect](#inspect)).
- UFW does not filter Docker-published ports (see
  [Why 8000, 8080 and 5432 are not open](#why-8000-8080-and-5432-are-not-open)).
- The script manages only the SSH rule, the defaults and logging. It leaves other rules alone. If
  an SSH rule for the same port is a `limit` rule, the script turns it into `allow`.
