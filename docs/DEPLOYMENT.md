# Deployment guide

Everything below assumes a fresh Cloudflare account. Total setup time: ~10 minutes.
Recurring cost on the free tier: **$0**.

---

## 0. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | ≥ 20 | build the SPA and run Wrangler |
| pnpm | ≥ 9 | workspace package manager |
| Wrangler | ≥ 4 | deploy the Worker and manage D1 |
| Go | ≥ 1.22 | only if you build the agent yourself (prebuilt binaries are on the Releases page) |

```bash
node -v && pnpm -v && npx wrangler --version
```

---

## 1. Clone and build the frontend

```bash
git clone https://github.com/heshang2011/vps-dog.git
cd vps-dog
pnpm install
pnpm build          # emits web/dist — the Worker serves this as static assets
```

> The Worker's `[assets]` binding points at `../web/dist`. Wrangler/Miniflare
> **fails to start** when that directory is missing, so build the SPA before
> running `wrangler dev` or `wrangler deploy`. (The Worker's own fallback page
> only covers the case where the binding is absent entirely, e.g. in tests.)

---

## 2. Create the D1 database

```bash
cd worker
npx wrangler login
npx wrangler d1 create vps-dog
```

Wrangler prints a block like:

```toml
[[d1_databases]]
binding = "DB"
database_name = "vps-dog"
database_id = "8f3c1e2a-...."
```

Paste the real `database_id` into [`worker/wrangler.toml`](../worker/wrangler.toml),
replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

---

## 3. Apply migrations

```bash
npx wrangler d1 migrations apply vps-dog --remote
```

This creates `nodes`, `metrics`, `ping_tasks`, `ping_records`, `users`, `sessions`,
`settings` and `audit_logs`, and seeds the default settings.

Local development uses the same command with `--local` (see §7).

---

## 4. Set the admin password

```bash
npx wrangler secret put ADMIN_PASSWORD
# paste a strong password when prompted
```

If you skip this step, the default bootstrap password is `admin` — **change it
immediately** from `/admin/users` after your first login. The bootstrap account is
created lazily on the first successful login attempt against an empty `users` table.

---

## 5. Deploy

```bash
npx wrangler deploy
```

Output:

```
Uploaded vps-dog (1.23 sec)
  https://vps-dog.<your-subdomain>.workers.dev
  Schedule: */5 * * * *
```

Open the URL, click **Admin**, log in with `admin` + your password.

---

## 6. Add your first server

1. Go to `/admin/nodes` → **Add node**.
2. Give it a name (`hk-01`), a group (`production`) and a region (`HK`).
3. **Copy the token now** — it is shown exactly once. Only its SHA-256 hash is stored.
4. Install the agent:

```bash
curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh \
  | sudo bash -s -- -s https://vps-dog.<your-subdomain>.workers.dev -t <TOKEN> -n hk-01
```

5. `journalctl -u vps-dog -f` should show a report every 30 seconds, and the node
   turns green on the dashboard.

### Configuring latency probes

In `/admin/pings`, add a probe for a node:

| Field | Example | Notes |
| --- | --- | --- |
| type | `tcp` | `icmp`, `tcp` or `http` |
| target | `1.1.1.1:443` | `icmp` → host, `tcp` → `host:port`, `http` → full URL |
| interval | `60` | seconds |

The agent picks up new probes on its next report and starts measuring immediately.

---

## 7. Local development

```bash
# terminal 1 — Worker API
cd worker
npx wrangler d1 migrations apply vps-dog --local
npx wrangler dev --port 8787

# terminal 2 — SPA with /api proxied to 127.0.0.1:8787
pnpm dev
```

Open http://localhost:5173. Bootstrap login works locally too.

To point the agent at your local Worker:

```bash
cd agent
go run . -server http://127.0.0.1:8787 -token <TOKEN> -name dev -once   # dry run
go run . -server http://127.0.0.1:8787 -token <TOKEN> -name dev        # loop
```

---

## 8. Custom domain

1. Cloudflare dashboard → **Workers & Pages** → `vps-dog` → **Settings** → **Domains & Routes**.
2. **Add** → **Custom domain** → `monitor.example.com`.
3. If the zone is on Cloudflare, DNS and the certificate are configured automatically.

Update the agents' `server:` value afterwards, then `sudo systemctl restart vps-dog`.

---

## 9. Backups

D1 export:

```bash
npx wrangler d1 export vps-dog --remote --output backup-$(date +%F).sql
```

Restore into a fresh database:

```bash
npx wrangler d1 create vps-dog-restore
npx wrangler d1 execute vps-dog-restore --remote --file backup-2026-01-01.sql
```

Because metrics are high-volume, a nightly export of `nodes`, `users`, `settings`,
`ping_tasks` and a rolling window of `metrics` is usually enough:

```bash
npx wrangler d1 execute vps-dog --remote --command \
  "SELECT * FROM nodes" --json > nodes.json
```

---

## 10. Tuning & operations

| Setting (`/admin/settings`) | Default | Effect |
| --- | --- | --- |
| `report_interval` | 30 s | How often agents report. Lower = more rows, more D1 writes. |
| `offline_after` | 90 s | Seconds of silence before a node is shown offline. |
| `retention_days` | 30 | Metrics older than this are deleted by the 5-minute cron. |
| `ping_retention_days` | 7 | Same, for probe results. |
| `custom_head` | empty | Raw HTML injected before `</head>` on the SPA shell. |

**Free-tier limits to keep in mind.** D1 allows ~5 M rows read/day and 100 k rows
written/day on the free plan. One node reporting every 30 s writes 2 880 `metrics`
rows/day, **plus one `ping_records` row per configured probe per report** — so a node
with three probes writes roughly 11 500 rows/day. Budget ~8 nodes per 100 k rows/day
with three probes each, or raise `report_interval` to 60 s to double that.

Manual maintenance:

```bash
# force the retention/offline sweep right now
curl -X POST https://vps-dog.<you>.workers.dev/api/admin/sweep -b "vpsdog_session=<id>"

# tail live logs
npx wrangler tail
```

---

## 11. Upgrading

```bash
git pull
pnpm install && pnpm build
cd worker && npx wrangler d1 migrations apply vps-dog --remote && npx wrangler deploy
```

Agents are forward- and backward-compatible with the v1 protocol; upgrading them is
optional. Re-run `install.sh` (or replace the binary and `systemctl restart vps-dog`)
to update.

---

## 12. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Node stays offline | Wrong `server:` URL, wrong token, or outbound HTTPS blocked. Check `journalctl -u vps-dog -n 50`. |
| `401 unauthorized` in agent logs | Token was rotated or the node was deleted. Issue a new token in `/admin/nodes`. |
| Dashboard is blank | `web/dist` was not built before deploy. Run `pnpm build` and redeploy. |
| `/admin` says the password is wrong | The `ADMIN_PASSWORD` secret was set after the user was created — the secret only bootstraps the *first* user. Reset via `DELETE FROM users;` in the D1 console, or add a user directly. |
| `no such table` | Migrations were applied to the wrong database id. Re-check `wrangler.toml`. |
| Charts empty on a fresh node | History needs at least two reports; wait a minute. |
| `D1_ERROR: too many SQL variables` | Only possible if you fork and change the batch size; the built-in sweep chunks writes. |
