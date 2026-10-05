/**
 * Shared types for the VPS-DOG worker.
 * DTO shapes mirror docs/CONTRACT.md §3 exactly.
 */

// ── Worker bindings ─────────────────────────────────────────────────────────

/** Migration entry shape handed to `applyD1Migrations` by the test pool. */
export interface MigrationEntry {
  name: string;
  queries: string[];
}

export interface Env {
  DB: D1Database;
  /** Workers Static Assets binding. Optional: absent before `web/dist` exists. */
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  /** Bootstrap password for the initial `admin` user. Defaults to "admin". */
  ADMIN_PASSWORD?: string;
  /**
   * PBKDF2 iteration override (decimal string). Production default is 100000.
   * `wrangler.test.toml` sets a low value so the suite stays fast.
   */
  AUTH_ITERATIONS?: string;
  /** Injected by vitest-pool-workers; consumed by test/apply-migrations.ts. */
  TEST_MIGRATIONS?: MigrationEntry[];
}

/** Authenticated principal attached to the Hono context. */
export interface SessionUser {
  id: string;
  username: string;
  role: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser | null };
};

// ── DTOs (§3) ───────────────────────────────────────────────────────────────

/** The sample the agent sends and the worker stores. */
export interface MetricSample {
  cpu: number; // 0-100
  mem_used: number; // bytes
  mem_total: number;
  swap_used: number;
  swap_total: number;
  disk_used: number;
  disk_total: number;
  net_in: number; // cumulative bytes
  net_out: number;
  rx_rate: number; // bytes/sec over the last interval
  tx_rate: number;
  tcp: number;
  udp: number;
  process: number;
  uptime: number; // seconds
  load1: number;
  load5: number;
  load15: number;
}

export interface NodeSummary {
  id: string;
  name: string;
  group: string; // from group_name
  region: string;
  tags: string[];
  hidden: boolean;
  online: boolean;
  last_seen: number;
  uptime: number; // seconds
  created_at: number;
  metrics: MetricSample | null;
  // derived helpers computed by the worker
  cpu: number;
  mem_percent: number;
  disk_percent: number;
  load1: number;
}

export interface PingTaskSummary {
  id: string;
  name: string;
  type: 'icmp' | 'tcp' | 'http';
  target: string;
  interval: number;
  enabled: boolean;
  latest: { ts: number; value: number; ok: boolean } | null;
  avg_24h: number; // -1 when no data
  loss_24h: number; // 0-100
}

export interface NodeDetail extends NodeSummary {
  pings: PingTaskSummary[];
}

/** Admin view of a node: everything public plus the token hint. */
export interface AdminNode extends NodeSummary {
  token_hint: string;
  sort_order: number;
}

export interface PublicStatus {
  site_name: string;
  site_description: string;
  online: number;
  offline: number;
  total: number;
  generated_at: number;
}

/** GET /api/nodes/:id/metrics?hours=1 (§3.1) */
export interface MetricPoint {
  ts: number;
  cpu: number;
  mem_percent: number;
  disk_percent: number;
  rx_rate: number;
  tx_rate: number;
  load1: number;
  net_in: number;
  net_out: number;
}

export interface MetricSeries {
  node_id: string;
  from: number;
  to: number;
  step: number; // seconds per bucket (worker-side downsampling)
  points: MetricPoint[];
}

/** Ping series point returned by /api/nodes/:id/pings. */
export interface PingSeriesPoint {
  ts: number;
  value: number;
  ok: boolean;
}

export interface PingTaskWithSeries extends PingTaskSummary {
  series: PingSeriesPoint[];
}

// ── settings (§2.1) ─────────────────────────────────────────────────────────

export type ThemeSetting = 'auto' | 'light' | 'dark';

export interface Settings {
  site_name: string;
  site_description: string;
  report_interval: number;
  offline_after: number;
  retention_days: number;
  ping_retention_days: number;
  theme: ThemeSetting;
  custom_head: string;
  /**
   * Referenced by §4.1: when true an unknown agent token auto-registers a node.
   * Not listed in the §2.1 table but defaulted there to `false`.
   */
  allow_auto_register: boolean;
}

export type SettingsKey = keyof Settings;

/** Defaults from §2.1, merged by `getSettings()`. */
export const SETTINGS_DEFAULTS: Settings = {
  site_name: 'VPS-DOG',
  site_description: '',
  report_interval: 30,
  offline_after: 90,
  retention_days: 30,
  ping_retention_days: 7,
  theme: 'auto',
  custom_head: '',
  allow_auto_register: false,
};

export interface AuditLogRow {
  id: string;
  ts: number;
  user: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
}

export interface SweepCounts {
  metrics_deleted: number;
  ping_records_deleted: number;
  sessions_deleted: number;
  nodes_marked_offline: number;
}
