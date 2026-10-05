import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Badge, StatusDot } from './Badge';
import { ProgressBar } from './ProgressBar';
import { bytes, duration, number, ratioPercent, rate, relativeTime, int } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useNow } from '../lib/useLive';
import type { NodeSummary } from '../lib/types';

export interface NodeCardProps {
  node: NodeSummary;
  /** Rendered in the top-right corner (admin quick actions, etc.). */
  actions?: ReactNode;
  /** Reference window used to scale the uptime bar. */
  uptimeWindowSeconds?: number;
}

/** One node in the dashboard grid: identity, live meters and traffic. */
export function NodeCard({
  node,
  actions,
  uptimeWindowSeconds = 30 * 86400,
}: NodeCardProps): ReactNode {
  const { t } = useI18n();
  const now = useNow(5_000);

  const online = node.online === true;
  const metrics = node.metrics;
  // Offline nodes (or nodes without a sample) render zeroed bars, never NaN.
  const cpu = online && metrics !== null ? metrics.cpu : 0;
  const memPercent = online && metrics !== null ? ratioPercent(metrics.mem_used, metrics.mem_total) : 0;
  const diskPercent =
    online && metrics !== null ? ratioPercent(metrics.disk_used, metrics.disk_total) : 0;
  const load1 = online && metrics !== null ? metrics.load1 : 0;
  const uptimeSeconds = online ? (metrics?.uptime ?? node.uptime) : node.uptime;

  const uptimeRatio =
    uptimeWindowSeconds > 0 ? Math.min(100, (Math.max(0, uptimeSeconds) / uptimeWindowSeconds) * 100) : 0;

  const memHint =
    metrics !== null && metrics.mem_total > 0
      ? `${bytes(metrics.mem_used, 1)} / ${bytes(metrics.mem_total, 1)}`
      : t('node.noMetrics');
  const diskHint =
    metrics !== null && metrics.disk_total > 0
      ? `${bytes(metrics.disk_used, 1)} / ${bytes(metrics.disk_total, 1)}`
      : t('node.noMetrics');

  const statusLabel = online ? t('status.online') : t('status.offline');

  return (
    <article
      className={`card group relative flex flex-col gap-4 p-5 hover:border-muted/40 ${
        online ? '' : 'opacity-80'
      }`}
    >
      {/* identity */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link
            to={`/node/${node.id}`}
            aria-label={t('node.viewDetails', { name: node.name })}
            className="flex items-center gap-2 truncate text-[15px] font-semibold text-text transition-colors duration-150 hover:text-accent"
          >
            <StatusDot online={online} label={statusLabel} />
            <span className="truncate">{node.name}</span>
          </Link>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">{node.group}</Badge>
            {node.region.length > 0 ? <Badge tone="muted">{node.region}</Badge> : null}
            {node.hidden ? <Badge tone="warn">{t('common.hidden')}</Badge> : null}
            {node.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
            {node.tags.length > 2 ? <Badge tone="neutral">+{node.tags.length - 2}</Badge> : null}
          </div>
        </div>
        {actions !== undefined ? (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
            {actions}
          </div>
        ) : null}
      </header>

      {/* meters */}
      <div className="flex flex-col gap-3">
        <ProgressBar
          label={t('node.cpu')}
          value={cpu}
          valueText={online ? undefined : t('node.offline')}
          tone={online ? undefined : 'muted'}
        />
        <ProgressBar
          label={t('node.mem')}
          value={memPercent}
          valueText={online ? undefined : t('node.offline')}
          tone={online ? undefined : 'muted'}
        />
        <ProgressBar
          label={t('node.disk')}
          value={diskPercent}
          valueText={online ? undefined : t('node.offline')}
          tone={online ? undefined : 'muted'}
        />
      </div>

      {/* figures */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">{t('node.load')}</dt>
          <dd className="num font-medium text-text">{online ? number(load1, 2) : '–'}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">{t('node.uptime')}</dt>
          <dd className="num font-medium text-text" title={`${int(uptimeSeconds)} s`}>
            {online ? duration(uptimeSeconds) : '–'}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted" title={t('node.rxRate')}>
            ↓ {t('node.rx')}
          </dt>
          <dd className="num font-medium text-text">{online ? rate(metrics?.rx_rate) : '–'}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted" title={t('node.txRate')}>
            ↑ {t('node.tx')}
          </dt>
          <dd className="num font-medium text-text">{online ? rate(metrics?.tx_rate) : '–'}</dd>
        </div>
      </dl>

      {/* uptime bar + freshness */}
      <footer className="flex flex-col gap-1.5">
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={`${t('node.uptime')}: ${duration(uptimeSeconds)}`}
          title={`${t('node.uptime')}: ${duration(uptimeSeconds)}`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              online ? 'bg-success/70' : 'bg-muted/40'
            }`}
            style={{ width: `${uptimeRatio}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="truncate" title={`${t('node.lastSeen')}: ${relativeTime(node.last_seen, now)}`}>
            {t('node.lastSeen')} {relativeTime(node.last_seen, now)}
          </span>
          {metrics !== null && metrics.mem_total > 0 ? (
            <span className="num hidden shrink-0 sm:inline" title={`${memHint} · ${diskHint}`}>
              {bytes(metrics.mem_used, 0)}/{bytes(metrics.mem_total, 0)}
            </span>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

/** Loading placeholder matching the card's rhythm. */
export function NodeCardSkeleton(): ReactNode {
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-2">
        <div className="skeleton h-4 w-32" />
        <div className="flex gap-1.5">
          <div className="skeleton h-4 w-16" />
          <div className="skeleton h-4 w-10" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <div className="flex justify-between">
              <div className="skeleton h-3 w-10" />
              <div className="skeleton h-3 w-8" />
            </div>
            <div className="skeleton h-1.5 w-full" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-1">
            <div className="skeleton h-3 w-10" />
            <div className="skeleton h-3.5 w-14" />
          </div>
        ))}
      </div>
      <div className="skeleton h-1 w-full" />
    </div>
  );
}
