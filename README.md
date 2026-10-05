# VPS-DOG

<p align="center">
  <b>A lightweight, self-hosted server monitoring tool that runs entirely on Cloudflare's free tier.</b><br>
  <sub>In the spirit of <a href="https://github.com/komari-monitor/komari">Komari</a> and <a href="https://github.com/nezhahq/nezha">Nezha</a> — but with no VPS for the panel, no database server, and no Docker.</sub>
</p>

<p align="center">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white">
  <img alt="D1" src="https://img.shields.io/badge/Database-D1-F38020?logo=cloudflare&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
  <img alt="Go" src="https://img.shields.io/badge/Agent-Go-00ADD8?logo=go&logoColor=white">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-green">
</p>

---

## Why

Traditional panels (Nezha, Komari, Uptime Kuma) need a server to host the panel and a
database next to it. VPS-DOG moves the entire control plane onto **Cloudflare Workers +
D1**, so the panel costs **$0/month**, has no server to patch, and is globally
distributed by default. All you run on your own machines is a **single ~6 MB Go binary**
with zero dependencies.

```
┌──────────────┐   HTTPS POST /api/v1/report   ┌───────────────────────────┐
│   Go agent   │ ────────────────────────────► │  Cloudflare Worker (Hono) │
│  (your VPS)  │ ◄──────────────────────────── │  + D1 (SQLite at edge)    │
└──────────────┘   {ok, interval, pings[]}     └─────────────┬─────────────┘
                                                            │ static assets
                                                ┌───────────▼─────────────┐
                                                │  React SPA (Workers     │
                                                │  Static Assets)         │
                                                └─────────────────────────┘
```

## Features

- **Zero-cost control plane** — Cloudflare Workers free tier + D1 free tier (5 GB).
- **One-line agent install** — `curl … | bash -s -- -s <server> -t <token>`.
- **Real-time metrics** — CPU, memory, swap, disk, network rate + cumulative traffic,
  TCP/UDP sockets, process count, uptime, load average.
- **Latency probes** — ICMP / TCP / HTTP, scheduled by the server and executed by the agent.
- **Beautiful, responsive dashboard** — dark & light themes, live charts, group filter,
  search, 10 s auto-refresh. Works on phones.
- **Chinese + English UI** — auto-detected, switchable.
- **Multi-user admin** — PBKDF2-SHA256 password hashing, HttpOnly cookie sessions,
  `admin` / `viewer` roles enforced server-side, and an audit log.
- **Public JSON API** — build your own status page or bot on top.
- **Automatic retention** — a cron trigger prunes old metrics and probe results;
  nodes are reported offline the moment they go quiet.
- **No external dependencies in the agent** — pure Go stdlib, cross-compiled for
  7 platform/arch combinations.

## Quick start

### 1. Deploy the panel

```bash
git clone https://github.com/heshang2011/vps-dog.git
cd vps-dog

pnpm install
pnpm build                     # builds web/dist

cd worker
npx wrangler login
npx wrangler d1 create vps-dog          # copy the printed database_id into wrangler.toml
npx wrangler d1 migrations apply vps-dog --remote
npx wrangler secret put ADMIN_PASSWORD  # the initial admin password
npx wrangler deploy
```

Open the printed `https://vps-dog.<you>.workers.dev` URL, go to `/admin`, and log in
with `admin` / the password you just set.

> Prefer the dashboard? You can also create the D1 database from the Cloudflare
> dashboard and paste its ID into `worker/wrangler.toml`.

### 2. Add a server

In `/admin/nodes` → **Add node** → copy the token (shown **once**).

### 3. Install the agent

```bash
curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh \
  | sudo bash -s -- -s https://vps-dog.<you>.workers.dev -t <TOKEN> -n hk-01
```

The node appears on the dashboard within ~10 seconds.

<details>
<summary>Manual install</summary>

```bash
# download the binary for your arch from GitHub Releases
sudo mkdir -p /etc/vps-dog
sudo tee /etc/vps-dog/agent.yaml >/dev/null <<'EOF'
server: https://vps-dog.<you>.workers.dev
token:  "<TOKEN>"
name:   "hk-01"
interval: 30
EOF

sudo tee /etc/systemd/system/vps-dog.service >/dev/null <<'EOF'
[Unit]
Description=VPS-DOG monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/vps-dog -c /etc/vps-dog/agent.yaml
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now vps-dog
journalctl -u vps-dog -f
```
</details>

## Repository layout

| Path | What it is |
| --- | --- |
| [`worker/`](worker) | Cloudflare Worker: Hono API, D1 access layer, cron jobs, vitest suite |
| [`web/`](web) | React 19 + Vite + Tailwind v4 SPA (dashboard + admin) |
| [`agent/`](agent) | Go agent: collectors, probes, installer, cross-compile scripts |
| [`docs/`](docs) | [Deployment](docs/DEPLOYMENT.md), [API reference](docs/API.md), [Architecture](docs/ARCHITECTURE.md), [Contributing](docs/CONTRIBUTING.md), [interface contract](docs/CONTRACT.md) |

## Documentation

- **[Deployment guide](docs/DEPLOYMENT.md)** — from zero to a live panel, plus custom domains, backups and cost notes.
- **[HTTP API reference](docs/API.md)** — every endpoint, with `curl` examples.
- **[Architecture](docs/ARCHITECTURE.md)** — how the pieces fit, the data model, and the design decisions.
- **[Contributing](docs/CONTRIBUTING.md)** — dev setup, code style, release process.
- **[Interface contract](docs/CONTRACT.md)** — the frozen cross-component spec.

## Development

```bash
pnpm install

# terminal 1 — Worker API on http://127.0.0.1:8787
pnpm --filter @vps-dog/worker db:migrate:local
pnpm dev:worker

# terminal 2 — Vite dev server with /api proxied to the Worker
pnpm dev

# checks
pnpm typecheck
pnpm test
```

Agent:

```bash
cd agent
go run . -once        # print a sample payload without sending
go build -o dist/vps-dog .
```

## Public status API

```bash
curl https://vps-dog.<you>.workers.dev/api/status
curl https://vps-dog.<you>.workers.dev/api/nodes
curl "https://vps-dog.<you>.workers.dev/api/nodes/<id>/metrics?hours=24"
```

See [`docs/API.md`](docs/API.md) for the full surface.

## Security

- Passwords are stored as PBKDF2-SHA256 (100 000 iterations, per-user salt).
- Sessions are random 32-byte ids in an `HttpOnly; SameSite=Lax; Secure` cookie.
- Agent tokens are stored only as SHA-256 hashes; the plaintext is shown once.
- Login is rate-limited (10 attempts / 5 min / IP).
- Every admin mutation is written to an audit log.

Found a vulnerability? Please open a private security advisory rather than a public issue.

## License

[MIT](LICENSE)
