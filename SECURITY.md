# Security Policy

## Supported versions

Only the latest release of the Worker and the agent receives security fixes.

| Component | Supported |
| --- | --- |
| Worker / SPA (latest tag) | ✅ |
| Agent (latest tag) | ✅ |
| Older tags | ❌ |

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
go to the repository's **Security** tab → **Report a vulnerability**.

Please include:

- affected component and version/commit,
- a description of the issue and its impact,
- reproduction steps or a proof of concept,
- any suggested mitigation.

You can expect an initial response within 72 hours. We will credit you in the release
notes unless you prefer to stay anonymous.

## Threat model

VPS-DOG is a self-hosted monitoring panel. The security-relevant assets are:

1. **Agent tokens** — grant the ability to submit metrics for one node.
2. **Admin sessions** — grant full control over nodes, users and settings.
3. **The D1 database** — contains password hashes, session ids and metric history.

In scope:

- Authentication and session handling in `worker/src/auth.ts`.
- Authorization of every `/api/admin/*` route.
- Input validation on `/api/v1/report` (an agent token is semi-trusted: it may be
  leaked from a compromised host).
- Injection via SQL, HTML (`custom_head`) or the SPA.
- Denial of service through unbounded request bodies or row growth.

Out of scope:

- Attacks that require an already-compromised Cloudflare account.
- The inherent visibility of the public `/api/status` and `/api/nodes` endpoints —
  hiding a node is supported via the `hidden` flag.
- In-memory login rate limiting being per-isolate; this is a documented, deliberate
  best-effort trade-off.

## Hardening checklist for operators

- [ ] Set a strong `ADMIN_PASSWORD` secret **before** the first login.
- [ ] Change the bootstrap password immediately afterwards.
- [ ] Add a Cloudflare WAF rate-limiting rule on `/api/auth/login` for defence in depth.
- [ ] Rotate agent tokens if a monitored host is compromised (`/admin/nodes` → rotate).
- [ ] Review `/admin/audit` periodically.
- [ ] Take D1 exports regularly — a lost database means lost history.

## Built-in protections

- PBKDF2-SHA256, 100 000 iterations, per-user random salt, constant-time comparison.
- Agent tokens stored only as SHA-256 hashes; plaintext shown once at creation.
- Sessions are 32 random bytes, server-side revocable, `HttpOnly; SameSite=Lax; Secure`.
- Login throttled to 10 attempts per 5 minutes per IP.
- All SQL uses prepared statements with bound parameters.
- Every admin mutation is written to the audit log.
- `X-Content-Type-Options: nosniff` on responses.
