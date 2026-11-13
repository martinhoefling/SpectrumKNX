import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EventTypeLabel } from './EventTypeLabel';
import { BTN_DISABLED_MIX, BTN_MUTED_MIX } from '../utils/buttonStyles';
import { GaReadPhaseProvider, useGaReadPhase } from './GaReadPhase';

function PhaseProbe({ address }: { address: string }) {
  const phase = useGaReadPhase(address);
  return <span>{phase}</span>;
}

describe('EventTypeLabel', () => {
  it('colors the word and shows no icon in a display', () => {
    const { rerender } = render(<EventTypeLabel kind="READ" />);
    const word = screen.getByText('READ');
    expect(word.parentElement).toHaveStyle({ color: 'var(--warning-text)' });
    expect(word.parentElement?.querySelector('.lucide-radio')).toBeNull();

    rerender(<EventTypeLabel kind="READ" answered />);
    expect(screen.getByText('READ').parentElement).toHaveStyle({ color: 'var(--success)' });

    rerender(<EventTypeLabel kind="WRITE" />);
    expect(screen.getByText('WRITE').parentElement).toHaveStyle({ color: 'var(--accent-primary)' });

    rerender(<EventTypeLabel kind="RESPONSE" />);
    expect(screen.getByText('RESPONSE').parentElement).toHaveStyle({ color: 'var(--success)' });
  });

  it('keeps Read-button text uncolored and paints only the radio from the GA phase', () => {
    const rows = [
      {
        timestamp: '2026-01-01T10:00:00Z',
        target_address: '1/2/3',
        simplified_type: 'Read',
      },
      {
        timestamp: '2026-01-01T10:00:01Z',
        target_address: '4/5/6',
        simplified_type: 'Response',
      },
    ];
    render(
      <GaReadPhaseProvider rows={rows}>
        <EventTypeLabel kind="Read" showIcon phase="none" />
        <EventTypeLabel kind="Read" showIcon phase="request" />
        <EventTypeLabel kind="Read" showIcon phase="answered" />
      </GaReadPhaseProvider>,
    );
    const buttons = screen.getAllByText('Read');
    const colors = buttons.map(el => el.parentElement?.querySelector('svg')?.getAttribute('style') ?? '');
    expect(colors[0]).toMatch(/--accent-primary/);
    expect(colors[1]).toMatch(/--warning\)/);
    expect(colors[2]).toMatch(/--success/);
    for (const el of buttons) {
      expect(el.parentElement).not.toHaveStyle({ color: 'var(--warning-text)' });
      expect(el.parentElement).not.toHaveStyle({ color: 'var(--success)' });
    }
  });

  it('fades the Read-button radio while the button is inactive, and further when muted', () => {
    const { rerender } = render(<EventTypeLabel kind="Read" showIcon phase="request" iconDim="disabled" />);
    const icon = () => screen.getByText('Read').parentElement?.querySelector('svg');
    expect(icon()?.getAttribute('style') ?? '').toContain(`${BTN_DISABLED_MIX}%`);
    expect(icon()?.getAttribute('style') ?? '').toMatch(/--warning/);

    rerender(<EventTypeLabel kind="Read" showIcon phase="answered" iconDim="muted" />);
    expect(icon()?.getAttribute('style') ?? '').toContain(`${BTN_MUTED_MIX}%`);
    expect(icon()?.getAttribute('style') ?? '').toMatch(/--success/);
    expect(icon()?.getAttribute('style') ?? '').not.toContain(`${BTN_DISABLED_MIX}%`);
  });

  it('reopens an answered GA when a later Read arrives in a nested provider', () => {
    render(
      <GaReadPhaseProvider rows={[{
        timestamp: '2026-01-01T10:00:01Z',
        target_address: '1/2/3',
        simplified_type: 'Response',
      }]}
      >
        <GaReadPhaseProvider rows={[{
          timestamp: '2026-01-01T10:00:05Z',
          target_address: '1/2/3',
          simplified_type: 'Read',
        }]}
        >
          <PhaseProbe address="1/2/3" />
        </GaReadPhaseProvider>
      </GaReadPhaseProvider>,
    );
    expect(screen.getByText('request')).toBeInTheDocument();
  });
});
