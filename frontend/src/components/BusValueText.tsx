import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { formatBusValueForDpt, type BusValueView } from '../utils/dptValues';
import { isTextDptMain, parseDptMain } from '../utils/knxSend';
import { TT } from '../utils/telegramCellStyles';

interface Props {
  value: BusValueView;
  /** Effective DPT for discrete decoding (row/project/KO). */
  dpt?: string | null;
  /** Style while showing the decoded value (default). */
  style?: CSSProperties;
  /** Style while showing raw_hex (e.g. TelegramTable raw-badge copy). */
  rawStyle?: CSSProperties;
  className?: string;
  /** Extra class while showing raw_hex (e.g. raw-badge). */
  rawClassName?: string;
  /** Wrap the value text (default: strong). */
  as?: 'strong' | 'span';
  /** Start in raw_hex mode when hex is available (TelegramTable DATA under VALUE). */
  defaultShowHex?: boolean;
  /**
   * When false, the toggle stays mouse-only (no Tab / focus ring). Use in the
   * telegram-table scroll body where field focus is not allowed.
   */
  allowFocus?: boolean;
}

/**
 * Decoded bus value (lowercase discrete words when DPT known). Click toggles
 * to raw_hex when available, then back. Both states are stacked in one box so
 * surrounding layout does not shift. Defaults match TelegramTable VALUE
 * (`.tt-value` / `.tt-value-unit` / `.raw-badge`).
 */
export function BusValueText({
  value, dpt, style, rawStyle, className, rawClassName, as = 'strong',
  defaultShowHex = false,
  allowFocus = true,
}: Props) {
  const [showHex, setShowHex] = useState(defaultShowHex);
  const hex = (value.raw_hex ?? '').trim();
  const canToggle = hex !== '';
  const showingHex = showHex && canToggle;
  const decoded = formatBusValueForDpt(value, dpt);
  const textDpt = isTextDptMain(dpt ? parseDptMain(dpt) : null);
  const textStyle: CSSProperties | undefined = textDpt
    ? { fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre', ...style }
    : style;

  const Tag = as;
  const decodedClass = className ?? TT.value;
  const hexClass = rawClassName ?? TT.rawBadge;
  const decodedLabel = `${decoded.text}${decoded.unit ? ` ${decoded.unit}` : ''}`;
  const decodedBody: ReactNode = (
    <>
      {decoded.text}
      {decoded.unit ? <span className={TT.valueUnit}>{` ${decoded.unit}`}</span> : null}
    </>
  );

  if (!canToggle) {
    return (
      <Tag className={decodedClass} style={textStyle}>
        {decodedBody}
      </Tag>
    );
  }

  return (
    <Tag
      className={TT.valueToggle}
      role="button"
      tabIndex={allowFocus ? 0 : -1}
      title={showingHex ? 'Show decoded value' : 'Show raw hex'}
      aria-label={showingHex ? hex : decodedLabel}
      onMouseDown={(e: MouseEvent) => {
        if (!allowFocus) e.preventDefault();
      }}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        setShowHex(v => !v);
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (!allowFocus) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          setShowHex(v => !v);
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      <span
        className={decodedClass}
        style={{ visibility: showingHex ? 'hidden' : 'visible', ...textStyle }}
        aria-hidden={showingHex}
      >
        {decodedBody}
      </span>
      <span
        className={hexClass}
        style={{ visibility: showingHex ? 'visible' : 'hidden', ...rawStyle }}
        aria-hidden={!showingHex}
      >
        {hex}
      </span>
    </Tag>
  );
}
