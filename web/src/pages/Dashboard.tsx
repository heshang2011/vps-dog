import { useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { NodeCard, NodeCardSkeleton } from '../components/NodeCard';
import { Spinner } from '../components/Spinner';
import { errorMessage } from '../lib/api';
import { int, relativeTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useDebounced, useGroups, useNodesLive, useNow } from '../lib/useLive';
import type { NodeSummary } from '../lib/types';

function StatusStrip(): ReactNode {
  const { t } = useI18n();
  const { data, isPending } = useNodesLive();
  const now = useNow(5_000);

  if (isPending || data === undefined) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card flex flex-col gap-2 p-4">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-7 w-12" />
          </div>
        ))}
      </div>
    );
  }

  const { status } = data;
  const healthy = status.total > 0 && status.offline === 0;
  const stats: Array<{ key: string; label: string; value: string; className: string }> = [
    {
      key: 'online',
      label: t('status.online'),
      value: int(status.online),
      className: 'text-success',
    },
    {
      key: 'offline',
      label: t('status.offline'),
      value: int(status.offline),
      className: status.offline > 0 ? 'text-danger' : 'text-muted',
    },
    { key: 'total', label: t('status.total'), value: int(status.total), className: 'text-text' },
    {
      key: 'health',
      label: t('status.live'),
      value: status.total === 0 ? '–' : healthy ? '100%' : `${Math.round((status.online / status.total) * 100)}%`,
      className: healthy ? 'text-success' : 'text-warn',
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.key} className="card flex flex-col gap-1.5 p-4">
            <span className="text-xs font-medium text-muted">{stat.label}</span>
            <span className={`num text-2xl leading-none font-semibold ${stat.className}`}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted">
        {t('dashboard.generatedAt')} {relativeTime(status.generated_at, now)}
      </p>
    </div>
  );
}

export default function Dashboard(): ReactNode {
  const { t } = useI18n();
  const { data, isPending, isError, error, refetch, isFetching } = useNodesLive();
  const groupsQuery = useGroups();

  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const [showHidden, setShowHidden] = useState(false);
  const debouncedSearch = useDebounced(search, 180);

  const nodes = useMemo<ReadonlyArray<NodeSummary>>(() => data?.nodes ?? [], [data]);

  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      if (node.hidden && !showHidden) continue;
      counts.set(node.group, (counts.get(node.group) ?? 0) + 1);
    }
    // Prefer the worker's aggregate when it is available.
    for (const entry of groupsQuery.data?.groups ?? []) {
      if (!counts.has(entry.name)) counts.set(entry.name, entry.count);
    }
    return [
      { value: 'all', label: t('dashboard.allGroups') },
      ...[...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ value: name, label: `${name} (${count})` })),
    ];
  }, [nodes, groupsQuery.data, showHidden, t]);

  const filtered = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return nodes.filter((node) => {
      if (node.hidden && !showHidden) return false;
      if (group !== 'all' && node.group !== group) return false;
      if (needle.length === 0) return true;
      const haystack = [node.name, node.group, node.region, ...node.tags].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [nodes, debouncedSearch, group, showHidden]);

  const filtersActive = debouncedSearch.trim().length > 0 || group !== 'all' || showHidden;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-lg font-semibold tracking-tight text-text">
              {t('nav.dashboard')}
            </h1>
            <p className="text-xs text-muted">
              {t('dashboard.autoRefresh', { seconds: 10 })}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refetch()}
            loading={isFetching && !isPending}
            icon={
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path
                  d="M13.3 6.7A5.4 5.4 0 0 0 3.4 5.2M2.7 9.3a5.4 5.4 0 0 0 9.9 1.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M13.6 3.4v3.4h-3.4M2.4 12.6V9.2h3.4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          >
            {t('common.refresh')}
          </Button>
        </div>

        <StatusStrip />

        {/* filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label={t('dashboard.search')}
              placeholder={t('dashboard.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t('dashboard.searchLabel')}
              type="search"
            />
          </div>
          <div className="sm:w-56">
            <Select
              label={t('dashboard.groupLabel')}
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              options={groupOptions}
            />
          </div>
          <label className="flex h-9.5 cursor-pointer items-center gap-2 text-xs font-medium text-muted select-none">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
              className="size-4 cursor-pointer rounded border-border bg-surface-2 accent-[var(--accent)]"
            />
            {t('dashboard.showHidden')}
          </label>
        </div>
      </header>

      {isError ? (
        <EmptyState
          tone="danger"
          title={t('error.title')}
          hint={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <NodeCardSkeleton key={index} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title={t('dashboard.noMatch')}
            hint={t('dashboard.noMatchHint')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setGroup('all');
                  setShowHidden(false);
                }}
              >
                {t('dashboard.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t('dashboard.empty')} hint={t('dashboard.emptyHint')} />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((node) => (
            <NodeCard key={node.id} node={node} />
          ))}
        </div>
      )}

      {isFetching && !isPending && !isError ? (
        <p className="flex items-center justify-center gap-2 text-[11px] text-muted">
          <Spinner size={11} />
          {t('common.loading')}
        </p>
      ) : null}
    </div>
  );
}
