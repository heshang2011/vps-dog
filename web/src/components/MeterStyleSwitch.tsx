import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

/** How the CPU / memory / disk tiles draw their meter. */
export type MeterStyle = 'bar' | 'ring';

export const METER_STORAGE_KEY = 'vpsdog.meters';

/** Read the persisted preference; anything unknown falls back to bars. */
export function readMeterStyle(): MeterStyle {
  try {
    return localStorage.getItem(METER_STORAGE_KEY) === 'ring' ? 'ring' : 'bar';
  } catch {
    return 'bar';
  }
}

export function writeMeterStyle(style: MeterStyle): void {
  try {
    localStorage.setItem(METER_STORAGE_KEY, style);
  } catch {
    // Private mode / storage disabled — the preference just won't persist.
  }
}

export interface MeterStyleSwitchProps {
  value: MeterStyle;
  onChange: (next: MeterStyle) => void;
}

/** Segmented control for the dashboard's meter style (bars vs rings). */
export function MeterStyleSwitch({ value, onChange }: MeterStyleSwitchProps): ReactNode {
  const { t } = useI18n();
  const options = [
    { value: 'bar' as const, label: t('dashboard.meterBar') },
    { value: 'ring' as const, label: t('dashboard.meterRing') },
  ];
  return (
    <div
      role="group"
      aria-label={t('dashboard.meterStyle')}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ${
              active ? 'bg-success/14 text-success' : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
