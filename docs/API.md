# HTTP API reference

Base URL: `https://vps-dog.<your-subdomain>.workers.dev`

All API responses are JSON. Errors use the shape:

```json
{ "error": "unauthorized", "message": "invalid or missing credentials" }
```

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Malformed body or invalid parameters |
| 401 | `unauthorized` | Missing/invalid session or agent token |
| 403 | `forbidden` | Authenticated but not allowed |
| 404 | `not_found` | Unknown node/task |
| 429 | `rate_limited` | Too many login attempts |
| 500 | `internal_error` | Unexpected failure |

CORS is enabled for `/api/*`. `OPTIONS` preflight returns `204` with
`Access-Control-Allow-Origin` echoed from the request `Origin` (or `*` when the
request carries no `Origin`), `Access-Control-Allow-Credentials: true` when an
origin was echoed, and `Access-Control-Allow-Headers: content-type, authorization, x-node-token`.

> Because any origin is echoed with credentials, `SameSite=Lax` on the session
> cookie is the effective CSRF control. See [`SECURITY.md`](../SECURITY.md).

---

## Authentication

### Session (browser / admin)

`POST /api/auth/login` sets an `HttpOnly; SameSite=Lax; Secure` cookie named
`vpsdog_session`, valid for 7 days. Programmatic clients may instead send the session
id as `Authorization: Bearer <session-id>`.

### Agent token

Agents send `Authorization: Bearer <agent-token>` or `X-Node-Token: <agent-token>`.
Tokens are 64 hex characters; only their SHA-256 hash is stored server-side.

---

## Agent ingest

### `POST /api/v1/report`

Submit one metrics sample (and optional probe results) for the node owning the token.

```bash
curl -X POST https://vps-dog.example.workers.dev/api/v1/report \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hk-01",
    "version": "1.0.0",
    "host": { "os": "Ubuntu 24.04", "arch": "x86_64", "region": "HK" },
    "metrics": {
      "cpu": 12.5, "mem_used": 1073741824, "mem_total": 2147483648,
      "swap_used": 0, "swap_total": 0,
      "disk_used": 10737418240, "disk_total": 53687091200,
      "net_in": 123456, "net_out": 654321, "rx_rate": 1024.5, "tx_rate": 512.25,
      "tcp": 42, "udp": 7, "process": 133, "uptime": 86400,
      "load1": 0.5, "load5": 0.4, "load15": 0.3
    },
    "pings": [
      { "name": "cloudflare", "type": "tcp", "target": "1.1.1.1:443", "value": 12.3, "ok": 1 }
    ]
  }'
```

**200**

```json
{
  "ok": true,
  "node_id": "0f2c…",
  "server_time": 1760000000,
  "interval": 30,
  "pings": [
    { "id": "a91b…", "name": "cloudflare", "type": "tcp",
      "target": "1.1.1.1:443", "interval": 60 }
  ]
}
```

`interval` is the server-configured `report_interval`; the agent should honour it.
`pings` lists the probes the agent should run before its next report. Unknown
probe names are auto-registered as tasks for that node.

---

## Public API

No authentication required. Nodes with `hidden = 1` are excluded.

### `GET /api/status`

```bash
curl https://vps-dog.example.workers.dev/api/status
```

```json
{
  "site_name": "VPS-DOG",
  "site_description": "",
  "online": 3, "offline": 1, "total": 4,
  "generated_at": 1760000000
}
```

### `GET /api/nodes`

```bash
curl https://vps-dog.example.workers.dev/api/nodes
```

```json
{
  "status": { "site_name": "VPS-DOG", "online": 1, "offline": 0, "total": 1, "generated_at": 1760000000 },
  "nodes": [
    {
      "id": "0f2c…", "name": "hk-01", "group": "production", "region": "HK",
      "tags": ["ssd"], "hidden": false,
      "online": true, "last_seen": 1760000000, "uptime": 86400,
      "created_at": 1759000000,
      "cpu": 12.5, "mem_percent": 50.0, "disk_percent": 20.0, "load1": 0.5,
      "metrics": { "cpu": 12.5, "mem_used": 1073741824, "…": "…" }
    }
  ]
}
```

### `GET /api/nodes/:id`

Returns a `NodeDetail`: the same fields plus `pings[]` summaries
(`latest`, `avg_24h`, `loss_24h`). `404` when the node is unknown, or when it is
hidden and the caller is not an authenticated admin.

### `GET /api/nodes/:id/metrics?hours=1`

Time series for the node. `hours` ∈ `[1, 168]`, default `1`.

```bash
curl "https://vps-dog.example.workers.dev/api/nodes/0f2c…/metrics?hours=24"
```

```json
{
  "node_id": "0f2c…", "from": 1759913600, "to": 1760000000, "step": 240,
  "points": [
    { "ts": 1759913600, "cpu": 11.2, "mem_percent": 48.1, "disk_percent": 20.0,
      "rx_rate": 900.5, "tx_rate": 400.2, "load1": 0.42,
      "net_in": 123456, "net_out": 654321 }
  ]
}
```

**Downsampling.** Windows up to 6 hours return raw rows. Longer windows are bucketed
into at most 360 points: `step = ceil(hours × 3600 / 360)`. Gauges are averaged;
`net_in`/`net_out` use `MAX` because they are cumulative counters.

### `GET /api/nodes/:id/pings`

```json
{
  "pings": [
    {
      "id": "a91b…", "name": "cloudflare", "type": "tcp",
      "target": "1.1.1.1:443", "interval": 60, "enabled": true,
      "latest": { "ts": 1760000000, "value": 12.3, "ok": true },
      "avg_24h": 13.1, "loss_24h": 0.0,
      "series": [ { "ts": 1759999000, "value": 12.1, "ok": true } ]
    }
  ]
}
```

### `GET /api/groups`

```json
{ "groups": [ { "name": "production", "count": 3 }, { "name": "default", "count": 1 } ] }
```

---

## Auth API

### `POST /api/auth/login`

```bash
curl -i -X POST https://vps-dog.example.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

```json
{ "ok": true, "user": { "id": "…", "username": "admin", "role": "admin" }, "bootstrap": true }
```

`bootstrap: true` appears only when this call created the very first account (from the
`ADMIN_PASSWORD` secret, default `admin`). Rate limit: 10 attempts / 5 minutes / IP.

### `POST /api/auth/logout`

Deletes the session and clears the cookie.

### `GET /api/auth/me`

```json
{ "user": { "id": "…", "username": "admin", "role": "admin" } }
```

### `POST /api/auth/password`

```json
{ "old_password": "…", "new_password": "…" }
```

---

## Admin API

All routes below require a session (cookie or bearer). Every mutating call writes an
`audit_logs` row.

### Roles

Two roles exist: `admin` and `viewer`.

| | `admin` | `viewer` |
| --- | --- | --- |
| `GET /api/admin/*` | ✅ | ✅ |
| `POST` / `PATCH` / `PUT` / `DELETE` | ✅ | ❌ `403 forbidden` |

The dashboard hides mutating controls from viewers, but the Worker is the
enforcement point — a viewer cannot create nodes, rotate tokens, change settings or
add users even with a hand-crafted request.

### Nodes

| Method | Path | Body / notes |
| --- | --- | --- |
| `GET` | `/api/admin/nodes` | All nodes including hidden, with `token_hint` |
| `POST` | `/api/admin/nodes` | `{name, group?, region?, tags?[]}` → `{node, token}`; **token shown once** |
| `PATCH` | `/api/admin/nodes/:id` | any of `name, group, region, tags, hidden, sort_order` |
| `DELETE` | `/api/admin/nodes/:id` | deletes the node and its metrics/probes |
| `POST` | `/api/admin/nodes/:id/token` | rotates the token → `{token}` |

```bash
# create
curl -X POST https://vps-dog.example.workers.dev/api/admin/nodes \
  -H "Content-Type: application/json" -b "vpsdog_session=$SID" \
  -d '{"name":"hk-01","group":"production","region":"HK","tags":["ssd","kvm"]}'

# rotate the token
curl -X POST https://vps-dog.example.workers.dev/api/admin/nodes/0f2c…/token -b "vpsdog_session=$SID"
```

### Probes

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/admin/pings?node_id=` | list (optionally filtered) |
| `POST` | `/api/admin/pings` | `{node_id, name, type, target, interval?, enabled?}` |
| `PATCH` | `/api/admin/pings/:id` | any field |
| `DELETE` | `/api/admin/pings/:id` | — |

### Settings

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/admin/settings` | full settings object |
| `PUT` | `/api/admin/settings` | partial update; unknown keys ignored |

Keys: `site_name`, `site_description`, `report_interval`, `offline_after`,
`retention_days`, `ping_retention_days`, `theme`, `custom_head`,
`allow_auto_register`.

### Users

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/admin/users` | no password hashes returned |
| `POST` | `/api/admin/users` | `{username, password, role}` where role ∈ `admin, viewer` |
| `DELETE` | `/api/admin/users/:id` | refuses to delete yourself or the last admin |

### Operations

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/admin/audit?limit=100` | recent audit rows |
| `GET` | `/api/admin/overview` | node counts, metric row count, oldest sample, D1 size |
| `POST` | `/api/admin/sweep` | run the retention + offline sweep now; returns deleted counts |

```bash
curl "https://vps-dog.example.workers.dev/api/admin/audit?limit=20" -b "vpsdog_session=$SID"
curl -X POST https://vps-dog.example.workers.dev/api/admin/sweep -b "vpsdog_session=$SID"
# { "ok": true, "metrics_deleted": 120, "ping_records_deleted": 40, "sessions_deleted": 2, "nodes_marked_offline": 0 }
```

> `nodes_marked_offline` is always `0`: online/offline state is derived from
> `last_seen` at read time, so there is no stored flag to sweep.

---

## Static assets

Any `GET` that is not under `/api` is served from the bundled SPA; unknown paths fall
back to `index.html` so client-side routing works.
