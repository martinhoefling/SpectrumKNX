import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TelegramWhenJump, formatTelegramWhen, telegramEventType } from './TelegramWhenJump';

describe('formatTelegramWhen', () => {
  it('formats ISO timestamps as yyyy-MM-dd HH:mm:ss', () => {
    expect(formatTelegramWhen('2026-01-01T10:05:00.000000+00:00')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('returns empty for missing values', () => {
    expect(formatTelegramWhen(null)).toBe('');
    expect(formatTelegramWhen(undefined)).toBe('');
    expect(formatTelegramWhen('')).toBe('');
  });
});

describe('telegramEventType', () => {
  it('prefers simplified_type', () => {
    expect(telegramEventType({ simplified_type: 'Write', telegram_type: 'GroupValueWrite' })).toBe('Write');
  });

  it('falls back to telegram_type', () => {
    expect(telegramEventType({ simplified_type: null, telegram_type: 'GroupValueRead' })).toBe('GroupValueRead');
  });
});

describe('TelegramWhenJump', () => {
  it('renders when, then jump, then event type', () => {
    const onJump = vi.fn();
    render(
      <TelegramWhenJump
        timestamp="2026-01-01T10:05:00.000Z"
        eventType="Write"
        onJump={onJump}
      />,
    );
    const when = screen.getByText(/2026-01-01/);
    const jump = screen.getByRole('button', { name: 'Go to telegram' });
    const type = screen.getByText('Write');
    expect(when.compareDocumentPosition(jump) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(jump.compareDocumentPosition(type) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(jump);
    expect(onJump).toHaveBeenCalledOnce();
  });

  it('omits the jump button when onJump is missing', () => {
    render(<TelegramWhenJump timestamp="2026-01-01T10:05:00.000Z" eventType="Read" />);
    expect(screen.queryByRole('button', { name: 'Go to telegram' })).not.toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('omits event type when not provided', () => {
    render(<TelegramWhenJump timestamp="2026-01-01T10:05:00.000Z" onJump={() => {}} />);
    expect(screen.getByRole('button', { name: 'Go to telegram' })).toBeInTheDocument();
    expect(screen.queryByText('Write')).not.toBeInTheDocument();
  });
});
