import { Link, NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeMode } from '../lib/theme';
import { useStatusLive } from '../lib/useLive';
import { StatusDot } from './Badge';

function LogoMark(): ReactNode {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none">
        {/* a dog-eared server: the project's mark */}
        <path
          d="M5 8.2 8.4 4h7.2L19 8.2V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8.2Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M5 12h14M9.5 15.6h.01M14.5 15.6h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const THEME_ICON: Record<ThemeMode, ReactNode> = {
  auto: (
    <>
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M15.4 4.6l-1.3 1.3M5.9 14.1l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  light: (
    <>
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M15.4 4.6l-1.3 1.3M5.9 14.1l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  dark: (
    <path
      d="M16 11.6A6.4 6.4 0 0 1 8.4 4a6.8 6.8 0 1 0 7.6 7.6Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
};

function ThemeToggle(): ReactNode {
  const { mode, cycle } = useTheme();
  const { t } = useI18n();
  const modeLabel = t(mode === 'auto' ? 'theme.auto' : mode === 'light' ? 'theme.light' : 'theme.dark');
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${t('nav.toggleTheme')} — ${modeLabel}`}
      title={`${t('nav.theme')}: ${modeLabel}`}
      className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 text-muted transition-colors duration-150 hover:border-muted/40 hover:text-text"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
        {THEME_ICON[mode]}
      </svg>
      <span className="hidden text-xs font-medium sm:inline">{modeLabel}</span>
    </button>
  );
}

function LangToggle(): ReactNode {
  const { lang, toggleLang, t } = useI18n();
  const next = lang === 'zh-CN' ? 'English' : '简体中文';
  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label={`${t('nav.switchLanguage')} — ${next}`}
      title={t('nav.language')}
      className="inline-flex h-8.5 min-w-8.5 items-center justify-center rounded-xl border border-border bg-surface px-2.5 text-xs font-semibold text-muted transition-colors duration-150 hover:border-muted/40 hover:text-text"
    >
      {lang === 'zh-CN' ? '中' : 'EN'}
    </button>
  );
}

function StatusPill(): ReactNode {
  const { t } = useI18n();
  const { data } = useStatusLive();

  if (data === undefined) {
    return (
      <span className="hidden h-8.5 items-center gap-2 rounded-xl border border-border bg-surface px-3 md:inline-flex">
        <span className="skeleton h-3 w-20" />
      </span>
    );
  }

  const healthy = data.total > 0 && data.offline === 0;
  const empty = data.total === 0;
  const label = empty
    ? t('status.noNodes')
    : healthy
      ? t('status.allSystems')
      : t('status.degraded');

  return (
    <span
      className={`hidden h-8.5 items-center gap-2 rounded-xl border px-3 text-xs font-medium md:inline-flex ${
        empty
          ? 'border-border bg-surface text-muted'
          : healthy
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-warn/30 bg-warn/10 text-warn'
      }`}
      title={label}
    >
      <StatusDot online={!empty && healthy} label={label} size="sm" />
      <span className="num">
        {data.online}/{data.total}
      </span>
      <span className="hidden lg:inline">{label}</span>
    </span>
  );
}

/** Public shell: sticky header + centred content column + footer. */
export function Layout(): ReactNode {
  const { t } = useI18n();
  const { data: status } = useStatusLive();

  const siteName = status?.site_name !== undefined && status.site_name.length > 0 ? status.site_name : t('app.name');
  const siteDescription = status?.site_description ?? '';

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2.5 rounded-lg transition-opacity duration-150 hover:opacity-85"
          >
            <LogoMark />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold tracking-tight text-text">
                {siteName}
              </span>
              {siteDescription.length > 0 ? (
                <span className="hidden truncate text-[11px] text-muted sm:block">
                  {siteDescription}
                </span>
              ) : null}
            </span>
          </Link>

          <nav className="flex shrink-0 items-center gap-2" aria-label={t('nav.menu')}>
            <StatusPill />
            <ThemeToggle />
            <LangToggle />
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `inline-flex h-8.5 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors duration-150 ${
                  isActive
                    ? 'border-accent/40 bg-accent/12 text-accent'
                    : 'border-border bg-surface text-muted hover:border-muted/40 hover:text-text'
                }`
              }
            >
              <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
                <path
                  d="M10 2.6 16 5v4.4c0 3.5-2.4 6.6-6 8-3.6-1.4-6-4.5-6-8V5l6-2.4Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M7.6 9.9 9.4 11.7l3.2-3.2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="hidden sm:inline">{t('nav.admin')}</span>
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-1.5 px-4 py-5 text-[11px] text-muted sm:flex-row sm:px-6">
          <p className="flex items-center gap-1.5">
            <span className="font-medium text-text/80">{siteName}</span>
            <span aria-hidden="true">·</span>
            <span>{t('app.tagline')}</span>
          </p>
          <p className="num">{t('dashboard.autoRefresh', { seconds: 10 })}</p>
        </div>
      </footer>
    </div>
  );
}
