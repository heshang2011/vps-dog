import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input, Textarea } from '../../components/Input';
import { ErrorBanner, PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { useToast } from '../../components/Toast';
import { adminApi, errorMessage, qk } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import type { Settings, ThemeSetting } from '../../lib/types';
import { useAdminAuth } from './AdminLayout';

interface SettingsForm {
  site_name: string;
  site_description: string;
  report_interval: string;
  offline_after: string;
  retention_days: string;
  ping_retention_days: string;
  theme: ThemeSetting;
  custom_head: string;
}

function toForm(settings: Settings): SettingsForm {
  return {
    site_name: settings.site_name,
    site_description: settings.site_description,
    report_interval: String(settings.report_interval),
    offline_after: String(settings.offline_after),
    retention_days: String(settings.retention_days),
    ping_retention_days: String(settings.ping_retention_days),
    theme: settings.theme,
    custom_head: settings.custom_head,
  };
}

/** `/admin/settings` — site identity, cadence and retention. */
export default function AdminSettings(): ReactNode {
  const { t } = useI18n();
  const { canEdit } = useAdminAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<SettingsForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: qk.adminSettings,
    queryFn: ({ signal }) => adminApi.getSettings(signal),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (settingsQuery.data !== undefined) setForm(toForm(settingsQuery.data));
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: SettingsForm) =>
      adminApi.updateSettings({
        site_name: input.site_name.trim().length > 0 ? input.site_name.trim() : 'VPS-DOG',
        site_description: input.site_description,
        report_interval: Number.parseInt(input.report_interval, 10) || 30,
        offline_after: Number.parseInt(input.offline_after, 10) || 90,
        retention_days: Number.parseInt(input.retention_days, 10) || 30,
        ping_retention_days: Number.parseInt(input.ping_retention_days, 10) || 7,
        theme: input.theme,
        custom_head: input.custom_head,
      }),
    onSuccess: () => {
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: qk.adminSettings });
      void queryClient.invalidateQueries({ queryKey: qk.status });
      void queryClient.invalidateQueries({ queryKey: qk.nodes });
      toast.success(t('admin.settings.saved'));
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form === null) return;
    saveMutation.mutate(form);
  };

  const themeOptions = [
    { value: 'auto', label: t('theme.auto') },
    { value: 'light', label: t('theme.light') },
    { value: 'dark', label: t('theme.dark') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.settings.title')} subtitle={t('admin.settings.subtitle')} />

      {settingsQuery.isError ? (
        <ErrorBanner
          message={errorMessage(settingsQuery.error)}
          onRetry={() => void settingsQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      {settingsQuery.isPending || form === null ? (
        <div className="card flex flex-col gap-4 p-5">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-9 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-sm font-semibold text-text">{t('admin.settings.siteName')}</h2>
            <Input
              label={t('admin.settings.siteName')}
              value={form.site_name}
              onChange={(event) => setForm({ ...form, site_name: event.target.value })}
              required
            />
            <Input
              label={t('admin.settings.siteDescription')}
              value={form.site_description}
              onChange={(event) => setForm({ ...form, site_description: event.target.value })}
            />
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-sm font-semibold text-text">{t('admin.settings.reportInterval')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('admin.settings.reportInterval')}
                type="number"
                min={10}
                max={3600}
                value={form.report_interval}
                onChange={(event) => setForm({ ...form, report_interval: event.target.value })}
              />
              <Input
                label={t('admin.settings.offlineAfter')}
                type="number"
                min={10}
                value={form.offline_after}
                onChange={(event) => setForm({ ...form, offline_after: event.target.value })}
              />
              <Input
                label={t('admin.settings.retentionDays')}
                type="number"
                min={1}
                value={form.retention_days}
                onChange={(event) => setForm({ ...form, retention_days: event.target.value })}
              />
              <Input
                label={t('admin.settings.pingRetentionDays')}
                type="number"
                min={1}
                value={form.ping_retention_days}
                onChange={(event) => setForm({ ...form, ping_retention_days: event.target.value })}
              />
            </div>
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-sm font-semibold text-text">{t('admin.settings.theme')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label={t('admin.settings.theme')}
                value={form.theme}
                onChange={(event) => setForm({ ...form, theme: event.target.value as ThemeSetting })}
                options={themeOptions}
              />
            </div>
            <Textarea
              label={t('admin.settings.customHead')}
              hint={t('admin.settings.customHeadHint')}
              value={form.custom_head}
              onChange={(event) => setForm({ ...form, custom_head: event.target.value })}
              rows={5}
              spellCheck={false}
            />
          </section>

          {formError !== null ? (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button type="submit" variant="primary" loading={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
            ) : (
              <Badge tone="muted">{t('admin.readOnly')}</Badge>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                if (settingsQuery.data !== undefined) {
                  setForm(toForm(settingsQuery.data));
                  setFormError(null);
                }
              }}
              disabled={saveMutation.isPending}
            >
              {t('common.reset')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
