# VPS-DOG — Interface Contract (v1)

> **This file is the single source of truth for cross-component interfaces.**
> Every teammate MUST implement exactly what is specified here. If you believe a
> change is required, message the Lead — do not silently diverge.

VPS-DOG is a lightweight server monitoring tool (in the spirit of Komari / Nezha)
that runs **entirely on Cloudflare Workers** with **D1** as the datastore.
A tiny Go agent reports metrics; a React SPA renders a clean dashboard.

```
┌─────────────┐   HTTPS POST /api/v1/report    ┌──────────────────────┐
│  Go agent   │ ─────────────────────────────► │  CF Worker (Hono)    │
│  (any VPS)  │ ◄───────────────────────────── │  + D1 (SQLite)       │
└─────────────┘   {ok, interval, pings[]}      └──────────┬───────────┘
                                                          │ static assets
                                              ┌───────────▼───────────┐
                                              │  React SPA (Workers   │
                                              │  Static Assets)       │
                                              └───────────────────────┘
```

---

## 1. Repository layout

```
VPS-DOG/
├── worker/                 # Cloudflare Worker (TypeScript, Hono)  [owner: worker-backend]
│   ├── src/
│   │   ├── index.ts        # entry: fetch + scheduled handlers
│   │   ├── router.ts       # app assembly + asset fallback
│   │   ├── db.ts           # D1 access layer + typed row mappers
│   │   ├── types.ts        # Env, DTOs, shared types
│   │   ├── auth.ts         # session + bearer auth, password hashing
│   │   ├── util.ts         # id, json, time, validation helpers
│   │   ├── cron.ts         # retention / offline sweep
│   │   └── routes/
│   │       ├── agent.ts    # /api/v1/report  (agent ingest)
│   │       ├── public.ts   # /api/nodes, /api/status, ...
│   │       └── admin.ts    # /api/auth/*, /api/admin/*
│   ├── migrations/         # 0001_init.sql ...  [APPLIED IN FILENAME ORDER]
│   ├── test/               # vitest + @cloudflare/vitest-pool-workers
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
├── web/                    # React 19 + Vite + TypeScript SPA  [owner: web-frontend]
│   ├── src/
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
├── agent/                  # Go agent  [owner: go-agent]
│   ├── main.go
│   ├── go.mod
│   ├── internal/
│   └── build.sh / build.ps1
├── docs/                   # [owner: docs-devops]
├── .github/workflows/      # [owner: docs-devops]
├── README.md               # [owner: lead]
└── LICENSE                 # [owner: lead]  MIT
```

**Write-scope rule:** each teammate writes ONLY inside their own directory.
Root-level files (`README.md`, `LICENSE`, `.gitignore`, `docs/`) are owned by the
Lead / docs-devops. Never edit another owner's files.

---

## 2. D1 schema (migration `0001_init.sql`)

All timestamps are **Unix epoch seconds (INTEGER)**. All byte sizes are
**bytes (INTEGER)**. Percentages are **0–100 REAL**.

```sql
PRAGMA foreign_keys = ON;

-- ── servers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,          -- uuid v4
  name        TEXT NOT NULL,             -- display name (unique, user-set)
  token_hash  TEXT NOT NULL,             -- sha256 hex of the agent token
  token_hint  TEXT NOT NULL DEFAULT '',  -- first 8 chars, for UI display only
  group_name  TEXT NOT NULL DEFAULT 'default',
  region      TEXT NOT NULL DEFAULT '',  -- free text, e.g. "HK", "Frankfurt"
  tags        TEXT NOT NULL DEFAULT '[]',-- JSON array of strings
  hidden      INTEGER NOT NULL DEFAULT 0,-- 0|1
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  -- denormalised latest state (keeps the dashboard to a single query)
  online      INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER NOT NULL DEFAULT 0,
  latest      TEXT                       -- JSON MetricSample | NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_sort ON nodes(sort_order, created_at);

-- ── metric time series ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
  node_id    TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  cpu        REAL    NOT NULL DEFAULT 0,
  mem_used   INTEGER NOT NULL DEFAULT 0,
  mem_total  INTEGER NOT NULL DEFAULT 0,
  swap_used  INTEGER NOT NULL DEFAULT 0,
  swap_total INTEGER NOT NULL DEFAULT 0,
  disk_used  INTEGER NOT NULL DEFAULT 0,
  disk_total INTEGER NOT NULL DEFAULT 0,
  net_in     INTEGER NOT NULL DEFAULT 0,   -- cumulative bytes since boot
  net_out    INTEGER NOT NULL DEFAULT 0,
  rx_rate    REAL    NOT NULL DEFAULT 0,   -- bytes/sec, computed by agent
  tx_rate    REAL    NOT NULL DEFAULT 0,
  tcp        INTEGER NOT NULL DEFAULT 0,
  udp        INTEGER NOT NULL DEFAULT 0,
  process    INTEGER NOT NULL DEFAULT 0,
  uptime     INTEGER NOT NULL DEFAULT 0,   -- seconds
  load1      REAL    NOT NULL DEFAULT 0,
  load5      REAL    NOT NULL DEFAULT 0,
  load15     REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);

-- ── latency probes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ping_tasks (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,              -- 'icmp' | 'tcp' | 'http'
  target     TEXT NOT NULL,              -- host / host:port / url
  interval   INTEGER NOT NULL DEFAULT 60,-- seconds
  enabled    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ping_tasks_node ON ping_tasks(node_id);

CREATE TABLE IF NOT EXISTS ping_records (
  task_id  TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  ts       INTEGER NOT NULL,
  value    REAL NOT NULL DEFAULT 0,      -- latency ms; -1 when failed
  ok       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_ping_records_node ON ping_records(node_id, ts);

-- ── auth ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- pbkdf2: see §5
  role          TEXT NOT NULL DEFAULT 'admin',  -- 'admin' | 'viewer'
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- random 32-byte hex
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- ── misc ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  user    TEXT NOT NULL DEFAULT '',
  action  TEXT NOT NULL,
  target  TEXT NOT NULL DEFAULT '',
  detail  TEXT NOT NULL DEFAULT '',
  ip      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
```

### 2.1 `settings` keys

| key                 | default      | meaning                                            |
| ------------------- | ------------ | -------------------------------------------------- |
| `site_name`         | `VPS-DOG`    | dashboard title                                    |
| `site_description`  | `""`         | subtitle                                           |
| `report_interval`   | `30`         | seconds the agent should wait between reports      |
| `offline_after`     | `90`         | seconds without a report before a node is offline  |
| `retention_days`    | `30`         | metric rows older than this are purged by cron     |
| `ping_retention_days`| `7`         | ping rows older than this are purged by cron       |
| `theme`             | `auto`       | `auto` \| `light` \| `dark`                        |
| `custom_head`       | `""`         | raw HTML injected before `</head>` on the SPA shell |
| `allow_auto_register`| `false`     | create a node when an unknown agent token reports  |

Settings are read through `getSettings(db)` which returns a fully-populated
object (defaults merged). Unknown keys are ignored on write.

---

## 3. Shared DTOs

```ts
// The sample the agent sends and the worker stores.
interface MetricSample {
  cpu: number;          // 0-100
  mem_used: number;     // bytes
  mem_total: number;
  swap_used: number;
  swap_total: number;
  disk_used: number;
  disk_total: number;
  net_in: number;       // cumulative bytes
  net_out: number;
  rx_rate: number;      // bytes/sec over the last interval
  tx_rate: number;
  tcp: number;
  udp: number;
  process: number;
  uptime: number;       // seconds
  load1: number;
  load5: number;
  load15: number;
}

interface NodeSummary {
  id: string;
  name: string;
  group: string;        // from group_name
  region: string;
  tags: string[];
  hidden: boolean;
  online: boolean;
  last_seen: number;
  uptime: number;       // seconds
  created_at: number;
  metrics: MetricSample | null;
  // derived helpers computed by the worker
  cpu: number;
  mem_percent: number;
  disk_percent: number;
  load1: number;
}

interface NodeDetail extends NodeSummary {
  pings: PingTaskSummary[];
}

interface PingTaskSummary {
  id: string;
  name: string;
  type: 'icmp' | 'tcp' | 'http';
  target: string;
  interval: number;
  enabled: boolean;
  latest: { ts: number; value: number; ok: boolean } | null;
  avg_24h: number;      // -1 when no data
  loss_24h: number;     // 0-100
}

interface PublicStatus {
  site_name: string;
  site_description: string;
  online: number;
  offline: number;
  total: number;
  generated_at: number;
}
```

### 3.1 History payload

```ts
// GET /api/nodes/:id/metrics?hours=1
interface MetricSeries {
  node_id: string;
  from: number; to: number;
  step: number;              // seconds per bucket (worker-side downsampling)
  points: Array<{
    ts: number;
    cpu: number;
    mem_percent: number;
    disk_percent: number;
    rx_rate: number;
    tx_rate: number;
    load1: number;
    net_in: number;
    net_out: number;
  }>;
}
```

**Downsampling rule (worker MUST implement):**
`hours <= 6` → raw rows. Otherwise bucket into at most **360** points:
`step = ceil(hours*3600/360)`, `ts = (ts/step)*step`, values averaged
(`net_in`/`net_out` use MAX because they are cumulative counters).

---

## 4. HTTP API

Base path `/api`. All responses are JSON (`content-type: application/json`).
Errors use `{ "error": "<code>", "message": "<human readable>" }` with the
matching status code. Success responses for mutations return `{ "ok": true, ... }`.

### 4.1 Agent ingest

#### `POST /api/v1/report`

Headers (one of):
- `Authorization: Bearer <agent-token>`
- `X-Node-Token: <agent-token>`

Body:

```jsonc
{
  "name": "hk-01",                 // required on first contact, ignored afterwards
  "version": "1.0.0",              // agent version, informational
  "ts": 1760000000,                // optional; server time is used when absent
  "host": {                        // optional, captured once and stored in tags/region
    "os": "Ubuntu 24.04",
    "arch": "x86_64",
    "region": "HK"
  },
  "metrics": { /* MetricSample */ },   // required
  "pings": [                            // optional
    { "name": "cloudflare", "type": "tcp", "target": "1.1.1.1:443",
      "value": 12.3, "ok": 1 }
  ]
}
```

`ts` lets an agent that buffered samples report them at the time they were taken.
It is clamped to **now − 7 days … now + 1 hour**; anything outside is replaced with
the server clock. The row is upserted on `(node_id, ts)`, so re-sending the same
timestamp overwrites rather than duplicating.

`200` response:

```json
{
  "ok": true,
  "node_id": "…",
  "server_time": 1760000000,
  "interval": 30,
  "pings": [
    { "id": "…", "name": "cloudflare", "type": "tcp",
      "target": "1.1.1.1:443", "interval": 60 }
  ]
}
```

Semantics:
- Token lookup is by `sha256(token)` against `nodes.token_hash`.
- **Auto-registration**: if the token is unknown AND `allow_auto_register`
  (setting, default `false`) is on, a new node is created. Otherwise `401`.
  *Note:* a dedicated `POST /api/admin/nodes` always issues the token; the agent
  is normally configured with an admin-issued token.
- Writes one `metrics` row, updates `nodes.latest/online/last_seen`,
  inserts `ping_records` for any ping whose `name+target` matches a task
  (unknown probes are auto-created as `ping_tasks` for that node).
- `401 {"error":"unauthorized"}` on a bad token.
- `400 {"error":"bad_request"}` on a malformed body.

### 4.2 Public read API (no auth)

| Method | Path                        | Returns                                        |
| ------ | --------------------------- | ---------------------------------------------- |
| GET    | `/api/status`               | `PublicStatus`                                 |
| GET    | `/api/nodes`                | `{ nodes: NodeSummary[], status: PublicStatus }` |
| GET    | `/api/nodes/:id`            | `NodeDetail`                                   |
| GET    | `/api/nodes/:id/metrics`    | `MetricSeries` — query `?hours=1` (1..168)     |
| GET    | `/api/nodes/:id/pings`      | `{ pings: Array<PingTaskSummary & { series: … }> }` |
| GET    | `/api/groups`               | `{ groups: Array<{ name: string; count: number }> }` |

`hidden = 1` nodes are excluded from `/api/nodes` and counted as neither online
nor offline in `/api/status`. They remain reachable by direct `:id` for admins
only (public callers get `404`).

### 4.3 Auth API

| Method | Path                 | Body                          | Notes                                        |
| ------ | -------------------- | ----------------------------- | -------------------------------------------- |
| POST   | `/api/auth/login`    | `{username, password}`        | sets `vpsdog_session` cookie (HttpOnly, SameSite=Lax, Secure, 7d) |
| POST   | `/api/auth/logout`   | —                             | clears cookie + deletes session              |
| GET    | `/api/auth/me`       | —                             | `{user:{id,username,role}}` or `401`         |
| POST   | `/api/auth/password` | `{old_password,new_password}` | authenticated                                |

**Bootstrap:** if `users` is empty, `POST /api/auth/login` with
`admin` / the env var `ADMIN_PASSWORD` (wrangler secret) creates the initial
admin user and logs in. If `ADMIN_PASSWORD` is unset the default is `admin`.
The response MUST include `"bootstrap": true` the first time.

### 4.4 Admin API (session cookie or `Authorization: Bearer <session-id>`)

**Role enforcement.** Every `/api/admin/*` route requires an authenticated session.
Mutating requests (`POST`, `PATCH`, `PUT`, `DELETE`) additionally require
`role === "admin"` and return `403 {"error":"forbidden"}` for a `viewer`.
Reads (`GET`) are open to any authenticated user.

| Method | Path                             | Purpose                                              |
| ------ | -------------------------------- | ---------------------------------------------------- |
| GET    | `/api/admin/nodes`               | all nodes incl. hidden, plus `token_hint`            |
| POST   | `/api/admin/nodes`               | create node → `{node, token}` (**plaintext token returned once only**) |
| PATCH  | `/api/admin/nodes/:id`           | update `name/group/region/tags/hidden/sort_order`    |
| DELETE | `/api/admin/nodes/:id`           | delete node + its metrics/pings                      |
| POST   | `/api/admin/nodes/:id/token`     | rotate token → `{token}`                             |
| GET    | `/api/admin/pings?node_id=`      | list probe tasks                                     |
| POST   | `/api/admin/pings`               | create probe task                                    |
| PATCH  | `/api/admin/pings/:id`           | update                                               |
| DELETE | `/api/admin/pings/:id`           | delete                                               |
| GET    | `/api/admin/settings`            | full settings object                                 |
| PUT    | `/api/admin/settings`            | partial update                                       |
| GET    | `/api/admin/users`               | list users (no hashes)                               |
| POST   | `/api/admin/users`               | `{username,password,role}`                           |
| DELETE | `/api/admin/users/:id`           | delete (cannot delete the last admin / self)         |
| GET    | `/api/admin/audit?limit=100`     | recent audit rows                                    |
| GET    | `/api/admin/overview`            | `{nodes, online, offline, metrics_rows, oldest_ts, d1_size}` |

Every mutating admin call writes an `audit_logs` row.

### 4.5 Static assets

The Worker serves the built SPA from the `ASSETS` binding. `run_worker_first` is
`true` so the Worker renders the HTML shell (needed to inject `custom_head`);
static assets are still served by the binding. Any `GET` that is not under `/api`
and does not match a file falls back to `index.html` (SPA routing).
`wrangler.toml`:

```toml
[assets]
directory = "../web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true
```

---

## 5. Auth details

- **Password hash**: `pbkdf2$<iterations>$<salt-b64>$<hash-b64>` using
  PBKDF2-SHA256, 100_000 iterations, 16-byte salt, 32-byte key, via WebCrypto
  (`crypto.subtle.deriveBits`). Verification uses a constant-time compare.
- **Session cookie**: name `vpsdog_session`; value is the `sessions.id`.
  TTL 7 days. Logout deletes the row.
- **Agent tokens**: 32 random bytes → hex (64 chars). Stored only as
  `sha256` hex. `token_hint` = first 8 chars for display.
- **CORS**: `OPTIONS /api/*` returns 204 with
  `Access-Control-Allow-Origin: <request Origin or *>`,
  `Access-Control-Allow-Headers: content-type, authorization, x-node-token`,
  `Access-Control-Allow-Methods: GET,POST,PATCH,PUT,DELETE,OPTIONS`,
  `Access-Control-Allow-Credentials: true`.
  All `/api/*` responses echo the CORS headers.
- **Rate limiting** on `/api/auth/login`: max 10 attempts / 5 min / IP,
  implemented with an in-memory `Map` on the isolate (best effort, documented).

---

## 6. Agent protocol (Go)

The agent is a single static binary, no runtime deps, < 8 MB.

**Config** — `agent.yaml` (optional; CLI flags / env override):

```yaml
server: https://vps-dog.example.workers.dev   # env VPSDOG_SERVER
token:  "<64 hex chars>"                       # env VPSDOG_TOKEN
name:   "hk-01"                                # env VPSDOG_NAME
interval: 30                                   # seconds, server may override
tls_skip_verify: false
```

Precedence: CLI flag > env var > config file > built-in default.

**Flags:** `-c <path>` (default `/etc/vps-dog/agent.yaml`), `-server`, `-token`,
`-name`, `-interval`, `-once`, `-version`, `-install`, `-uninstall`.

**Collection** (`internal/collector`) — Linux primary, with graceful degradation
on other OSes (return zeros, never crash):
- CPU % — delta of `/proc/stat` totals between samples.
- Memory/swap — `/proc/meminfo`.
- Disk — `syscall.Statfs` on `/` (report the root filesystem).
- Network — `/proc/net/dev` cumulative bytes (skip `lo`); rates = delta / elapsed.
- TCP/UDP socket counts — `/proc/net/tcp`, `/proc/net/tcp6`, `/proc/net/udp`.
- Process count — count of numeric entries in `/proc`.
- Uptime — `/proc/uptime`.
- Load — `/proc/loadavg`.

**Latency probes** (`internal/probe`):
- `icmp` — raw ICMP echo when running as root, else `exec` `ping -c 1 -W 2`.
- `tcp` — `net.DialTimeout("tcp", target, 3s)`, latency = connect duration.
- `http` — `GET` the URL with a 5 s timeout; latency = time to first byte;
  `ok` = status < 400.

**Loop:** collect → probe the tasks returned by the server → POST JSON →
read `interval` from the response and sleep (clamped to 10..3600 s).
On network error, retry with exponential backoff (1s → 2s → … → max 60s) and
keep the last known interval. Log to stdout with a `[vps-dog]` prefix.

**Also required:**
- `agent/install.sh` — one-liner installer for systemd systems
  (`curl -fsSL .../install.sh | bash -s -- -s <server> -t <token>`), writes
  `/etc/systemd/system/vps-dog.service`, enables + starts it.
- `agent/build.sh` + `agent/build.ps1` — cross-compile linux/amd64, linux/arm64,
  linux/armv7, darwin/amd64, darwin/arm64, windows/amd64 into `dist/`.
- `go.mod` module path `github.com/vps-dog/agent`, Go 1.22+, **zero external
  dependencies** (stdlib only) so the build works offline.

---

## 7. Frontend (React SPA)

**Stack:** Vite + React 19 + TypeScript + `react-router-dom` v7 +
`@tanstack/react-query` v5 + `echarts` (imported directly, wrapped in a small
`<Chart>` component — do NOT use `echarts-for-react`) + Tailwind CSS v4 via
`@tailwindcss/vite`.

**Routes**

| Path              | Page          | Contents                                                                 |
| ----------------- | ------------- | ------------------------------------------------------------------------ |
| `/`               | `Dashboard`   | status strip (online/offline/total, site name), node card grid, group filter, search, auto-refresh 10 s |
| `/node/:id`       | `NodeDetail`  | big CPU / MEM / DISK gauges, load + uptime + traffic tiles, ECharts time-series (CPU/MEM, network rate, load), ping table with sparkline, 1h/6h/24h/7d range switch |
| `/admin`          | `AdminLogin`  | login form when unauthenticated                                            |
| `/admin/nodes`    | `AdminNodes`  | table: add / edit / delete / rotate token / toggle hidden / reorder        |
| `/admin/pings`    | `AdminPings`  | probe task CRUD                                                            |
| `/admin/settings` | `AdminSettings`| site settings form                                                        |
| `/admin/users`    | `AdminUsers`  | user CRUD                                                                  |
| `/admin/audit`    | `AdminAudit`  | audit log table                                                            |

**Design language** (this is a headline requirement — "界面简洁美观"):
- Dark-first, but a real light theme too. Default follows `prefers-color-scheme`
  and can be overridden; persist in `localStorage` under `vpsdog.theme`.
- Palette — dark: bg `#0b0f14`, surface `#131a22`, border `#1f2a36`,
  text `#e6edf3`, muted `#8b98a5`, accent `#3b82f6`, success `#22c55e`,
  warn `#f59e0b`, danger `#ef4444`.
  Light: bg `#f6f8fa`, surface `#ffffff`, border `#e2e8f0`, text `#0f172a`,
  muted `#64748b`.
- Rounded-2xl cards, 1px borders, no heavy shadows, generous whitespace,
  tabular-nums for all figures, subtle 150 ms transitions.
- Online = pulsing green dot; offline = grey dot.
- Responsive: 1 column < 640 px, 2 < 1024 px, 3+ above. Admin tables scroll
  horizontally on mobile.
- Charts: no grid lines except a faint horizontal one, smooth lines,
  area gradient fill, tooltip on crosshair.
- i18n: `zh-CN` and `en`, auto-detected from `navigator.language`, toggle in the
  header, persisted in `localStorage` under `vpsdog.lang`. All UI strings go
  through a tiny `t()` helper (`src/lib/i18n.ts`) — no hard-coded Chinese/English
  in components.

**Dev proxy:** `vite.config.ts` proxies `/api` to `http://127.0.0.1:8787`
(`wrangler dev`) so `pnpm dev` gives a working full-stack dev loop.

**Build output:** `web/dist` (consumed by the Worker assets binding).

---

## 8. Verification requirements

Every teammate must leave behind a **runnable** check and report the exact
command + observed result:

| Owner          | Must pass                                                          |
| -------------- | ------------------------------------------------------------------ |
| worker-backend | `pnpm install && pnpm typecheck && pnpm test` inside `worker/` — vitest with `@cloudflare/vitest-pool-workers` exercising: health, login bootstrap, agent report → node appears online, metrics history downsampling, admin node CRUD, 401 paths. |
| web-frontend   | `pnpm install && pnpm build` inside `web/` — zero TS errors, `dist/index.html` emitted. |
| go-agent       | `go vet ./... && go build ./...` and `go run . -once` against a local mock or `-version`. |
| docs-devops    | all files present, CI YAML parses, links resolve.                   |

The Lead runs the final end-to-end check (`wrangler dev` + real agent report)
before declaring the goal complete.
