/** Shared button styles for the bus-write controls, kept out of component
 * files so React Fast Refresh only sees component exports. */

export function boolBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 600,
    background: 'var(--bg-tag)', color: 'var(--text-main)',
    border: '1px solid var(--border-color)', borderRadius: '6px',
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
