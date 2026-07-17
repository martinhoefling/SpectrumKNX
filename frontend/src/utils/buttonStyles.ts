/** Shared button styles for the bus-write controls, kept out of component
 * files so React Fast Refresh only sees component exports. */

/** DPT-1 On/Off send buttons. Styled as accent action buttons (like Write)
 * rather than passive toggles, so it is obvious they trigger a bus write (#218). */
export function boolBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '0.3rem',
    padding: '0.35rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
    background: 'var(--accent-primary)', color: 'white',
    border: 'none', borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}

export function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '0.35rem',
    padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 600,
    background: 'var(--accent-primary)', color: 'white',
    border: 'none', borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}

export function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '0.35rem',
    padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 600,
    background: 'transparent', color: 'var(--accent-primary)',
    border: '1px solid var(--accent-primary)', borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}
