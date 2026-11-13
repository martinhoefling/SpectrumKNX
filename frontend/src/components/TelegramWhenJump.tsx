import type { CSSProperties } from 'react';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';

import type { Telegram } from '../hooks/useWebSocket';
import { EventTypeLabel } from './EventTypeLabel';

/** Shared event timestamp shape used by send panel, popover, and building views. */
// eslint-disable-next-line react-refresh/only-export-components -- shared timestamp helper
export function formatTelegramWhen(timestamp: string | Date | undefined | null): string {
  if (timestamp == null || timestamp === '') return '';
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'yyyy-MM-dd HH:mm:ss');
}

/** Prefer simplified_type (READ / WRITE / RESPONSE); fall back to telegram_type. */
// eslint-disable-next-line react-refresh/only-export-components -- shared telegram helper
export function telegramEventType(telegram: Pick<Telegram, 'simplified_type' | 'telegram_type'> | null | undefined): string {
  if (!telegram) return '';
  const raw = (telegram.simplified_type ?? telegram.telegram_type ?? '').trim();
  if (raw === 'Write' || raw === 'Read' || raw === 'Response') return raw.toUpperCase();
  return raw;
}

interface Props {
  /** ISO timestamp or Date of the bus event. */
  timestamp?: string | Date | null;
  /** Optional event kind shown after the jump (READ / WRITE / RESPONSE). */
  eventType?: string | null;
  /** When the kind is a Read, color it green once a later Response has answered it. */
  readAnswered?: boolean;
  /** When set, render the jump button immediately right of the timestamp. */
  onJump?: () => void;
  /** aria-label / title for the jump button. */
  jumpLabel?: string;
  /** Reserve the usual row height with no content (empty send-panel cells). */
  empty?: boolean;
  /** Keep a jump-sized spacer when `onJump` is absent (column alignment). */
  reserveJump?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Compact event chrome: Date/Time, optional Jump immediately to its right,
 * then optional event type. Jump never sits between other content and the time.
 */
export function TelegramWhenJump({
  timestamp,
  eventType,
  readAnswered = false,
  onJump,
  jumpLabel = 'Go to telegram',
  empty = false,
  reserveJump = false,
  className,
  style,
}: Props) {
  if (empty) {
    return <span aria-hidden className={className} style={{ display: 'inline-block', height: 18, ...style }} />;
  }

  const when = formatTelegramWhen(timestamp);
  const typeLabel = (eventType ?? '').trim();
  if (!when && !typeLabel && !onJump && !reserveJump) {
    return <span aria-hidden className={className} style={{ display: 'inline-block', height: 18, ...style }} />;
  }

  const jump = onJump ? (
    <button
      type="button"
      className="quick-filter-bar-toggle"
      title={jumpLabel}
      aria-label={jumpLabel}
      onClick={onJump}
      style={{ flexShrink: 0, margin: 0 }}
    >
      <Clock size={13} />
    </button>
  ) : reserveJump ? (
    <span aria-hidden style={{ display: 'inline-block', width: 18, height: 18, flexShrink: 0 }} />
  ) : null;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        minWidth: 0,
        fontSize: '0.72rem',
        color: 'var(--text-dim)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {when ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{when}</span>
          {jump}
        </span>
      ) : (
        jump
      )}
      {typeLabel ? (
        <EventTypeLabel kind={typeLabel} answered={readAnswered} style={{ flexShrink: 0 }} />
      ) : null}
    </span>
  );
}
