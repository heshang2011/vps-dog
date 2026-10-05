# Architecture

## Goals and non-goals

**Goals**

1. Run the entire control plane on Cloudflare's free tier — no VPS for the panel.
2. Keep the agent a single static binary with zero runtime dependencies.
3. Store everything in one D1 (SQLite) database, reachable from the Worker.
4. Serve a fast, clean dashboard that works on a phone.
5. Stay small enough that one person can read the whole codebase in an evening.

**Non-goals**

- Long-term metrics retention at high resolution (D1 is not a time-series database).
- Container/process-level introspection (that is what Netdata and Beszel do).
- Alerting pipelines (webhooks/Telegram) — a natural next step, not v1.

## Component map

```
                        ┌──────────────────────────────────────────┐
   agent (Go)           │            Cloudflare Worker             │
 ┌──────────────┐       │  ┌────────────────────────────────────┐  │
 │ collector    │       │  │ Hono router                        │  │
 │  /proc,statfs│       │  │  /api/v1/report   ← agent ingest   │  │
 ├──────────────┤       │  │  /api/status|nodes|groups (public) │  │
 │ probe        │  POST │  │  /api/auth/*      (sessions)       │  │
 │  icmp/tcp/http│─────►│  │  /api/admin/*     (CRUD + audit)   │  │
 ├──────────────┤       │  └──────────────┬─────────────────────┘  │
 │ client       │◄──────│                 │                        │
 │  backoff     │  JSON │  ┌──────────────▼─────────────────────┐  │
 └──────────────┘       │  │ db.ts — D1 prepared statements     │  │
                        │  └──────────────┬─────────────────────┘  │
                        │  ┌──────────────▼─────────────────────┐  │
                        │  │ cron.ts — retention + offline sweep│  │
                        │  └──────────────┬─────────────────────┘  │
                        │                 ▼                        │
                        │           D1 (SQLite)                    │
                        │  ┌────────────────────────────────────┐  │
                        │  │ ASSETS → web/dist (React SPA)      │  │
                        │  └────────────────────────────────────┘  │
                        └──────────────────────────────────────────┘
                                        ▲
                                        │ fetch /api/*
                                  ┌─────┴─────┐
                                  │  Browser  │
                                  └───────────┘
```

## Request paths

### Agent report (the hot path)

1. `POST /api/v1/report` arrives with `Authorization: Bearer <token>`.
2. The Worker hashes the token (`SHA-256`) and looks up `nodes.token_hash`.
   The table is small (one row per server), so this is a sequential scan; add an
   index if you ever monitor thousands of hosts.
3. The metrics sample is validated and coerced: every numeric field defaults to `0`,
   so a partial payload never produces `null`s in the database.
4. One row is written to `metrics` (primary key `(node_id, ts)`), and the denormalised
   `nodes.latest` / `online` / `last_seen` columns are updated in the same batch.
5. Any probe result whose `name + target` is unknown becomes a new `ping_tasks` row for
   that node, so operators can start measuring simply by editing the agent config.
6. The response carries the server's `report_interval` and the node's enabled probes,
   which the agent executes before its next report.

Step 4 is deliberately denormalised: the dashboard reads one row per node instead of
running a correlated subquery over `metrics` for every card.

### Dashboard read

`GET /api/nodes` performs a single `SELECT … FROM nodes ORDER BY sort_order, created_at`,
parses the `latest` JSON blob, computes percentages, and returns everything the grid
needs. `GET /api/nodes/:id/metrics` runs the time-series query, with server-side
downsampling (see below).

## Data model

| Table | Purpose | Growth |
| --- | --- | --- |
| `nodes` | One row per server: identity, token hash, grouping, denormalised latest state | O(servers) |
| `metrics` | One row per report per node | O(servers × reports/day × retention) |
| `ping_tasks` | Probe definitions | O(servers × probes) |
| `ping_records` | One row per probe execution | O(probes × executions/day × retention) |
| `users` / `sessions` | Admin accounts and cookie sessions | tiny |
| `settings` | Key/value site configuration | tiny |
| `audit_logs` | Every admin mutation | tiny |

`metrics` uses `WITHOUT ROWID` with a composite primary key `(node_id, ts)`; range
scans by node and time are index-only, which is what the history endpoint needs.
A secondary index on `ts` supports the retention delete.

### Time and units

- Every timestamp is a Unix epoch in **seconds** (`INTEGER`).
- Byte counts are **bytes**; rates are **bytes per second**; percentages are **0–100**.
- `net_in` / `net_out` are cumulative counters since boot, which is why the
  downsampler aggregates them with `MAX` while averaging the gauges.

## Downsampling

Rendering 24 hours at a 30-second interval would mean 2 880 points — too many to draw
and too many to ship. The rule (contract §3.1):

```
hours <= 6   → raw rows
hours  > 6   → step = ceil(hours * 3600 / 360)
               bucket key = (ts / step) * step
               AVG(cpu, mem, disk, rx_rate, tx_rate, load1)
               MAX(net_in, net_out)
```

The cap of 360 points keeps the largest response under ~40 KB while still resolving
5-minute features over a week.

## Retention and the offline sweep

A cron trigger (`*/5 * * * *`) runs `scheduled()`:

1. `DELETE FROM metrics WHERE ts < now - retention_days*86400`
2. `DELETE FROM ping_records WHERE ts < now - ping_retention_days*86400`
3. `DELETE FROM sessions WHERE expires_at < now`

There is deliberately **no** "mark offline" step. A node's online state is derived
from `last_seen` at read time (`isOnline()` in `db.ts`), so storing a flag would
create a second source of truth that could disagree with the first — and it would
cost a full-table `UPDATE` every five minutes. The `online` field in API responses
is always computed, never read from a column.

Deletes are chunked because D1 rejects statements with more than 100 bound parameters.
The same code is exposed as `POST /api/admin/sweep` for manual runs and for tests.

## Security model

| Concern | Decision |
| --- | --- |
| Passwords | PBKDF2-SHA256, 100 000 iterations, 16-byte random salt, 32-byte derived key, constant-time compare |
| Sessions | 32 random bytes, stored server-side in `sessions`, `HttpOnly; SameSite=Lax; Secure` cookie, 7-day TTL |
| Agent tokens | 32 random bytes (64 hex); only `SHA-256` is stored. The plaintext is displayed once, and `token_hint` (first 8 chars) is kept for the UI |
| CSRF | `SameSite=Lax` on the session cookie is the effective control. CORS reflects any request `Origin` with credentials (so the panel works from a custom domain), which means a preflight is *not* a CSRF defence — do not rely on the content-type check |
| Brute force | Login limited to 10 attempts / 5 min / IP (in-memory per isolate — best effort, documented) |
| Enumeration | Hidden nodes 404 for anonymous callers, and are excluded from public counts |
| Auditability | Every admin mutation records actor, action, target, IP |

Token hashing is the important one: a leaked D1 backup does not let an attacker
impersonate agents.

## Design trade-offs

**Why D1 and not Workers KV / R2 / Durable Objects?**
The workload is relational and query-heavy (range scans, aggregates, joins for
counts). D1 is SQLite with a real query planner, so `GROUP BY`/`AVG` downsampling
happens next to the data. KV has no queries; R2 has no cheap small-row reads;
Durable Objects would be over-engineered and priced per request.

**Why a pull-style probe model?**
The server tells the agent which probes to run on each report (`pings` in the
response). Adding a probe requires no agent restart and no inbound connection to the
monitored host — important when the box is behind NAT.

**Why denormalise `nodes.latest`?**
The dashboard is read far more often than it is written. One row per node makes the
main page a single indexed scan instead of N correlated subqueries.

**Why no ORM?**
The schema is nine tables. Hand-written prepared statements in `db.ts` are easier to
audit and produce exactly the SQL D1 executes — no surprise N+1s.

**Why `run_worker_first = true`?**
The HTML shell must pass through the Worker so the `custom_head` setting can be
injected before `</head>`. Static assets are still served straight from the edge by
the binding, and the settings lookup only happens for `text/html` responses — JS and
CSS requests cost one internal fetch and no D1 query.

## Extension points

- **Alerting.** `scheduled()` already sweeps for offline nodes — hook a webhook or
  Telegram bot there.
- **More collectors.** Add a field to `MetricSample`, a column to `metrics`, and a
  series to `MetricSeries`. The downsampler table is the only other place to touch.
- **Status pages.** `/api/status` and `/api/nodes` are unauthenticated; a static
  page anywhere can render them.
- **Multiple regions.** `nodes.region` and `nodes.group_name` already exist; a region
  filter in the dashboard is a UI-only change.

## Verification strategy

| Layer | How it is checked |
| --- | --- |
| Worker | `vitest` with `@cloudflare/vitest-pool-workers` runs the real Worker against a real (in-memory) D1, covering ingest → dashboard → history → admin CRUD → auth failures |
| SPA | `tsc --noEmit` + `vite build` in CI |
| Agent | `go vet`, `go build`, and a cross-compile matrix in CI; `-once` prints a real payload without network |
| Integration | The Lead runs `wrangler dev` locally, posts a report with `curl`, and confirms the node appears online in `/api/nodes` |
