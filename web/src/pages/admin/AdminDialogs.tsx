import { useState, type ReactNode } from 'react';
import { Button, IconButton } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { copyText } from '../../lib/clipboard';
import { useI18n } from '../../lib/i18n';
import { buildInstallCommand } from '../../lib/install';

export interface TokenDialogProps {
  open: boolean;
  /** Node the token belongs to; `null` while closed. */
  nodeName: string | null;
  token: string | null;
  /** Prefills `-r` in the install command; omitted when the node has no region. */
  region?: string | null;
  onClose: () => void;
}

const COPY_ICON = (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
    <rect x="5.5" y="5.5" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  </svg>
);

/**
 * Shows a freshly minted agent token exactly once — together with a
 * ready-to-paste command that installs the agent and wires the token up, which
 * is what the operator actually needs after registering a node.
 */
export function TokenDialog({
  open,
  nodeName,
  token,
  region = null,
  onClose,
}: TokenDialogProps): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState<'token' | 'command' | null>(null);

  const command =
    token === null || nodeName === null
      ? ''
      : buildInstallCommand({
          origin: window.location.origin,
          token,
          nodeName,
          region,
        });

  const copy = async (what: 'token' | 'command', value: string) => {
    if (value.length === 0) return;
    const ok = await copyText(value);
    if (!ok) {
      toast.error(t('common.copyFailed'));
      return;
    }
    setCopied(what);
    toast.success(t('toast.copied'));
    window.setTimeout(() => setCopied((current) => (current === what ? null : current)), 2_000);
  };

  return (
    <Modal
      open={open}
      title={t('admin.nodes.tokenFor', { name: nodeName ?? '' })}
      description={t('admin.nodes.tokenOnce')}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void copy('command', command)}
            icon={COPY_ICON}
          >
            {copied === 'command' ? t('common.copied') : t('admin.nodes.copyCommand')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
              {t('admin.nodes.tokenHint')}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={COPY_ICON}
              onClick={() => void copy('token', token ?? '')}
            >
              {copied === 'token' ? t('common.copied') : t('common.copy')}
            </Button>
          </div>
          <code className="block max-h-28 overflow-auto rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs break-all text-text select-all">
            {token ?? '–'}
          </code>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
            {t('admin.nodes.installTitle')}
          </span>
          <pre className="max-h-44 overflow-auto rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-text select-all">
            {command}
          </pre>
        </section>

        <p className="text-[11px] leading-relaxed text-muted">{t('admin.nodes.installHint')}</p>
      </div>
    </Modal>
  );
}

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
}

export interface ConfirmDialogProps {
  state: ConfirmState | null;
  cancelLabel: string;
  loading: boolean;
  onCancel: () => void;
}

export function ConfirmDialog({ state, cancelLabel, loading, onCancel }: ConfirmDialogProps): ReactNode {
  return (
    <Modal
      open={state !== null}
      title={state?.title ?? ''}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={state?.danger === true ? 'danger' : 'primary'}
            onClick={() => state?.onConfirm()}
            loading={loading}
          >
            {state?.confirmLabel ?? ''}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{state?.message ?? ''}</p>
    </Modal>
  );
}

export interface RowActionsProps {
  children: ReactNode;
}

export function RowActions({ children }: RowActionsProps): ReactNode {
  return <div className="flex items-center justify-end gap-1">{children}</div>;
}

export { IconButton };
