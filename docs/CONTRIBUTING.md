# Contributing to VPS-DOG

Thanks for taking the time to contribute. This document covers the dev loop, the
conventions we care about, and how releases are cut.

## Getting set up

```bash
git clone https://github.com/heshang2011/vps-dog.git
cd vps-dog
pnpm install
```

You need Node ≥ 20, pnpm ≥ 9 and — only if you touch the agent — Go ≥ 1.22.

### Running the stack

```bash
# 1. local D1 + Worker API on http://127.0.0.1:8787
cd worker
npx wrangler d1 migrations apply vps-dog --local
npx wrangler dev --port 8787

# 2. SPA with /api proxied to the Worker, on http://localhost:5173
pnpm dev
```

Log in at `/admin` with `admin` / `admin` (or whatever `ADMIN_PASSWORD` you put in
`worker/.dev.vars`).

### Checks

```bash
pnpm typecheck        # worker + web
pnpm test             # worker vitest suite
cd web && pnpm build  # production SPA build
cd agent && go vet ./... && go build ./...
```

CI runs exactly these on every push and pull request.

## Repository conventions

- **The interface contract is [`docs/CONTRACT.md`](CONTRACT.md).** Schema, DTOs, routes
  and payload shapes are frozen there. Changing a cross-component interface means
  changing the contract in the same PR and updating every consumer.
- **Timestamps** are Unix epoch **seconds** (integers). **Bytes** are bytes.
  **Percentages** are 0–100. No floats-as-strings, no milliseconds.
- **SQL** lives in `worker/src/db.ts` and migrations. Routes never build SQL strings
  from user input — always prepared statements with `.bind()`.
- **Types** are shared through `worker/src/types.ts`; the SPA mirrors them in
  `web/src/lib/types.ts` (it cannot import across the build boundary).
- **No new runtime dependencies in the agent.** It must stay pure stdlib so it builds
  offline and stays under ~8 MB.
- **UI strings** go through `t()` in `web/src/lib/i18n.ts` — both `zh-CN` and `en`
  dictionaries must be updated together. Never hard-code user-visible text.

## Coding style

### TypeScript

- `strict: true`; avoid `any` in exported signatures.
- Prefer small pure helpers in `util.ts` / `format.ts` over inline logic in components.
- Every route validates its input and returns the documented error shape.
- Errors are `{ error, message }` with a correct status code; never leak stack traces.

### Go

- `gofmt` clean (`gofmt -w .` before committing).
- Errors are wrapped with context: `fmt.Errorf("collect cpu: %w", err)`.
- The collector must never panic: unknown platforms degrade to zeros.
- Log with the `[vps-dog]` prefix to stdout; systemd captures it.

### CSS / UI

- Tailwind v4, CSS-first: theme tokens live in `web/src/index.css` under `@theme`.
- Use semantic utilities (`bg-surface`, `text-muted`, `border-border`) rather than raw
  hex values in components, so both themes keep working.
- Every new component must look right in light **and** dark mode, and at 375 px wide.

## Adding a migration

```bash
cd worker
# create migrations/0002_your_change.sql  (never edit an applied migration)
npx wrangler d1 migrations apply vps-dog --local
```

Migrations are applied in filename order. Keep them idempotent where practical
(`CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`).

## Adding a metric

1. Add the field to `MetricSample` in `docs/CONTRACT.md` §3.
2. Add the column in a new migration and to `metrics` in §2.
3. Coerce it in the report handler (`worker/src/routes/agent.ts`).
4. Include it in the downsampler's `AVG`/`MAX` list (`worker/src/db.ts`).
5. Add it to `MetricSeries.points` and render it in `web/src/pages/NodeDetail.tsx`.
6. Collect it in `agent/internal/collector/`.

## Adding an API endpoint

1. Document it in `docs/CONTRACT.md` §4 **and** `docs/API.md`.
2. Implement it in the matching `worker/src/routes/*.ts` file.
3. Write a vitest case in `worker/test/api.test.ts` covering the happy path **and**
   the unauthenticated/unauthorized path.
4. Wire the client call in `web/src/lib/api.ts` and the UI that consumes it.

## Commit messages

Conventional-commit prefixes, imperative mood:

```
feat(worker): add per-node token rotation
fix(web): keep the node grid from overflowing at 320px
docs: document the sweep endpoint
chore(ci): cache the pnpm store
```

Keep PRs focused. A PR that changes the schema and redesigns the dashboard is two PRs.

## Pull request checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `cd web && pnpm build` passes
- [ ] `cd agent && go vet ./... && gofmt -l .` is clean (if you touched the agent)
- [ ] `docs/CONTRACT.md` updated if an interface changed
- [ ] New endpoints have tests and documentation
- [ ] UI changes verified in both themes and at mobile width

## Release process

1. Bump `version` in the root `package.json`, `worker/package.json`,
   `web/package.json` and `agent/version.go`.
2. `git tag v1.x.y && git push --tags`.
3. The `release` workflow cross-compiles the agent for all targets and attaches the
   binaries plus `install.sh` to the GitHub release.
4. `npx wrangler deploy` from `worker/` ships the Worker; the SPA is uploaded as part
   of the same deploy (assets binding).

## Reporting bugs

Please include: the deployed version, the exact `curl` or UI steps, the response, and
`npx wrangler tail` output if the Worker is involved. For security issues, open a
private advisory instead of a public issue.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](../LICENSE).
