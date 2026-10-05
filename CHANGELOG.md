# 更新日志

本项目所有值得注意的变更都记录在此。
格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，且本项目遵循[语义化版本](https://semver.org/spec/v2.0.0.html)。

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
