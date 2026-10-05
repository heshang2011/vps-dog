/**
 * VPS-DOG worker integration suite.
 *
 * Runs inside the Workers runtime via `@cloudflare/vitest-pool-workers`, so the
 * real Hono app, the real D1 binding and real WebCrypto are exercised — nothing
 * is mocked. Requests go through the `SELF` service binding, which points at
 * `src/index.ts` (see vitest.config.ts).
 *
 * Migrations are applied per test by `test/apply-migrations.ts`.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearLoginRateLimits } from '../src/auth';
import type { MetricSample } from '../src/types';

const BASE = 'https://vps-dog.test';

/**
 * Tables cleared before every test.
 *
 * This pool version does not give each test its own storage snapshot, so the
 * suite resets the database itself. Tests therefore never depend on the order
 * they run in or on what a previous test left behind.
 */
const TABLES = [
  'metrics',
  'ping_records',
  'ping_tasks',
  'audit_logs',
  'sessions',
  'users',
  'nodes',
  'settings',
] as const;

async function resetDatabase(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
}

/** The app and the tests share an isolate, so the login limiter is the same Map. */
beforeEach(async () => {
  clearLoginRateLimits();
  await resetDatabase();
});

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(BASE + path, init);
}

function jsonInit(body: unknown, cookie?: string): RequestInit {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'CF-Connecting-IP': '10.0.0.1',
  };
  if (cookie) headers.cookie = cookie;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

function sample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    cpu: 10,
    mem_used: 100,
    mem_total: 400,
    swap_used: 0,
    swap_total: 0,
    disk_used: 50,
    disk_total: 100,
    net_in: 1000,
    net_out: 500,
    rx_rate: 10,
    tx_rate: 5,
    tcp: 3,
    udp: 1,
    process: 42,
    uptime: 3600,
    load1: 0.5,
    load5: 0.4,
    load15: 0.3,
    ...overrides,
  };
}

async function login(username = 'admin', password = 'admin') {
  const res = await api('/api/auth/login', jsonInit({ username, password }));
  const body = (await res.json()) as Record<string, unknown>;
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { status: res.status, body, cookie: setCookie.split(';')[0] ?? '' };
}

/** Log in, creating the bootstrap admin if the users table is still empty. */
async function adminCookie(): Promise<string> {
  const { cookie } = await login();
  expect(cookie).toMatch(/^vpsdog_session=/);
  return cookie;
}

async function createNode(cookie: string, name: string) {
  const res = await api(
    '/api/admin/nodes',
    jsonInit({ name, group: 'g1', region: 'HK', tags: ['prod', 'hk'] }, cookie),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { node: { id: string }; token: string };
  return body;
}

function reportInit(token: string, body: unknown, extraHeaders: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

describe('public read API', () => {
  it('GET /api/status on an empty DB returns zeros', async () => {
    const res = await api('/api/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.online).toBe(0);
    expect(body.offline).toBe(0);
    expect(body.total).toBe(0);
    expect(body.site_name).toBe('VPS-DOG');
    expect(typeof body.generated_at).toBe('number');
  });

  it('GET /api/nodes is empty and includes status', async () => {
    const res = await api('/api/nodes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: unknown[]; status: { total: number } };
    expect(body.nodes).toEqual([]);
    expect(body.status.total).toBe(0);
  });

  it('GET /api/groups is empty on a fresh DB', async () => {
    const res = await api('/api/groups');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { groups: unknown[] }).groups).toEqual([]);
  });

  it('returns a JSON 404 for an unknown API path', async () => {
    const res = await api('/api/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_found');
  });

  it('answers CORS preflight with the documented headers', async () => {
    const res = await api('/api/status', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
    expect(res.headers.get('access-control-allow-headers')).toContain('x-node-token');
  });

  it('echoes CORS headers on normal API responses', async () => {
    const res = await api('/api/status', { headers: { origin: 'https://app.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('auth', () => {
  it('bootstraps the admin user on first login', async () => {
    // Start from a genuinely empty users table so the bootstrap branch is hit
    // regardless of storage isolation between tests.
    await env.DB.exec('DELETE FROM sessions; DELETE FROM users;');

    const { status, body, cookie } = await login('admin', 'admin');
    expect(status).toBe(200);
    expect(body.bootstrap).toBe(true);
    expect((body.user as { username: string }).username).toBe('admin');
    expect(cookie).toMatch(/^vpsdog_session=[0-9a-f]{64}$/);

    const me = await api('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { username: string; role: string } };
    expect(meBody.user.username).toBe('admin');
    expect(meBody.user.role).toBe('admin');
  });

  it('rejects a wrong password with 401', async () => {
    await env.DB.exec('DELETE FROM sessions; DELETE FROM users;');
    await login('admin', 'admin');
    const { status, body } = await login('admin', 'not-the-password');
    expect(status).toBe(401);
    expect(body.error).toBe('unauthorized');
  });

  it('rejects a wrong bootstrap password when no users exist', async () => {
    await env.DB.exec('DELETE FROM sessions; DELETE FROM users;');
    const { status } = await login('admin', 'wrong');
    expect(status).toBe(401);
  });

  it('returns 401 from /api/auth/me without a session', async () => {
    const res = await api('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('accepts the session id as a bearer token', async () => {
    const { cookie } = await login();
    const sessionId = cookie.split('=')[1] ?? '';
    const res = await api('/api/auth/me', { headers: { authorization: `Bearer ${sessionId}` } });
    expect(res.status).toBe(200);
  });

  it('logs out and invalidates the session', async () => {
    const cookie = await adminCookie();
    const out = await api('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(200);
    const me = await api('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(401);
  });

  it('changes the password when the old one is correct', async () => {
    const cookie = await adminCookie();
    const res = await api('/api/auth/password', jsonInit({ old_password: 'admin', new_password: 's3cret' }, cookie));
    expect(res.status).toBe(200);
    // Put it back so later tests can keep using admin/admin.
    await api('/api/auth/password', jsonInit({ old_password: 's3cret', new_password: 'admin' }, cookie));
    const relogin = await login('admin', 'admin');
    expect(relogin.status).toBe(200);
  });
});

describe('admin node CRUD', () => {
  it('requires authentication', async () => {
    const res = await api('/api/admin/nodes');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('unauthorized');
  });

  it('creates a node and returns a 64-hex token once', async () => {
    const cookie = await adminCookie();
    const res = await api('/api/admin/nodes', jsonInit({ name: 'hk-01', group: 'asia', region: 'HK' }, cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; node: { id: string; name: string }; token: string };
    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.node.name).toBe('hk-01');

    const list = await api('/api/admin/nodes', { headers: { cookie } });
    const listBody = (await list.json()) as { nodes: Array<{ id: string; name: string; token_hint: string }> };
    const found = listBody.nodes.find((n) => n.id === body.node.id);
    expect(found).toBeDefined();
    expect(found?.token_hint).toBe(body.token.slice(0, 8));

    // The plaintext token is never stored.
    const row = await env.DB.prepare('SELECT token_hash FROM nodes WHERE id = ?')
      .bind(body.node.id)
      .first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(body.token);
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a duplicate node name with 409', async () => {
    const cookie = await adminCookie();
    await createNode(cookie, 'dup-01');
    const res = await api('/api/admin/nodes', jsonInit({ name: 'dup-01' }, cookie));
    expect(res.status).toBe(409);
  });

  it('rejects a nameless node with 400', async () => {
    const cookie = await adminCookie();
    const res = await api('/api/admin/nodes', jsonInit({}, cookie));
    expect(res.status).toBe(400);
  });

  it('deletes a node together with its metrics and pings', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'del-01');
    await api(
      '/api/v1/report',
      reportInit(token, { metrics: sample(), pings: [{ name: 'cf', type: 'tcp', target: '1.1.1.1:443', value: 5, ok: 1 }] }),
    );

    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM metrics WHERE node_id = ?')
      .bind(node.id)
      .first<{ c: number }>();
    expect(before?.c).toBeGreaterThan(0);

    const res = await api(`/api/admin/nodes/${node.id}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);

    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM metrics WHERE node_id = ?')
      .bind(node.id)
      .first<{ c: number }>();
    expect(after?.c).toBe(0);
    const pings = await env.DB.prepare('SELECT COUNT(*) AS c FROM ping_tasks WHERE node_id = ?')
      .bind(node.id)
      .first<{ c: number }>();
    expect(pings?.c).toBe(0);
    const gone = await api(`/api/nodes/${node.id}`);
    expect(gone.status).toBe(404);
  });

  it('rotates the agent token, invalidating the old one', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'rot-01');

    const first = await api('/api/v1/report', reportInit(token, { metrics: sample() }));
    expect(first.status).toBe(200);

    const rot = await api(`/api/admin/nodes/${node.id}/token`, {
      method: 'POST',
      headers: { cookie, 'CF-Connecting-IP': '10.0.0.1' },
    });
    expect(rot.status).toBe(200);
    const newToken = ((await rot.json()) as { token: string }).token;
    expect(newToken).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken).not.toBe(token);

    const oldRes = await api('/api/v1/report', reportInit(token, { metrics: sample() }));
    expect(oldRes.status).toBe(401);

    const newRes = await api('/api/v1/report', reportInit(newToken, { metrics: sample() }));
    expect(newRes.status).toBe(200);
  });

  it('records an audit row for every mutating call', async () => {
    const cookie = await adminCookie();
    await createNode(cookie, 'audit-01');
    const res = await api('/api/admin/audit?limit=50', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { audit: Array<{ action: string; user: string; ip: string }> };
    const created = body.audit.find((a) => a.action === 'node.create');
    expect(created).toBeDefined();
    expect(created?.user).toBe('admin');
    expect(created?.ip).toBe('10.0.0.1');
  });
});

describe('agent ingest', () => {
  it('accepts a report and makes the node appear online with derived metrics', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'ing-01');

    const res = await api(
      '/api/v1/report',
      reportInit(token, {
        name: 'ing-01',
        version: '1.0.0',
        host: { os: 'Ubuntu 24.04', arch: 'x86_64', region: 'HK' },
        metrics: sample({ cpu: 25.5, mem_used: 50, mem_total: 100, disk_used: 30, disk_total: 60, load1: 1.25 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.node_id).toBe(node.id);
    expect(body.interval).toBe(30);
    expect(typeof body.server_time).toBe('number');
    expect(Array.isArray(body.pings)).toBe(true);

    const nodes = await api('/api/nodes');
    const list = (await nodes.json()) as {
      nodes: Array<{ id: string; online: boolean; cpu: number; mem_percent: number; disk_percent: number; load1: number }>;
    };
    const found = list.nodes.find((n) => n.id === node.id);
    expect(found).toBeDefined();
    expect(found?.online).toBe(true);
    expect(found?.cpu).toBeCloseTo(25.5, 2);
    expect(found?.mem_percent).toBeCloseTo(50, 2);
    expect(found?.disk_percent).toBeCloseTo(50, 2);
    expect(found?.load1).toBeCloseTo(1.25, 2);
  });

  it('stores two reports as two history points', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'hist-01');
    const t0 = nowSec();

    const first = await api('/api/v1/report', reportInit(token, { ts: t0 - 60, metrics: sample({ cpu: 10 }) }));
    expect(first.status).toBe(200);
    const second = await api('/api/v1/report', reportInit(token, { ts: t0, metrics: sample({ cpu: 30 }) }));
    expect(second.status).toBe(200);

    const res = await api(`/api/nodes/${node.id}/metrics?hours=1`);
    expect(res.status).toBe(200);
    const series = (await res.json()) as { step: number; points: Array<{ ts: number; cpu: number }> };
    expect(series.step).toBe(1);
    expect(series.points.length).toBe(2);
    expect(series.points[0]?.cpu).toBeCloseTo(10, 2);
    expect(series.points[1]?.cpu).toBeCloseTo(30, 2);
    // Sorted ascending.
    expect(series.points[0]!.ts).toBeLessThan(series.points[1]!.ts);
  });

  it('rejects a bad token with 401', async () => {
    const res = await api('/api/v1/report', reportInit('f'.repeat(64), { metrics: sample() }));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('unauthorized');
  });

  it('rejects a missing token with 401', async () => {
    const res = await api('/api/v1/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metrics: sample() }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a body without metrics with 400', async () => {
    const cookie = await adminCookie();
    const { token } = await createNode(cookie, 'bad-01');
    const res = await api('/api/v1/report', reportInit(token, { name: 'bad-01' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('bad_request');
  });

  it('rejects malformed JSON with 400', async () => {
    const cookie = await adminCookie();
    const { token } = await createNode(cookie, 'bad-02');
    const res = await api('/api/v1/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('coerces missing numeric fields to zero', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'coerce-01');
    const res = await api('/api/v1/report', reportInit(token, { metrics: { cpu: 5 } }));
    expect(res.status).toBe(200);

    const detail = await api(`/api/nodes/${node.id}`);
    const body = (await detail.json()) as { metrics: Record<string, number> };
    expect(body.metrics.cpu).toBe(5);
    for (const key of ['mem_used', 'mem_total', 'net_in', 'net_out', 'rx_rate', 'uptime', 'load1']) {
      expect(body.metrics[key]).toBe(0);
    }
  });

  it('accepts the token via X-Node-Token', async () => {
    const cookie = await adminCookie();
    const { token } = await createNode(cookie, 'hdr-01');
    const res = await api('/api/v1/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-node-token': token },
      body: JSON.stringify({ metrics: sample() }),
    });
    expect(res.status).toBe(200);
  });
});

describe('metrics downsampling', () => {
  it('buckets a 24h window into at most 360 points', async () => {
    const cookie = await adminCookie();
    const { node } = await createNode(cookie, 'down-01');
    const t0 = nowSec();

    // 400 raw rows spread across the last 24h.
    //
    // NOTE: `D1Database.exec()` splits its input on newlines and runs each line
    // as a separate statement, so the SQL below MUST be built as a single line.
    // (A multi-line template literal yields "...incomplete input: SQLITE_ERROR".)
    // It is also one statement, so the 100-bound-parameter limit does not apply.
    const rows: string[] = [];
    for (let i = 0; i < 400; i++) {
      const ts = t0 - 86400 + i * 216;
      rows.push(`('${node.id}', ${ts}, 10, 100, 400, 0, 0, 50, 100, ${1000 + i}, ${500 + i}, 1, 1, 1, 1, 1, 1, 0.5, 0.4, 0.3)`);
    }
    await env.DB.exec(
      'INSERT INTO metrics (node_id, ts, cpu, mem_used, mem_total, swap_used, swap_total, disk_used,' +
        ' disk_total, net_in, net_out, rx_rate, tx_rate, tcp, udp, process, uptime, load1, load5, load15)' +
        ` VALUES ${rows.join(',')}`,
    );

    const res = await api(`/api/nodes/${node.id}/metrics?hours=24`);
    expect(res.status).toBe(200);
    const series = (await res.json()) as {
      step: number;
      points: Array<{ ts: number; cpu: number; mem_percent: number; net_in: number }>;
    };
    expect(series.step).toBeGreaterThanOrEqual(240);
    expect(series.points.length).toBeLessThanOrEqual(360);
    expect(series.points.length).toBeGreaterThan(300);

    // Bucket keys are aligned to the step, and cumulative counters use MAX.
    for (const point of series.points) {
      expect(point.ts % series.step).toBe(0);
    }
    const maxNet = Math.max(...series.points.map((p) => p.net_in));
    expect(maxNet).toBeGreaterThanOrEqual(1000);
  });

  it('returns raw rows for hours <= 6', async () => {
    const cookie = await adminCookie();
    const { node } = await createNode(cookie, 'raw-01');
    const t0 = nowSec();
    await env.DB.exec(
      'INSERT INTO metrics (node_id, ts, cpu, mem_used, mem_total, swap_used, swap_total, disk_used,' +
        ' disk_total, net_in, net_out, rx_rate, tx_rate, tcp, udp, process, uptime, load1, load5, load15) VALUES ' +
        `('${node.id}', ${t0 - 10}, 1, 1, 2, 0, 0, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1), ` +
        `('${node.id}', ${t0 - 5}, 2, 1, 2, 0, 0, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1)`,
    );
    const res = await api(`/api/nodes/${node.id}/metrics?hours=6`);
    const series = (await res.json()) as { step: number; points: unknown[] };
    expect(series.step).toBe(1);
    expect(series.points.length).toBe(2);
  });

  it('clamps hours into 1..168', async () => {
    const cookie = await adminCookie();
    const { node } = await createNode(cookie, 'clamp-01');
    // Anything below 1 (or unparseable) clamps up to 1, which is the raw path.
    for (const hours of ['0', 'abc', '-5', '']) {
      const res = await api(`/api/nodes/${node.id}/metrics?hours=${hours}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { step: number }).step).toBe(1);
    }
    // 999 clamps down to 168 => step = ceil(168*3600/360).
    const res = await api(`/api/nodes/${node.id}/metrics?hours=999`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { step: number }).step).toBe(Math.ceil((168 * 3600) / 360));
  });
});

describe('visibility', () => {
  it('hides a node from the public list and drops it from the status totals', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'hide-01');
    await api('/api/v1/report', reportInit(token, { metrics: sample() }));

    const visible = await api('/api/nodes');
    expect(((await visible.json()) as { nodes: unknown[] }).nodes.some((n) => (n as { id: string }).id === node.id)).toBe(true);
    const statusBefore = (await (await api('/api/status')).json()) as { total: number; online: number };
    expect(statusBefore.total).toBe(1);
    expect(statusBefore.online).toBe(1);

    const patch = await api(
      `/api/admin/nodes/${node.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie, 'CF-Connecting-IP': '10.0.0.1' },
        body: JSON.stringify({ hidden: true, name: 'hide-01-renamed' }),
      },
    );
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { node: { hidden: boolean; name: string } }).node.hidden).toBe(true);

    const after = await api('/api/nodes');
    const afterBody = (await after.json()) as { nodes: Array<{ id: string }>; status: { total: number; online: number } };
    expect(afterBody.nodes.some((n) => n.id === node.id)).toBe(false);
    expect(afterBody.status.total).toBe(0);
    expect(afterBody.status.online).toBe(0);

    // Public direct access 404s, admin direct access still works.
    expect((await api(`/api/nodes/${node.id}`)).status).toBe(404);
    const asAdmin = await api(`/api/nodes/${node.id}`, { headers: { cookie } });
    expect(asAdmin.status).toBe(200);
    expect(((await asAdmin.json()) as { name: string }).name).toBe('hide-01-renamed');
  });

  it('reports a node as offline once last_seen is older than offline_after', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'off-01');
    await api('/api/v1/report', reportInit(token, { metrics: sample() }));
    await env.DB.prepare('UPDATE nodes SET last_seen = ? WHERE id = ?').bind(nowSec() - 600, node.id).run();

    const res = await api('/api/nodes');
    const body = (await res.json()) as { nodes: Array<{ id: string; online: boolean }>; status: { offline: number } };
    expect(body.nodes.find((n) => n.id === node.id)?.online).toBe(false);
    expect(body.status.offline).toBeGreaterThanOrEqual(1);
  });

  it('groups nodes by group_name', async () => {
    const cookie = await adminCookie();
    await createNode(cookie, 'grp-01');
    const res = await api('/api/groups');
    const body = (await res.json()) as { groups: Array<{ name: string; count: number }> };
    expect(body.groups.find((g) => g.name === 'g1')?.count).toBeGreaterThanOrEqual(1);
  });
});

describe('ping flow', () => {
  it('auto-creates a task from a report and summarises it', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'ping-01');
    const t0 = nowSec();

    const res = await api(
      '/api/v1/report',
      reportInit(token, {
        ts: t0,
        metrics: sample(),
        pings: [{ name: 'cloudflare', type: 'tcp', target: '1.1.1.1:443', value: 12.3, ok: 1 }],
      }),
    );
    expect(res.status).toBe(200);
    // The node's enabled tasks are returned so the agent knows what to probe.
    const body = (await res.json()) as { pings: Array<{ id: string; name: string; target: string; interval: number }> };
    expect(body.pings.length).toBe(1);
    expect(body.pings[0]?.name).toBe('cloudflare');
    expect(body.pings[0]?.target).toBe('1.1.1.1:443');
    expect(body.pings[0]?.interval).toBe(60);

    const stored = await env.DB.prepare('SELECT COUNT(*) AS c FROM ping_tasks WHERE node_id = ?')
      .bind(node.id)
      .first<{ c: number }>();
    expect(stored?.c).toBe(1);

    const pingsRes = await api(`/api/nodes/${node.id}/pings`);
    expect(pingsRes.status).toBe(200);
    const pings = (await pingsRes.json()) as {
      pings: Array<{ name: string; type: string; latest: { value: number; ok: boolean } | null; avg_24h: number; loss_24h: number }>;
    };
    expect(pings.pings.length).toBe(1);
    expect(pings.pings[0]?.name).toBe('cloudflare');
    expect(pings.pings[0]?.type).toBe('tcp');
    expect(pings.pings[0]?.latest?.value).toBeCloseTo(12.3, 2);
    expect(pings.pings[0]?.latest?.ok).toBe(true);
    expect(pings.pings[0]?.avg_24h).toBeCloseTo(12.3, 2);
    expect(pings.pings[0]?.loss_24h).toBe(0);
  });

  it('records a failed probe as loss without polluting the average', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'ping-02');
    const t0 = nowSec();
    await api(
      '/api/v1/report',
      reportInit(token, {
        ts: t0 - 60,
        metrics: sample(),
        pings: [{ name: 'down', type: 'icmp', target: '10.0.0.9', value: -1, ok: 0 }],
      }),
    );
    await api(
      '/api/v1/report',
      reportInit(token, {
        ts: t0,
        metrics: sample(),
        pings: [{ name: 'down', type: 'icmp', target: '10.0.0.9', value: 20, ok: 1 }],
      }),
    );

    const pings = (await (await api(`/api/nodes/${node.id}/pings`)).json()) as {
      pings: Array<{ avg_24h: number; loss_24h: number; latest: { value: number; ok: boolean } }>;
    };
    expect(pings.pings[0]?.avg_24h).toBeCloseTo(20, 2);
    expect(pings.pings[0]?.loss_24h).toBeCloseTo(50, 2);
    expect(pings.pings[0]?.latest?.value).toBeCloseTo(20, 2);
  });

  it('supports admin ping task CRUD', async () => {
    const cookie = await adminCookie();
    const { node } = await createNode(cookie, 'ping-03');
    const headers = { 'content-type': 'application/json', cookie, 'CF-Connecting-IP': '10.0.0.1' };

    const create = await api(
      '/api/admin/pings',
      { method: 'POST', headers, body: JSON.stringify({ node_id: node.id, name: 'gw', type: 'http', target: 'https://example.com', interval: 120 }) },
    );
    expect(create.status).toBe(200);
    const created = ((await create.json()) as { ping: { id: string; interval: number; type: string } }).ping;
    expect(created.interval).toBe(120);
    expect(created.type).toBe('http');

    const list = await api(`/api/admin/pings?node_id=${node.id}`, { headers: { cookie } });
    expect(((await list.json()) as { pings: unknown[] }).pings.length).toBe(1);

    const patch = await api(
      `/api/admin/pings/${created.id}`,
      { method: 'PATCH', headers, body: JSON.stringify({ enabled: false, interval: 300 }) },
    );
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { ping: { enabled: boolean; interval: number } }).ping.enabled).toBe(false);

    const del = await api(`/api/admin/pings/${created.id}`, { method: 'DELETE', headers: { cookie, 'CF-Connecting-IP': '10.0.0.1' } });
    expect(del.status).toBe(200);
    expect((await api(`/api/admin/pings?node_id=${node.id}`, { headers: { cookie } })).status).toBe(200);
  });

  it('disables a task so it is no longer handed to the agent', async () => {
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'ping-04');
    await api(
      '/api/v1/report',
      reportInit(token, { metrics: sample(), pings: [{ name: 'x', type: 'tcp', target: 'a:1', value: 1, ok: 1 }] }),
    );
    const taskId = (
      await env.DB.prepare('SELECT id FROM ping_tasks WHERE node_id = ?').bind(node.id).first<{ id: string }>()
    )?.id;
    await api(`/api/admin/pings/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie, 'CF-Connecting-IP': '10.0.0.1' },
      body: JSON.stringify({ enabled: false }),
    });

    const res = await api('/api/v1/report', reportInit(token, { metrics: sample() }));
    expect(((await res.json()) as { pings: unknown[] }).pings).toEqual([]);
  });
});

describe('settings', () => {
  it('returns the merged defaults', async () => {
    const cookie = await adminCookie();
    const res = await api('/api/admin/settings', { headers: { cookie } });
    expect(res.status).toBe(200);
    const settings = ((await res.json()) as { settings: Record<string, unknown> }).settings;
    expect(settings.site_name).toBe('VPS-DOG');
    expect(settings.report_interval).toBe(30);
    expect(settings.offline_after).toBe(90);
    expect(settings.retention_days).toBe(30);
    expect(settings.theme).toBe('auto');
    // `show_public_ip` was removed: the schema has no IP column, so the setting
    // could never have had an effect. It must not come back without a consumer.
    expect(settings.show_public_ip).toBe(undefined);
    expect(settings.custom_head).toBe('');
  });

  it('applies a partial update and reflects it in /api/status', async () => {
    const cookie = await adminCookie();
    const res = await api('/api/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie, 'CF-Connecting-IP': '10.0.0.1' },
      body: JSON.stringify({ site_name: 'DogWatch', site_description: 'woof', theme: 'dark', unknown_key: 'ignored' }),
    });
    expect(res.status).toBe(200);

    const status = (await (await api('/api/status')).json()) as { site_name: string; site_description: string };
    expect(status.site_name).toBe('DogWatch');
    expect(status.site_description).toBe('woof');

    const stored = await env.DB.prepare("SELECT COUNT(*) AS c FROM settings WHERE key = 'unknown_key'").first<{ c: number }>();
    expect(stored?.c).toBe(0);
  });

  it('honours a shorter report_interval in the ingest response', async () => {
    const cookie = await adminCookie();
    const { token } = await createNode(cookie, 'set-01');
    await api('/api/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie, 'CF-Connecting-IP': '10.0.0.1' },
      body: JSON.stringify({ report_interval: 45 }),
    });
    const res = await api('/api/v1/report', reportInit(token, { metrics: sample() }));
    expect(((await res.json()) as { interval: number }).interval).toBe(45);
    // Restore the default for other tests.
    await api('/api/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie, 'CF-Connecting-IP': '10.0.0.1' },
      body: JSON.stringify({ report_interval: 30 }),
    });
  });
});

describe('users', () => {
  it('creates and lists users without leaking hashes', async () => {
    const cookie = await adminCookie();
    const res = await api('/api/admin/users', jsonInit({ username: 'viewer1', password: 'pw', role: 'viewer' }, cookie));
    expect(res.status).toBe(200);

    const list = await api('/api/admin/users', { headers: { cookie } });
    const body = (await list.json()) as { users: Array<Record<string, unknown>> };
    const found = body.users.find((u) => u.username === 'viewer1');
    expect(found).toBeDefined();
    expect(found?.role).toBe('viewer');
    expect(found?.password_hash).toBeUndefined();
  });

  it('refuses to delete the acting user', async () => {
    const cookie = await adminCookie();
    const me = (await (await api('/api/auth/me', { headers: { cookie } })).json()) as { user: { id: string } };
    const res = await api(`/api/admin/users/${me.user.id}`, {
      method: 'DELETE',
      headers: { cookie, 'CF-Connecting-IP': '10.0.0.1' },
    });
    expect(res.status).toBe(403);
  });
});

describe('viewer role', () => {
  /** Create a viewer account as the bootstrap admin and log in as it. */
  async function viewerCookie(): Promise<string> {
    const admin = await adminCookie();
    const created = await api(
      '/api/admin/users',
      jsonInit({ username: 'viewer1', password: 'viewer-pw', role: 'viewer' }, admin),
    );
    expect(created.status).toBe(200);
    const { cookie } = await login('viewer1', 'viewer-pw');
    expect(cookie).toMatch(/^vpsdog_session=/);
    return cookie;
  }

  it('can read the admin surface', async () => {
    const cookie = await viewerCookie();
    for (const path of ['/api/admin/nodes', '/api/admin/pings', '/api/admin/settings', '/api/admin/overview']) {
      expect((await api(path, { headers: { cookie } })).status).toBe(200);
    }
  });

  it('cannot mutate anything', async () => {
    const cookie = await viewerCookie();
    const attempts: Array<[string, string, unknown?]> = [
      ['POST', '/api/admin/nodes', { name: 'nope' }],
      ['PATCH', '/api/admin/nodes/whatever', { hidden: true }],
      ['DELETE', '/api/admin/nodes/whatever'],
      ['POST', '/api/admin/nodes/whatever/token'],
      ['POST', '/api/admin/pings', { node_id: 'x', name: 'p', type: 'tcp', target: '1.1.1.1:1' }],
      ['PATCH', '/api/admin/pings/whatever', { enabled: false }],
      ['DELETE', '/api/admin/pings/whatever'],
      ['PUT', '/api/admin/settings', { site_name: 'pwned' }],
      ['POST', '/api/admin/users', { username: 'evil', password: 'pw', role: 'admin' }],
      ['DELETE', '/api/admin/users/whatever'],
      ['POST', '/api/admin/sweep'],
    ];
    for (const [method, path, body] of attempts) {
      const res = await api(path, {
        method,
        headers: { 'content-type': 'application/json', cookie, 'CF-Connecting-IP': '10.0.0.1' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(res.status, `${method} ${path} must be forbidden for a viewer`).toBe(403);
    }
    // Nothing leaked through: the site name is untouched.
    const status = (await (await api('/api/status')).json()) as { site_name: string };
    expect(status.site_name).toBe('VPS-DOG');
  });
});

describe('sweep', () => {
  it('purges metrics older than retention_days and reports counts', async () => {
    const cookie = await adminCookie();
    const { node } = await createNode(cookie, 'sweep-01');
    const t0 = nowSec();
    const ancient = t0 - 40 * 86400; // default retention is 30 days

    await env.DB.exec(
      'INSERT INTO metrics (node_id, ts, cpu, mem_used, mem_total, swap_used, swap_total, disk_used,' +
        ' disk_total, net_in, net_out, rx_rate, tx_rate, tcp, udp, process, uptime, load1, load5, load15) VALUES ' +
        `('${node.id}', ${ancient}, 1, 1, 2, 0, 0, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`,
    );
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM metrics WHERE ts < ?')
      .bind(t0 - 30 * 86400)
      .first<{ c: number }>();
    expect(before?.c).toBe(1);

    const res = await api('/api/admin/sweep', {
      method: 'POST',
      headers: { cookie, 'CF-Connecting-IP': '10.0.0.1' },
    });
    expect(res.status).toBe(200);
    const counts = (await res.json()) as Record<string, number>;
    expect(counts.ok).toBe(true);
    expect(counts.metrics_deleted).toBeGreaterThanOrEqual(1);
    expect(typeof counts.ping_records_deleted).toBe('number');
    expect(typeof counts.sessions_deleted).toBe('number');
    expect(typeof counts.nodes_marked_offline).toBe('number');

    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM metrics WHERE ts < ?')
      .bind(t0 - 30 * 86400)
      .first<{ c: number }>();
    expect(after?.c).toBe(0);
  });

  it('reports a stale node as offline without storing a flag', async () => {
    // `online` is derived from `last_seen` at read time, so a node that goes
    // quiet is reported offline by the public API with no sweep required.
    const cookie = await adminCookie();
    const { node, token } = await createNode(cookie, 'sweep-02');
    await api('/api/v1/report', reportInit(token, { metrics: sample() }));
    await env.DB.prepare('UPDATE nodes SET last_seen = ? WHERE id = ?')
      .bind(nowSec() - 1000, node.id)
      .run();

    const body = (await (await api('/api/nodes')).json()) as {
      nodes: Array<{ id: string; online: boolean }>;
      status: { online: number; offline: number };
    };
    expect(body.nodes.find((n) => n.id === node.id)?.online).toBe(false);
    expect(body.status.offline).toBe(1);
    expect(body.status.online).toBe(0);
  });

  it('drops expired sessions', async () => {
    // Expire the first session, then authenticate the sweep with a fresh one so
    // the request itself is still authorised.
    await adminCookie();
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(nowSec() - 10).run();
    const cookie = await adminCookie();

    const res = await api('/api/admin/sweep', {
      method: 'POST',
      headers: { cookie, 'CF-Connecting-IP': '10.0.0.1' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sessions_deleted: number }).sessions_deleted).toBeGreaterThanOrEqual(1);
  });

  it('requires auth', async () => {
    const res = await api('/api/admin/sweep', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('overview', () => {
  it('summarises nodes and metric rows', async () => {
    const cookie = await adminCookie();
    const { token } = await createNode(cookie, 'ov-01');
    await api('/api/v1/report', reportInit(token, { metrics: sample() }));

    const res = await api('/api/admin/overview', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.nodes).toBeGreaterThanOrEqual(1);
    expect(body.online).toBeGreaterThanOrEqual(1);
    expect(body.metrics_rows).toBeGreaterThanOrEqual(1);
    expect(typeof body.d1_size).toBe('number');
  });
});

describe('static assets fallback', () => {
  it('serves a helpful page when the ASSETS binding is absent', async () => {
    const res = await api('/some/spa/route');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('pnpm build');
  });

  it('never returns HTML for an unknown /api path', async () => {
    const res = await api('/api/definitely-not-here');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
