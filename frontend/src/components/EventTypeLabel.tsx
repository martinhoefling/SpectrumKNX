import type { CSSProperties } from 'react';
import { Radio } from 'lucide-react';

import { BTN_DISABLED_MIX, BTN_MUTED_MIX } from '../utils/buttonStyles';
import type { GaReadPhase } from '../utils/telegramCellStyles';

/** How far a Read-button radio fades while the button is inactive. */
export type ReadIconDim = 'disabled' | 'muted';

/** Display color for an event-kind word (and its icon, when the icon is part of the label). */
// eslint-disable-next-line react-refresh/only-export-components -- shared event color helper
export function eventTypeColor(kind: string, answered = false): string {
  const u = kind.trim().toUpperCase();
  if (u === 'WRITE' || u.includes('WRITE')) return 'var(--accent-primary)';
  if (u === 'RESPONSE' || u.includes('RESPONSE')) return 'var(--success)';
  if (u === 'READ' || (u.includes('READ') && !u.includes('RESPONSE'))) {
    return answered ? 'var(--success)' : 'var(--warning-text)';
  }
  return 'var(--text-dim)';
}

/** Radio color on a Read button: blue, then orange, then green.
 * An inactive button fades that color; `muted` is the stronger fade. */
// eslint-disable-next-line react-refresh/only-export-components -- shared read-phase color helper
export function readPhaseIconColor(phase: GaReadPhase, dim?: ReadIconDim): string {
  const base = phase === 'answered'
    ? 'var(--success)'
    : phase === 'request'
      ? 'var(--warning)'
      : 'var(--accent-primary)';
  if (!dim) return base;
  const mix = dim === 'muted' ? BTN_MUTED_MIX : BTN_DISABLED_MIX;
  return `color-mix(in srgb, ${base} ${mix}%, transparent)`;
}

function isReadKind(kind: string): boolean {
  const u = kind.trim().toUpperCase();
  return u === 'READ' || (u.includes('READ') && !u.includes('RESPONSE'));
}

/**
 * Event kind (READ / WRITE / RESPONSE).
 * Display: word (and icon, if shown) in the type color.
 * Read button: pass `phase` so the word inherits the button color and only the radio changes.
 */
export function EventTypeLabel({
  kind,
  answered = false,
  showIcon = false,
  phase,
  iconDim,
  iconSize = 14,
  className,
  style,
}: {
  kind: string;
  answered?: boolean;
  showIcon?: boolean;
  phase?: GaReadPhase;
  /** Fade the radio while the Read button is inactive. `muted` fades further. */
  iconDim?: ReadIconDim;
  iconSize?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const label = kind.trim();
  if (!label) return null;
  const typeColor = eventTypeColor(label, answered);
  const buttonIcon = phase != null;
  const iconColor = buttonIcon ? readPhaseIconColor(phase, iconDim) : typeColor;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        color: buttonIcon ? undefined : typeColor,
        minWidth: 0,
        ...style,
      }}
    >
      {showIcon && isReadKind(label) ? (
        <Radio aria-hidden size={iconSize} style={{ color: iconColor, flexShrink: 0 }} />
      ) : null}
      <span>{label}</span>
    </span>
  );
}
