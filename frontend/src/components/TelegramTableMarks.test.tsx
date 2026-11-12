import { render, fireEvent, screen } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import { anchorKey } from '../utils/anchorKey';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { installVirtualLayout } from '../test/virtualLayout';

// jsdom has no layout: give the virtualizer a viewport so it renders rows.
beforeAll(installVirtualLayout);

const visibleColumns = {
  time: true, delta: true, source: true, sourceName: true,
  target: true, targetName: true, type: true, dpt: true, data: true, value: true,
};

const sortConfig: SortConfig = [{ key: 'timestamp', direction: 'desc' }];

// Five rows so range + additive semantics are unambiguous. Desc timestamp → the
// DOM row order matches this array order (newest first).
const TELEGRAMS: Telegram[] = [
  makeTelegram({ timestamp: '2024-01-01T10:00:05.000Z', target_address: '1/2/5', raw_hex: '0x05' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:04.000Z', target_address: '1/2/4', raw_hex: '0x04' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/2/3', raw_hex: '0x03' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '1/2/2', raw_hex: '0x02' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '1/2/1', raw_hex: '0x01' }),
];

const renderTable = (props: Partial<React.ComponentProps<typeof TelegramTable>> = {}) =>
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      {...props}
    />,
  );

const rows = (container: HTMLElement) => Array.from(container.querySelectorAll('.log-row')) as HTMLElement[];
const marked = (container: HTMLElement) => rows(container).map(r => r.classList.contains('marked'));
const latestIdx = (container: HTMLElement) => rows(container).findIndex(r => r.classList.contains('latest'));

test('plain click marks only the clicked row and makes it the latest; a second click replaces', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[0]);
  expect(marked(container)).toEqual([true, false, false, false, false]);
  expect(latestIdx(container)).toBe(0);

  fireEvent.click(rows(container)[2]);
  expect(marked(container)).toEqual([false, false, true, false, false]);
  expect(latestIdx(container)).toBe(2);
});

test('Ctrl/Cmd+click adds without clearing, and toggles a marked row off', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[3], { ctrlKey: true });
  expect(marked(container)).toEqual([true, false, false, true, false]);
  expect(latestIdx(container)).toBe(3);

  // Cmd (metaKey) toggles the same row off; the other mark stays.
  fireEvent.click(rows(container)[3], { metaKey: true });
  expect(marked(container)).toEqual([true, false, false, false, false]);
});

test('Shift+click marks the range from the last click to here, in visible order', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[1]);
  fireEvent.click(rows(container)[4], { shiftKey: true });
  expect(marked(container)).toEqual([false, true, true, true, true]);
  expect(latestIdx(container)).toBe(4);
});

test('Shift+click with no prior click marks only that row', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[2], { shiftKey: true });
  expect(marked(container)).toEqual([false, false, true, false, false]);
});

test('Ctrl/Cmd+Shift+click adds the range to existing marks', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[4]);                       // mark {4}, last = 4
  fireEvent.click(rows(container)[0], { ctrlKey: true });    // add {0}, last = 0
  fireEvent.click(rows(container)[1], { ctrlKey: true, shiftKey: true }); // + range 0..1
  expect(marked(container)).toEqual([true, true, false, false, true]);
});

test('clear-marks pill appears only when marked and removes every mark', () => {
  const { container } = renderTable();
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();

  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  expect(marked(container).filter(Boolean)).toHaveLength(2);

  fireEvent.click(screen.getByTitle('Clear all marks'));
  expect(marked(container).filter(Boolean)).toHaveLength(0);
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
});

test('clicking a row still pauses live-following (#266) while marking it', () => {
  const onListFollowChange = vi.fn();
  const { container } = renderTable({ listFollow: true, onListFollowChange });
  fireEvent.click(rows(container)[0]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);
  expect(marked(container)[0]).toBe(true);
});

test('prev/next-mark arrows appear with the marks and stop live-following (#442)', () => {
  const onListFollowChange = vi.fn();
  const { container } = renderTable({ listFollow: true, onListFollowChange });
  expect(screen.queryByTitle('Jump to next mark')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Jump to previous mark')).not.toBeInTheDocument();

  fireEvent.click(rows(container)[1]);
  fireEvent.click(rows(container)[3], { ctrlKey: true });
  onListFollowChange.mockClear();

  fireEvent.click(screen.getByTitle('Jump to next mark'));
  expect(onListFollowChange).toHaveBeenLastCalledWith(false);
  onListFollowChange.mockClear();
  fireEvent.click(screen.getByTitle('Jump to previous mark'));
  expect(onListFollowChange).toHaveBeenLastCalledWith(false);

  // Jumping never changes what is marked.
  expect(marked(container)).toEqual([false, true, false, true, false]);
});

test('the selected row becomes the scroll anchor while it is on screen (#435)', () => {
  const onListAnchorKeyChange = vi.fn();
  // Not following the live edge, as after scrolling into the list.
  const { container } = renderTable({ listFollow: false, onListFollowChange: vi.fn(), onListAnchorKeyChange });

  fireEvent.click(rows(container)[2]);
  expect(onListAnchorKeyChange).toHaveBeenLastCalledWith(rows(container)[2].getAttribute('data-akey'));

  // Unmarking it hands the anchor back to the top-most visible row.
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  expect(onListAnchorKeyChange).toHaveBeenLastCalledWith(rows(container)[0].getAttribute('data-akey'));
});

test('clicking a row at the live edge anchors that row, not the top one (#435)', () => {
  const onListAnchorKeyChange = vi.fn();
  const onListFollowChange = vi.fn();
  const { container } = renderTable({ listFollow: true, onListFollowChange, onListAnchorKeyChange });

  fireEvent.click(rows(container)[3]);
  expect(onListFollowChange).toHaveBeenLastCalledWith(false);
  expect(onListAnchorKeyChange).toHaveBeenLastCalledWith(rows(container)[3].getAttribute('data-akey'));
});

test('a goto request marks the telegram when it is in the list and stops live-following', () => {
  const onListFollowChange = vi.fn();
  const onMarkedKeysChange = vi.fn();
  const onLastMarkedKeyChange = vi.fn();
  renderTable({
    listFollow: true,
    onListFollowChange,
    onMarkedKeysChange,
    onLastMarkedKeyChange,
    gotoRequest: { id: 1, telegram: TELEGRAMS[2] },
  });

  const key = anchorKey(TELEGRAMS[2]);
  expect(onMarkedKeysChange).toHaveBeenCalledWith([key]);
  expect(onLastMarkedKeyChange).toHaveBeenCalledWith(key);
  // gotoIndex pauses follow; that is the same path that centers the row.
  expect(onListFollowChange).toHaveBeenCalledWith(false);
});

test('a goto request does not mark a telegram the current list has filtered out', () => {
  const onMarkedKeysChange = vi.fn();
  const onLastMarkedKeyChange = vi.fn();
  const onListFollowChange = vi.fn();
  const hidden = makeTelegram({
    timestamp: '2024-01-01T10:00:03.500Z',
    target_address: '9/9/9',
    raw_hex: '0x99',
  });
  renderTable({
    onMarkedKeysChange,
    onLastMarkedKeyChange,
    onListFollowChange,
    gotoRequest: { id: 1, telegram: hidden },
  });

  expect(onMarkedKeysChange).not.toHaveBeenCalled();
  expect(onLastMarkedKeyChange).not.toHaveBeenCalled();
  // The list still moves to that time (nearest visible row) and stops following.
  expect(onListFollowChange).toHaveBeenCalledWith(false);
});
