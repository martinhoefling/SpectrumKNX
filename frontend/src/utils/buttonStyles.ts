import type React from 'react';

/** Shared button styles for the bus-write controls, kept out of component
 * files so React Fast Refresh only sees component exports. */

/** Disabled send buttons stay readable. Irrelevant ones (not the live job) fade further. */
export const BTN_DISABLED_MIX = 45;
export const BTN_MUTED_MIX = 18;

function accentFill(disabled: boolean, muted: boolean): string {
  if (!disabled && !muted) return 'var(--accent-primary)';
  const mix = muted ? BTN_MUTED_MIX : BTN_DISABLED_MIX;
  return `color-mix(in srgb, var(--accent-primary) ${mix}%, transparent)`;
}

/** Filled accent buttons dim the label with the fill, so a paler wash is not still bright white. */
function accentLabel(muted: boolean): string {
  return muted ? `color-mix(in srgb, white ${BTN_DISABLED_MIX}%, transparent)` : 'white';
}

/** DPT-1 On/Off send buttons. Styled as accent action buttons (like Write)
 * rather than passive toggles, so it is obvious they trigger a bus write (#218).
 * `muted` is the stronger fade for a button that is not the live job's action. */
export function boolBtn(disabled: boolean, muted = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '0.3rem',
    padding: '0.35rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
    background: accentFill(disabled, muted),
    color: accentLabel(muted),
    border: 'none', borderRadius: '6px',
    whiteSpace: 'nowrap',
    cursor: disabled ? 'default' : 'pointer',
  };
}

export function primaryBtn(disabled: boolean, muted = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '0.35rem',
    padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 600,
    background: accentFill(disabled, muted),
    color: accentLabel(muted),
    border: 'none', borderRadius: '6px',
    whiteSpace: 'nowrap',
    cursor: disabled ? 'default' : 'pointer',
  };
}

export function secondaryBtn(disabled: boolean, muted = false): React.CSSProperties {
  const tone = accentFill(disabled, muted);
  return {
    display: 'flex', alignItems: 'center', gap: '0.35rem',
    padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 600,
    background: 'transparent',
    color: disabled || muted ? tone : 'var(--accent-primary)',
    border: disabled || muted
      ? `1px solid ${tone}`
      : '1px solid var(--accent-primary)',
    borderRadius: '6px',
    whiteSpace: 'nowrap',
    cursor: disabled ? 'default' : 'pointer',
  };
}

/** Small inline per-row action icon (filter/last-seen/visualize/write), as used
 * on GA/device rows throughout the app (#214, #306, #341). */
export const rowIconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
  display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle',
};
