import { useState, type ReactNode } from 'react';
import { Button, IconButton } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { copyText } from '../../lib/clipboard';
import { useI18n } from '../../lib/i18n';

export interface TokenDialogProps {
  open: boolean;
  /** Node the token belongs to; `null` while closed. */
  nodeName: string | null;
  token: string | null;
  onClose: () => void;
}

/** Shows a freshly minted agent token exactly once, with a copy button. */
export function TokenDialog({ open, nodeName, token, onClose }: TokenDialogProps): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (token === null) return;
    const ok = await copyText(token);
    if (ok) {
      setCopied(true);
      toast.success(t('toast.copied'));
      window.setTimeout(() => setCopied(false), 2_000);
    } else {
      toast.error(t('common.copyFailed'));
    }
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
            onClick={() => void onCopy()}
            icon={
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <rect x="5.5" y="5.5" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            }
          >
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <code className="block max-h-40 overflow-auto rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs break-all text-text select-all">
          {token ?? '–'}
        </code>
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
