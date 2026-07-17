import { Send } from 'lucide-react';

import { coerceValue } from '../utils/knxSend';
import { boolBtn, primaryBtn } from '../utils/buttonStyles';

interface Props {
  /** DPT main number of the target GA, when known. DPT 1 renders On/Off buttons. */
  dptMain?: number | null;
  value: string;
  onValueChange: (value: string) => void;
  /** Fires with the payload to write: `true`/`false` for DPT 1, the coerced free value otherwise. */
  onWrite: (payload: boolean | number | string) => void;
  /** Disables all controls (busy, invalid address, active scheduled job). */
  disabled?: boolean;
}

/**
 * DPT-aware write controls, shared by every place that writes to the bus
 * (send bar, Last Seen Values) so the same GA renders identically everywhere
 * (#213): On/Off buttons for DPT 1, a free-value field plus Write button
 * otherwise. Enter in the value field writes.
 */
export function WriteControls({ dptMain, value, onValueChange, onWrite, disabled = false }: Props) {
  if (dptMain === 1) {
    return (
      <div style={{ display: 'flex', gap: '0.3rem' }}>
        <button disabled={disabled} onClick={() => onWrite(true)} style={boolBtn(disabled)} title="Write ON (1) to the bus">
          <Send size={13} /> On
        </button>
        <button disabled={disabled} onClick={() => onWrite(false)} style={boolBtn(disabled)} title="Write OFF (0) to the bus">
          <Send size={13} /> Off
        </button>
      </div>
    );
  }

  const writeDisabled = disabled || value.trim() === '';
  return (
    <>
      <input
        className="glass-input"
        placeholder="Value (e.g. 50, 21.5, on)"
        value={value}
        onChange={e => onValueChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !writeDisabled) onWrite(coerceValue(value)); }}
        style={{ width: 170 }}
      />
      <button onClick={() => onWrite(coerceValue(value))} disabled={writeDisabled} style={primaryBtn(writeDisabled)}>
        <Send size={14} /> Write
      </button>
    </>
  );
}
