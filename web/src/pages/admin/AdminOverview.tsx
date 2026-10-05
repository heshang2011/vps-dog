import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorBanner, PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { adminApi, errorMessage, qk } from '../../lib/api';
import { bytes, dateTime, int, percent } from '../../lib/format';
import { useI18n } from '../../lib/i18n';

/** `/admin/overview` — database + fleet summary from `GET /api/admin/overview`. */
export default function AdminOverview(): ReactNode {
  const { t } = useI18n();
  const overviewQuery = useQuery({
    queryKey: qk.adminOverview,
    queryFn: ({ signal }) => adminApi.overview(signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const data = overviewQuery.data;
  const healthPercent =
    data !== undefined && data.nodes > 0 ? (data.online / data.nodes) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.dashboard')} subtitle={t('app.tagline')} />

      {overviewQuery.isError ? (
        <ErrorBanner
          message={errorMessage(overviewQuery.error)}
          onRetry={() => void overviewQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      {overviewQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="card flex flex-col gap-2 p-4">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-7 w-16" />
            </div>
          ))}
        </div>
      ) : data === undefined ? null : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label={t('admin.overview.nodes')} value={int(data.nodes)} />
          <StatCard
            label={t('admin.overview.online')}
            value={int(data.online)}
            tone="success"
            hint={percent(healthPercent, 1)}
          />
          <StatCard
            label={t('admin.overview.offline')}
            value={int(data.offline)}
            tone={data.offline > 0 ? 'danger' : 'default'}
          />
          <StatCard label={t('admin.overview.rows')} value={int(data.metrics_rows)} />
          <StatCard
            label={t('admin.overview.oldest')}
            value={data.oldest_ts > 0 ? dateTime(data.oldest_ts).slice(0, 10) : '–'}
            hint={data.oldest_ts > 0 ? dateTime(data.oldest_ts) : undefined}
          />
          <StatCard label={t('admin.overview.d1')} value={bytes(data.d1_size)} />
        </div>
      )}
    </div>
  );
}
