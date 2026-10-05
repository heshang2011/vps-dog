# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-05

The first public release. Everything below is new.

### Added

**Worker / API**

- Hono-based Cloudflare Worker serving both the JSON API and the SPA static assets.
- D1 schema (`0001_init.sql`) with `nodes`, `metrics`, `ping_tasks`, `ping_records`,
  `users`, `sessions`, `settings` and `audit_logs`.
- `POST /api/v1/report` agent ingest with token auth, metric validation, denormalised
  `nodes.latest` updates and automatic probe registration.
- Public read API: `/api/status`, `/api/nodes`, `/api/nodes/:id`,
  `/api/nodes/:id/metrics`, `/api/nodes/:id/pings`, `/api/groups`.
- Server-side downsampling to at most 360 points for history windows longer than 6 hours.
- Session auth with PBKDF2-SHA256 (100 000 iterations), `HttpOnly` cookies, 7-day TTL,
  lazy bootstrap of the first admin from the `ADMIN_PASSWORD` secret.
- Full admin API: node CRUD + token rotation, probe CRUD, settings, users, audit log,
  overview and a manual retention sweep. Mutating routes require the `admin` role;
  `viewer` accounts are read-only and receive `403` on any write.
- CORS for `/api/*`, login rate limiting (10 attempts / 5 min / IP), audit logging of
  every mutation.
- Cron trigger every 5 minutes for metric and probe retention plus session cleanup.
  Online state is derived from `last_seen` at read time, so there is no stored flag
  to sweep and no chance of it disagreeing with reality.
- `custom_head` injects operator-supplied HTML into the SPA shell's `<head>`.
- Vitest suite running against a real D1 via `@cloudflare/vitest-pool-workers`.

**Web**

- React 19 + Vite + TypeScript SPA with Tailwind CSS v4.
- Dashboard with status strip, group filter, search, responsive node card grid and
  10-second auto-refresh.
- Node detail page with CPU/MEM/DISK gauges, load and traffic tiles, ECharts time series
  and a probe latency table with sparklines; 1h/6h/24h/7d range switch.
- Admin area: login, node management (create/edit/hide/rotate/delete/reorder), probe
  management, site settings, users and audit log.
- Dark and light themes with no flash of unstyled content, plus a `zh-CN` / `en`
  language toggle.

**Agent**

- Pure-stdlib Go agent (no external dependencies) for Linux, macOS and Windows.
- Collectors for CPU, memory, swap, disk, network counters and rates, TCP/UDP sockets,
  process count, uptime and load average.
- ICMP / TCP / HTTP latency probes, scheduled by the server through the report response.
- Exponential backoff (1 s → 60 s), clean SIGINT/SIGTERM shutdown, `-once` dry-run mode.
- One-line `install.sh` for systemd hosts, `-install` / `-uninstall` self-management, and
  `build.sh` / `build.ps1` cross-compile scripts.

**Project**

- GitHub Actions CI (worker tests, SPA build, agent vet/build/cross-compile, contract
  file check) and a tag-driven release workflow that publishes agent binaries.
- Documentation: deployment guide, HTTP API reference, architecture notes, contributing
  guide, security policy and the frozen interface contract.

[1.0.0]: https://github.com/vps-dog/vps-dog/releases/tag/v1.0.0
