# HTTP API 参考

基础 URL：`https://vps-dog.<your-subdomain>.workers.dev`

所有 API 响应都是 JSON。错误使用以下结构：

```json
{ "error": "unauthorized", "message": "invalid or missing credentials" }
```

| 状态码 | `error` | 说明 |
| --- | --- | --- |
| 400 | `bad_request` | 请求体格式错误或参数无效 |
| 401 | `unauthorized` | 会话或 Agent 令牌缺失/无效 |
| 403 | `forbidden` | 已认证但无权限 |
| 404 | `not_found` | 未知的节点/任务 |
| 429 | `rate_limited` | 登录尝试过于频繁 |
| 500 | `internal_error` | 意外故障 |

CORS 对 `/api/*` 启用。`OPTIONS` 预检请求返回 `204`，`Access-Control-Allow-Origin` 从请求的 `Origin` 回显（当请求未携带 `Origin` 时为 `*`），回显了来源时返回 `Access-Control-Allow-Credentials: true`，并返回 `Access-Control-Allow-Headers: content-type, authorization, x-node-token`。

> 由于任意来源都会连同凭据一起被回显，会话 cookie 上的 `SameSite=Lax` 才是实际生效的 CSRF 防护。参见 [`SECURITY.md`](../SECURITY.md)。

---

## 身份认证

### 会话（浏览器 / 管理员）

`POST /api/auth/login` 会设置名为 `vpsdog_session` 的 `HttpOnly; SameSite=Lax; Secure` cookie，有效期 7 天。程序化客户端也可以改用 `Authorization: Bearer <session-id>` 发送会话 ID。

### Agent 令牌

Agent 发送 `Authorization: Bearer <agent-token>` 或 `X-Node-Token: <agent-token>`。令牌为 64 个十六进制字符；服务端只存储其 SHA-256 哈希。

---

## Agent 上报接收

### `POST /api/v1/report`

为持有该令牌的节点提交一份指标采样（以及可选的探测结果）。

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

`interval` 是服务端配置的 `report_interval`；Agent 应遵循该值。`pings` 列出 Agent 在下次上报前应执行的探测任务。未知的探测任务名称会自动注册为该节点的任务。

---

## 公开 API

无需认证。`hidden = 1` 的节点会被排除。

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

返回 `NodeDetail`：字段相同，另加 `pings[]` 摘要（`latest`, `avg_24h`, `loss_24h`）。节点未知时返回 `404`；节点为隐藏且调用方不是已认证管理员时同样返回 `404`。

### `GET /api/nodes/:id/metrics?hours=1`

该节点的时间序列。`hours` ∈ `[1, 168]`，默认 `1`。

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

**降采样。** 不超过 6 小时的时间窗口返回原始数据行。更长的时间窗口会被分桶为最多 360 个数据点：`step = ceil(hours × 3600 / 360)`。仪表值取平均；`net_in`/`net_out` 使用 `MAX`，因为它们是累计计数器。

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

## 认证 API

### `POST /api/auth/login`

```bash
curl -i -X POST https://vps-dog.example.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

```json
{ "ok": true, "user": { "id": "…", "username": "admin", "role": "admin" }, "bootstrap": true }
```

`bootstrap: true` 仅当该调用创建了第一个账号时出现（取自 `ADMIN_PASSWORD` 密钥，默认 `admin`）。限流：每 IP 每 5 分钟 10 次尝试。

### `POST /api/auth/logout`

删除会话并清除 cookie。

### `GET /api/auth/me`

```json
{ "user": { "id": "…", "username": "admin", "role": "admin" } }
```

### `POST /api/auth/password`

```json
{ "old_password": "…", "new_password": "…" }
```

---

## 管理 API

以下所有路由都需要会话（cookie 或 bearer）。每个会改变状态的调用都会写入一行 `audit_logs`。

### 角色

共有两个角色：`admin` 和 `viewer`。

| | `admin` | `viewer` |
| --- | --- | --- |
| `GET /api/admin/*` | ✅ | ✅ |
| `POST` / `PATCH` / `PUT` / `DELETE` | ✅ | ❌ `403 forbidden` |

仪表盘会对只读用户隐藏会改变状态的操作控件，但 Worker 才是执行点 —— 只读用户即使手工构造请求，也无法创建节点、轮换令牌、修改设置或添加用户。

### 节点

| 方法 | 路径 | 请求体 / 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/nodes` | 所有节点，包括隐藏节点，附带 `token_hint` |
| `POST` | `/api/admin/nodes` | `{name, group?, region?, tags?[]}` → `{node, token}`；**令牌仅显示一次** |
| `PATCH` | `/api/admin/nodes/:id` | `name, group, region, tags, hidden, sort_order` 中的任意字段 |
| `DELETE` | `/api/admin/nodes/:id` | 删除该节点及其指标/探测任务 |
| `POST` | `/api/admin/nodes/:id/token` | 轮换令牌 → `{token}` |

```bash
# create
curl -X POST https://vps-dog.example.workers.dev/api/admin/nodes \
  -H "Content-Type: application/json" -b "vpsdog_session=$SID" \
  -d '{"name":"hk-01","group":"production","region":"HK","tags":["ssd","kvm"]}'

# rotate the token
curl -X POST https://vps-dog.example.workers.dev/api/admin/nodes/0f2c…/token -b "vpsdog_session=$SID"
```

### 探测任务

| 方法 | 路径 | 请求体 |
| --- | --- | --- |
| `GET` | `/api/admin/pings?node_id=` | 列表（可选过滤） |
| `POST` | `/api/admin/pings` | `{node_id, name, type, target, interval?, enabled?}` |
| `PATCH` | `/api/admin/pings/:id` | 任意字段 |
| `DELETE` | `/api/admin/pings/:id` | — |

### 设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/settings` | 完整的设置对象 |
| `PUT` | `/api/admin/settings` | 部分更新；未知键会被忽略 |

键：`site_name`, `site_description`, `report_interval`, `offline_after`,
`retention_days`, `ping_retention_days`, `theme`, `custom_head`,
`allow_auto_register`。

### 用户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/users` | 不返回密码哈希 |
| `POST` | `/api/admin/users` | `{username, password, role}`，其中 role ∈ `admin, viewer` |
| `DELETE` | `/api/admin/users/:id` | 拒绝删除自己或最后一个管理员 |

### 运维操作

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/audit?limit=100` | 最近的审计日志行 |
| `GET` | `/api/admin/overview` | 节点数量、指标行数、最早采样、D1 大小 |
| `POST` | `/api/admin/sweep` | 立即执行保留期 + 离线清理任务；返回删除数量 |

```bash
curl "https://vps-dog.example.workers.dev/api/admin/audit?limit=20" -b "vpsdog_session=$SID"
curl -X POST https://vps-dog.example.workers.dev/api/admin/sweep -b "vpsdog_session=$SID"
# { "ok": true, "metrics_deleted": 120, "ping_records_deleted": 40, "sessions_deleted": 2, "nodes_marked_offline": 0 }
```

> `nodes_marked_offline` 始终为 `0`：在线/离线状态在读取时根据 `last_seen` 推导，因此没有可清理的存储标记。

---

## 静态资源

任何不在 `/api` 下的 `GET` 请求都由打包后的 SPA 提供；未知路径回退到 `index.html`，以便客户端路由正常工作。
