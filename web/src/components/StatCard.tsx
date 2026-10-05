import type { ReactNode } from 'react';

export interface StatCardProps {
  label: string;
  /** Pre-formatted value; the card never formats numbers itself. */
  value: string;
  unit?: string;
  hint?: string;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warn' | 'danger' | 'accent';
  className?: string;
}

const TONE_TEXT: Record<'default' | 'success' | 'warn' | 'danger' | 'accent', string> = {
  default: 'text-text',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
  accent: 'text-accent',
};

/** Compact KPI tile: label, big tabular number, optional unit and hint. */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'default',
  className = '',
}: StatCardProps): ReactNode {
  return (
    <div
      className={`card flex flex-col gap-2 p-4 transition-colors duration-150 hover:border-muted/35 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {icon !== undefined ? <span className="text-muted">{icon}</span> : null}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`num text-2xl leading-none font-semibold ${TONE_TEXT[tone]}`}>
          {value}
        </span>
        {unit !== undefined ? <span className="text-xs font-medium text-muted">{unit}</span> : null}
      </div>
      {hint !== undefined ? (
        <span className="truncate text-xs text-muted/85" title={hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
