import { AlertTriangle } from 'lucide-react';

/**
 * Companion-mode warning (#462): Home Assistant's telegram database still
 * holds local-time timestamps, which this app reads as UTC. Only Home
 * Assistant can convert it, so the banner is not dismissible — it goes away
 * when the backend reports the database converted.
 */
export function LegacyTimestampBanner() {
  return (
    <div
      role="alert"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '0.6rem', flexShrink: 0,
        padding: '0.6rem 1.25rem', fontSize: '0.8rem', lineHeight: 1.5,
        color: 'var(--text-main)', background: 'rgba(245, 158, 11, 0.12)',
        borderBottom: '1px solid var(--warning)',
      }}
    >
      <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '0.1rem' }} />
      <span>
        <strong>Telegram times may be wrong.</strong>{' '}
        Home Assistant&apos;s KNX database still stores timestamps in local time. Until Home Assistant
        converts it, history is shifted by your UTC offset and the live view can repeat or miss
        telegrams. Update Home Assistant to a release whose KNX integration converts the database —
        this notice then disappears by itself.
      </span>
    </div>
  );
}
