# 部署指南

以下内容假设使用全新的 Cloudflare 账号。总配置时间约 10 分钟。免费额度下的持续开销：**$0**。

---

## 0. 前置要求

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | ≥ 20 | 构建 SPA 并运行 Wrangler |
| pnpm | ≥ 9 | 工作区包管理器 |
| Wrangler | ≥ 4 | 部署 Worker 并管理 D1 |
| Go | ≥ 1.22 | 仅当你自行构建 Agent 时需要（预编译二进制文件在 Releases 页面） |

```bash
node -v && pnpm -v && npx wrangler --version
```

---

## 0. 一键部署（推荐）

点下面的按钮，Cloudflare 会自动：把你的副本克隆到你的 GitHub 账号 → 创建并绑定 **D1 数据库** → 执行迁移 → 构建并部署。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/heshang2011/vps-dog)

配置页只需填写 `ADMIN_PASSWORD`（初始管理员密码）。完成后打开 Cloudflare 给出的 `https://<项目名>.<子域>.workers.dev`，进入 `/admin` 登录。

> 这个按钮读取的是**仓库根目录**的 `wrangler.toml`。Cloudflare 会创建一个真实的 D1 数据库，并把它的 `database_id` 回填到你克隆出来的那份配置里 —— 所以仓库里的占位值不需要你手动改。

**不想用一键按钮？** 从 §1 开始手动部署。

---

## 1. 克隆并构建前端

```bash
git clone https://github.com/heshang2011/vps-dog.git
cd vps-dog
pnpm install
pnpm build          # emits web/dist — the Worker serves this as static assets
```

> 根目录 `wrangler.toml` 的 `[assets]` 绑定指向 `web/dist`。该目录缺失时，
> Wrangler/Miniflare **会启动失败**，因此在运行 `wrangler dev` 或
> `wrangler deploy` 之前先构建 SPA。（Worker 自带的回退页面
> 仅覆盖绑定完全缺失的情况，例如在测试中。）

---

## 2. 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create vps-dog
```

Wrangler 会打印类似下面的内容：

```toml
[[d1_databases]]
binding = "DB"
database_name = "vps-dog"
database_id = "8f3c1e2a-...."
```

把真实的 `database_id` 粘贴到根目录的 [`wrangler.toml`](../wrangler.toml) 中，替换 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。

---

## 3. 应用迁移

```bash
npx wrangler d1 migrations apply DB --remote
```

这会创建 `nodes`、`metrics`、`ping_tasks`、`ping_records`、`users`、`sessions`、`settings` 和 `audit_logs`，并写入默认设置。

> 这里用的是 **binding 名 `DB`**，不是数据库名。两者在你自己部署时通常一致，但用 binding 名更稳妥 —— 如果你把数据库命名成别的名字，命令依然有效。

本地开发使用相同的命令并加上 `--local`（见 §7）。

---

## 4. 设置管理员密码

```bash
npx wrangler secret put ADMIN_PASSWORD
# paste a strong password when prompted
```

如果跳过此步骤，默认的初始化密码是 `admin` —— 首次登录后请立即在 `/admin/users` 中**修改它**。初始化账号会在针对空 `users` 表的首次成功登录尝试时惰性创建。

---

## 5. 部署

```bash
npx wrangler deploy
```

输出：

```
Uploaded vps-dog (1.23 sec)
  https://vps-dog.<your-subdomain>.workers.dev
  Schedule: */5 * * * *
```

打开该 URL，点击 **Admin**，使用 `admin` 和你的密码登录。

---

## 6. 添加第一个节点

1. 进入 `/admin/nodes` → **Add node**。
2. 为它设置名称（`hk-01`）、分组（`production`）和地区（`HK`）。
3. **立即复制令牌** —— 它只显示一次。服务端只存储其 SHA-256 哈希。
4. 安装 Agent：

```bash
curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh \
  | sudo bash -s -- -s https://vps-dog.<your-subdomain>.workers.dev -t <TOKEN> -n hk-01
```

5. `journalctl -u vps-dog -f` 应显示每 30 秒一次的上报，并且该节点会在仪表盘上变绿。

### 配置延迟探测

在 `/admin/pings` 中，为某个节点添加探测任务：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| type | `tcp` | `icmp`、`tcp` 或 `http` |
| target | `1.1.1.1:443` | `icmp` → 主机，`tcp` → `host:port`，`http` → 完整 URL |
| interval | `60` | 秒 |

Agent 会在下次上报时获取新探测任务，并立即开始测量。

---

## 7. 本地开发

```bash
# terminal 1 — Worker API
pnpm db:migrate:local
pnpm dev:worker

# terminal 2 — SPA with /api proxied to 127.0.0.1:8787
pnpm dev
```

打开 http://localhost:5173。初始化登录在本地同样可用。

让 Agent 指向本地 Worker：

```bash
cd agent
go run . -server http://127.0.0.1:8787 -token <TOKEN> -name dev -once   # dry run
go run . -server http://127.0.0.1:8787 -token <TOKEN> -name dev        # loop
```

---

## 8. 自定义域名

1. Cloudflare 仪表盘 → **Workers & Pages** → `vps-dog` → **Settings** → **Domains & Routes**。
2. **Add** → **Custom domain** → `monitor.example.com`。
3. 如果该域名区域托管在 Cloudflare，DNS 与证书会自动配置。

之后更新各 Agent 的 `server:` 值，然后执行 `sudo systemctl restart vps-dog`。

---

## 9. 备份

D1 导出：

```bash
npx wrangler d1 export vps-dog --remote --output backup-$(date +%F).sql
```

恢复到新数据库：

```bash
npx wrangler d1 create vps-dog-restore
npx wrangler d1 execute vps-dog-restore --remote --file backup-2026-01-01.sql
```

由于指标数据量很大，通常每晚导出 `nodes`、`users`、`settings`、`ping_tasks` 以及一个滚动窗口的 `metrics` 就足够了：

```bash
npx wrangler d1 execute vps-dog --remote --command \
  "SELECT * FROM nodes" --json > nodes.json
```

---

## 10. 调优与运维

| 设置（`/admin/settings`） | 默认值 | 作用 |
| --- | --- | --- |
| `report_interval` | 30 s | Agent 的上报频率。值越小则数据行越多、D1 写入越多。 |
| `offline_after` | 90 s | 节点被显示为离线前的静默秒数。 |
| `retention_days` | 30 | 早于该时长的指标会被 5 分钟一次的定时任务删除。 |
| `ping_retention_days` | 7 | 同上，作用于探测结果。 |
| `custom_head` | empty | 注入到 SPA 外壳 `</head>` 之前的原始 HTML。 |

**需要注意的免费额度限制。** 免费方案下 D1 允许每天约 5 M 行读取、100 k 行写入。一个每 30 秒上报一次的节点每天写入 2 880 行 `metrics`，**再加上每次上报中每个已配置探测任务的一行 `ping_records`** —— 因此配置三个探测任务的节点每天大约写入 11 500 行。按每个节点三个探测任务计算，每天 100 k 行大约可支持 8 个节点；或者把 `report_interval` 提高到 60 s，即可翻倍。

手动维护：

```bash
# force the retention/offline sweep right now
curl -X POST https://vps-dog.<you>.workers.dev/api/admin/sweep -b "vpsdog_session=<id>"

# tail live logs
npx wrangler tail
```

---

## 11. 升级

```bash
git pull
pnpm install && pnpm build
pnpm db:migrate:remote && pnpm exec wrangler deploy
```

Agent 与 v1 协议向前和向后兼容；升级它们是可选的。重新运行 `install.sh`（或替换二进制文件并执行 `systemctl restart vps-dog`）即可更新。

---

## 12. 常见问题

| 症状 | 原因 / 解决办法 |
| --- | --- |
| 节点一直离线 | `server:` URL 错误、令牌错误，或出站 HTTPS 被阻断。检查 `journalctl -u vps-dog -n 50`。 |
| Agent 日志中出现 `401 unauthorized` | 令牌已被轮换，或节点已被删除。在 `/admin/nodes` 中签发新令牌。 |
| 仪表盘一片空白 | 部署前没有构建 `web/dist`。运行 `pnpm build` 并重新部署。 |
| `/admin` 提示密码错误 | 在用户创建之后才设置 `ADMIN_PASSWORD` 密钥 —— 该密钥只用于初始化*第一个*用户。可在 D1 控制台执行 `DELETE FROM users;` 重置，或直接添加一个用户。 |
| `no such table` | 迁移被应用到了错误的 database id。请重新检查根目录的 `wrangler.toml`。 |
| 新节点上图表为空 | 历史数据至少需要两次上报；等一分钟。 |
| `D1_ERROR: too many SQL variables` | 只有在你 fork 并修改批次大小时才可能出现；内置清理任务会分批写入。 |
