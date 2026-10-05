# VPS-DOG agent

A single static Go binary that reports host metrics and latency probes to a
VPS-DOG worker. Standard library only — **zero external dependencies**, so it
builds and runs completely offline.

Protocol reference: [`docs/CONTRACT.md`](../docs/CONTRACT.md) §4.1 and §6.

---

## Build

```bash
go build -o vps-dog .                 # current platform
./build.sh 1.0.0                      # cross-compile everything into dist/
```

```powershell
go build -o dist\vps-dog.exe .        # Windows
.\build.ps1                           # cross-compile everything into dist\
```

`build.sh` / `build.ps1` produce, with `CGO_ENABLED=0` and
`-ldflags "-s -w -X main.Version=<version>"`:

| Target          | Artifact                     |
| --------------- | ---------------------------- |
| linux/amd64     | `vps-dog-linux-amd64`        |
| linux/arm64     | `vps-dog-linux-arm64`        |
| linux/arm (v7)  | `vps-dog-linux-armv7`        |
| linux/386       | `vps-dog-linux-386`          |
| darwin/amd64    | `vps-dog-darwin-amd64`       |
| darwin/arm64    | `vps-dog-darwin-arm64`       |
| windows/amd64   | `vps-dog-windows-amd64.exe`  |

---

## Configure

Copy [`agent.example.yaml`](agent.example.yaml) to `/etc/vps-dog/agent.yaml`
(mode `0600`) and fill in `server` and `token`.

```yaml
server: "https://vps-dog.example.workers.dev"
token: "0123456789abcdef…"     # 64 hex chars from the dashboard
name: "hk-01"
interval: 30
tls_skip_verify: false
```

Precedence: **CLI flag > environment variable > config file > built-in default**.

| Setting           | Flag                | Environment             |
| ----------------- | ------------------- | ----------------------- |
| config path       | `-c <path>`         | `VPSDOG_CONFIG`         |
| `server`          | `-server`           | `VPSDOG_SERVER`         |
| `token`           | `-token`            | `VPSDOG_TOKEN`          |
| `name`            | `-name`             | `VPSDOG_NAME`           |
| `region`          | `-region`           | `VPSDOG_REGION`         |
| `interval`        | `-interval`         | —                       |
| `tls_skip_verify` | `-tls-skip-verify`  | `VPSDOG_TLS_SKIP_VERIFY`|

`VPSDOG_DEBUG=1` prints the raw output of the platform helper commands used on
non-Linux systems.

---

## Install

### One-liner (systemd)

```bash
curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh \
  | sudo bash -s -- -s https://vps-dog.example.workers.dev -t <token>
```

`install.sh` detects the architecture, downloads the matching release binary,
writes `/etc/vps-dog/agent.yaml` and `/etc/systemd/system/vps-dog.service`, then
enables and starts the service. Run it with `-u` to uninstall.

### Built-in installer

If the binary is already on the host:

```bash
sudo vps-dog -install -server https://vps-dog.example.workers.dev -token <token> -name hk-01
sudo vps-dog -uninstall            # keeps /etc/vps-dog/agent.yaml
sudo vps-dog -uninstall -purge     # removes the config directory and the binary
```

Both paths require root **and** a running systemd; otherwise they refuse with a
clear message instead of half-installing.

---

## Flags

| Flag                | Default                    | Description                                                        |
| ------------------- | -------------------------- | ------------------------------------------------------------------ |
| `-c <path>`         | `/etc/vps-dog/agent.yaml`  | Config file to load (a missing file is not an error).              |
| `-server <url>`     | `http://127.0.0.1:8787`    | Worker base URL.                                                   |
| `-token <token>`    | —                          | Agent token issued by the admin API.                               |
| `-name <name>`      | hostname                   | Node display name, sent on first contact.                          |
| `-region <label>`   | —                          | Region label, e.g. `HK`.                                           |
| `-interval <secs>`  | `30`                       | Seconds between reports (clamped to 10..3600).                     |
| `-tls-skip-verify`  | `false`                    | Accept invalid TLS certificates (self-signed workers).             |
| `-once`             | `false`                    | Collect once, print the JSON payload to stdout, and exit.          |
| `-version`          | `false`                    | Print the version and exit.                                        |
| `-install`          | `false`                    | Write the systemd unit + config, then enable and start the service. |
| `-uninstall`        | `false`                    | Stop, disable and remove the systemd unit.                         |
| `-purge`            | `false`                    | With `-uninstall`: also delete the config directory and binary.    |

`-once` never touches the network and works on every platform — it is the
quickest way to check what the agent would report:

```console
$ vps-dog -once
{
  "name": "hk-01",
  "version": "1.0.0",
  "host": { "os": "Ubuntu 24.04", "arch": "x86_64", "region": "HK" },
  "metrics": { "cpu": 12.5, "mem_used": 1073741824, ... }
}
```

---

## How it works

```
collect → probe the tasks the server asked for → POST /api/v1/report → sleep interval
```

- **Loop.** The first run sends no probes: the server's response tells the agent
  which probes to run and how often to report. `interval` from the response is
  clamped to 10..3600 s; on failure the agent backs off 1 s → 2 s → 4 s → … → 60 s
  and keeps retrying. `SIGINT`/`SIGTERM` shut it down cleanly.
- **Linux collection.** `/proc/stat` (CPU delta), `/proc/meminfo`,
  `/proc/net/dev`, `/proc/net/tcp{,6}`, `/proc/net/udp{,6}`, `/proc/uptime`,
  `/proc/loadavg`, the `/proc` process count, and `syscall.Statfs("/")` for the
  root filesystem. `net_in`/`net_out` are cumulative since boot over all
  non-`lo` interfaces; `rx_rate`/`tx_rate` are deltas over the elapsed time and
  are `0` on the first sample.
- **Other platforms.** Degrade gracefully to zeros — never crash. On Windows the
  agent reads memory, disk, uptime, process count, socket counts, cumulative
  network bytes and CPU load through PowerShell (CIM/WMI with .NET, registry and
  performance-counter fallbacks, because CIM is unavailable in some hardened or
  sandboxed environments); on macOS and BSD it uses `sysctl`, `vm_stat`, `df`
  and `ps`. Load averages are only available where the OS provides them.
- **Probes** (`icmp`, `tcp`, `http`) each have a timeout and report `ok` as
  `1`/`0` with `value = -1` on failure. `icmp` uses a raw socket when it has the
  privileges and otherwise falls back to the system `ping` binary.
- **Logging.** Every line is prefixed `[vps-dog]`.

---

## Verify

```bash
gofmt -l .          # prints nothing
go vet ./...
go build ./...
go run . -once      # prints a valid JSON payload on any platform
```
