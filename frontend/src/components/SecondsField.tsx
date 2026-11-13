import type { CSSProperties, KeyboardEvent } from 'react';

import { sanitizeSecondsInput } from '../utils/sendCorrespondence';
import { selectAllMouseDown, selectInputText } from '../utils/selectInputText';

const secondsBareInput: CSSProperties = {
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  color: 'var(--text-main)',
  font: 'inherit',
  fontSize: 'inherit',
  minWidth: 0,
};

/**
 * Delay/Every: glass shell fills the track; column width comes from text
 * (value + `s`, or placeholder), not the UA input default.
 *
 * Shared by the send panel and send popover so both render identically.
 */
export function SecondsField({
  value,
  onChange,
  placeholder,
  title,
  col,
  disabled = false,
  onBlur,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  title: string;
  /** Write-panel grid column (`data-wtb-col`). Omit for content-sized popover use. */
  col?: string;
  disabled?: boolean;
  /** Called after sanitize with the committed value. */
  onBlur?: (sanitized: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const showUnit = value.trim() !== '';
  // Floor against placeholder and a typical filled "0" so empty tracks stay usable.
  const inputCh = Math.max(value.length, placeholder.length, 1) + 1;
  const fill = col != null;
  return (
    <div
      {...(col != null ? { 'data-wtb-col': col } : {})}
      style={{ width: fill ? '100%' : 'max-content', minWidth: 0 }}
    >
      <div
        data-seconds-field
        className="glass-input"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          width: fill ? '100%' : 'max-content',
          maxWidth: '100%',
          boxSizing: 'border-box',
          padding: '0.2rem 0.35rem',
          gap: showUnit ? '0.3rem' : undefined,
          fontSize: '0.72rem',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <input
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onMouseDown={selectAllMouseDown}
          onChange={e => { if (!disabled) onChange(e.target.value); }}
          onFocus={e => { if (!disabled) selectInputText(e.currentTarget); }}
          onBlur={() => {
            if (disabled) return;
            const next = sanitizeSecondsInput(value);
            if (next !== value) onChange(next);
            onBlur?.(next);
          }}
          onKeyDown={onKeyDown}
          inputMode="numeric"
          title={title}
          style={{
            ...secondsBareInput,
            flex: '1 1 auto',
            width: `${inputCh}ch`,
            minWidth: `${inputCh}ch`,
            textAlign: 'right',
          }}
        />
        {showUnit && (
          <span
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-dim)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              pointerEvents: 'none',
            }}
          >
            s
          </span>
        )}
      </div>
    </div>
  );
}
