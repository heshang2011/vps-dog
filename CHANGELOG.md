# 更新日志

本项目所有值得注意的变更都记录在此。
格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，且本项目遵循[语义化版本](https://semver.org/spec/v2.0.0.html)。

## [未发布]

### 新增

- **创建节点后直接给出可复制的安装命令。** 此前那个对话框只显示一次性令牌，操作者还得自己
  拼 `curl … | sudo bash -s -- -s … -t …`。现在同一个对话框里同时展示令牌与完整命令 ——
  `-s` 取当前站点的 `origin`，节点填了地区时自动带上 `-r` —— 一键复制即可粘到服务器执行。
  命令按 POSIX shell 规则做单引号转义，节点名含空格或单引号也不会解析错乱。
  （`web/src/lib/install.ts` + `TokenDialog`）

### 修复

- **部署：`build` 阶段现在完成完整的 D1 配置（建库 + 绑定 + 建表）。** 此前只做了「建库 + 绑定」，
  没有建表，于是 Workers Builds 自动部署出来的站点能打开、但**所有 `/api/*` 都返回 500**
  （`wrangler tail` 里是 `D1_ERROR: no such table: settings`）。现在 `pnpm build` 在 Cloudflare
  构建环境里（检测到 `WORKERS_CI`）会依次执行：断言 `web/dist/index.html` 存在 →
  `ensure-d1`（建库 / 绑定 / 写回 `database_id`）→ `d1 migrations apply --remote`（建表）；
  本地执行时整段跳过、不联网。
- **部署：前端产物缺失不再静默上线。** 新增 `--require-assets`：`web/dist` 为空时构建直接失败
  并打印修复指引，而不是部署一个只显示「frontend has not been built」空白页的 Worker。
- **部署：CI 里的失败分层更清晰。** 可选步骤（例如构建凭据缺少 D1 权限）仍只警告、不阻断构建；
  而「前端缺失」「迁移失败」这两类会发布坏站点的错误一律让构建失败。
- **部署：自动创建并绑定 D1 现在真的生效了。** 此前 `scripts/ensure-d1.mjs` 用「`database_id`
  是否符合 UUID 格式」来判断配置是占位符还是真实值，于是一个从别人 fork 里带过来的合法 UUID
  （在当前账号并不存在）会被判为「已配置」，脚本直接报错退出而不会建库 —— 这正是
  `D1 binding 'DB' references database '<id>' which was not found [code: 10181]` 反复出现的原因。
  现在改为按**身份**判断：只有 id 能在当前账号解析出来才算已配置；否则寻找同名库并绑定，
  再否则创建。`--check` 可预览决策，`VPS_DOG_D1_NO_CREATE=1` 可禁止自动创建。
- **部署：Workers Builds 会自动补建 D1。** `build` 脚本在 Cloudflare 构建环境里会调用
  `ensure-d1 --if-ci`（非 CI 环境直接跳过；出错只警告、不中断构建），因此即使 Deploy command
  保持默认的 `npx wrangler deploy`，数据库也会被创建并写回配置。完整的「建表 + 部署」链路
  仍建议把 Deploy command 设为 `pnpm run deploy`。
- **部署：修正 `wrangler.toml` 中 `workers_dev` 的位置。** 它原先落在 `[assets]` 表内部，
  Wrangler 会警告 `Unexpected fields found in assets field: "workers_dev"`。已移到顶层。
- **部署：不再提交属于他人账号的 `database_id`。** 改回文档中一直描述的占位符
  `REPLACE_WITH_YOUR_D1_DATABASE_ID`。
- **文档**：新增《Workers Builds（Git 集成）部署》一节及三条对应排查项；README 的手动部署
  步骤改用 `pnpm db:ensure`；`pnpm deploy` 统一改写为 `pnpm run deploy`（部分 pnpm 版本会
  把 `pnpm deploy` 解析成内置命令）。

## [1.0.0] — 2026-10-05

首个公开发布版本。以下全部为新增内容。

### 新增

**Worker / API**

- 基于 Hono 的 Cloudflare Worker，同时提供 JSON API 与 SPA 静态资源。
- D1 表结构（`0001_init.sql`），包含 `nodes`、`metrics`、`ping_tasks`、`ping_records`、`users`、`sessions`、`settings` 与 `audit_logs`。
- `POST /api/v1/report` Agent 上报接收，支持令牌认证、指标校验、反范式（冗余存储）的 `nodes.latest` 更新，以及自动注册探测任务。
- 公开只读 API：`/api/status`、`/api/nodes`、`/api/nodes/:id`、`/api/nodes/:id/metrics`、`/api/nodes/:id/pings`、`/api/groups`。
- 服务端降采样：历史窗口超过 6 小时时最多返回 360 个数据点。
- 基于 PBKDF2-SHA256（100 000 次迭代）的会话认证、`HttpOnly` cookie、7 天 TTL，以及从 `ADMIN_PASSWORD` 密钥惰性初始化首位管理员。
- 完整的管理 API：节点 CRUD + 令牌轮换、探测任务 CRUD、设置、用户、审计日志、总览，以及手动保留期清理任务。变更类路由需要 `admin` 角色；`viewer` 账号为只读，任何写操作都会收到 `403`。
- `/api/*` 的 CORS、登录限流（每 IP 每 5 分钟 10 次尝试）、每次变更的审计日志。
- 每 5 分钟触发一次的定时任务，用于指标与探测结果保留期清理以及会话清理。在线状态在读取时由 `last_seen` 推导，因此没有需要清理的存储标志，也不会出现与实际状态不一致的情况。
- `custom_head` 可将运维方提供的 HTML 注入 SPA 外壳的 `<head>`。
- Vitest 测试套件通过 `@cloudflare/vitest-pool-workers` 针对真实 D1 运行。

**Web**

- React 19 + Vite + TypeScript SPA，使用 Tailwind CSS v4。
- 仪表盘包含状态条、分组筛选、搜索、响应式节点卡片网格与 10 秒自动刷新。
- 节点详情页包含 CPU/MEM/DISK 仪表、负载与流量卡片、ECharts 时间序列，以及带迷你趋势图的探测延迟表格；支持 1h/6h/24h/7d 范围切换。
- 管理后台：登录、节点管理（创建/编辑/隐藏/轮换/删除/排序）、探测任务管理、站点设置、用户与审计日志。
- 深色与浅色主题，无样式闪烁，并提供 `zh-CN` / `en` 语言切换。

**Agent**

- 纯标准库实现的 Go Agent（无外部依赖），支持 Linux、macOS 与 Windows。
- 采集 CPU、内存、Swap、磁盘、网络计数器与速率、TCP/UDP 套接字、进程数、在线时长与负载。
- ICMP / TCP / HTTP 延迟探测任务，由服务端通过上报响应进行调度。
- 指数退避（1 s → 60 s）、干净的 SIGINT/SIGTERM 退出、`-once` 空跑模式。
- 面向 systemd 主机的一行命令 `install.sh`、`-install` / `-uninstall` 自管理，以及 `build.sh` / `build.ps1` 交叉编译脚本。

**项目**

- GitHub Actions CI（Worker 测试、SPA 构建、Agent vet/build/交叉编译、契约文件检查），以及由标签触发的发布工作流，用于发布 Agent 二进制文件。
- 文档：部署指南、HTTP API 参考、架构说明、贡献指南、安全策略与已冻结的接口契约。

[1.0.0]: https://github.com/heshang2011/vps-dog/releases/tag/v1.0.0
