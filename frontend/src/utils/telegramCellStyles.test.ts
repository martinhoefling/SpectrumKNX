import { expect, test } from 'vitest';
import { answeredReadIds, gaReadPhases, mergeGaReadPhase, readEventAnswered } from './telegramCellStyles';

const row = (
  timestamp: string,
  simplified_type: string,
  target_address = '1/2/3',
) => ({ timestamp, simplified_type, target_address });

test('a Response greens a Read only when the Read is strictly older', () => {
  const read = row('2026-01-01T10:00:02Z', 'Read');
  expect(readEventAnswered(read, [row('2026-01-01T10:00:01Z', 'Response')])).toBe(false);
  expect(readEventAnswered(read, [row('2026-01-01T10:00:02Z', 'Response')])).toBe(false);
  expect(readEventAnswered(read, [row('2026-01-01T10:00:03Z', 'Response')])).toBe(true);
  expect(readEventAnswered(read, [row('2026-01-01T10:00:03Z', 'Response', '9/9/9')])).toBe(false);
});

test('a later Response on the same GA answers the Read', () => {
  const read = row('2026-01-01T10:00:00Z', 'Read');
  const ids = answeredReadIds([
    read,
    row('2026-01-01T10:00:01Z', 'Response'),
  ]);
  expect(ids.has(`${read.timestamp}|1/2/3`)).toBe(true);
});

test('a Read stays unanswered until a Response arrives, and a later Read is not answered by an earlier Response', () => {
  const first = row('2026-01-01T10:00:00Z', 'Read');
  const second = row('2026-01-01T10:00:05Z', 'Read');
  const ids = answeredReadIds([
    first,
    row('2026-01-01T10:00:02Z', 'Response'),
    second,
  ]);
  expect(ids.has(`${first.timestamp}|1/2/3`)).toBe(true);
  expect(ids.has(`${second.timestamp}|1/2/3`)).toBe(false);
});

test('a Response on another GA does not answer the Read', () => {
  const read = row('2026-01-01T10:00:00Z', 'Read', '1/2/3');
  const ids = answeredReadIds([
    read,
    row('2026-01-01T10:00:01Z', 'Response', '9/9/9'),
  ]);
  expect(ids.has(`${read.timestamp}|1/2/3`)).toBe(false);
});

test('a later Read reopens an answered GA until the next Response', () => {
  const phases = gaReadPhases([
    row('2026-01-01T10:00:05Z', 'Read', '1/2/3'),
    row('2026-01-01T10:00:01Z', 'Response', '1/2/3'),
    row('2026-01-01T10:00:00Z', 'Read', '1/2/3'),
    row('2026-01-01T10:00:00Z', 'Read', '4/5/6'),
    row('2026-01-01T10:00:04Z', 'Response', '7/8/9'),
    row('2026-01-01T10:00:03Z', 'Read', '7/8/9'),
  ]);
  expect(phases.get('1/2/3')).toBe('request');
  expect(phases.get('4/5/6')).toBe('request');
  expect(phases.get('7/8/9')).toBe('answered');
  expect(phases.has('9/9/9')).toBe(false);
  expect(mergeGaReadPhase('request', 'answered')).toBe('request');
  expect(mergeGaReadPhase('none', 'answered')).toBe('answered');
  expect(mergeGaReadPhase('none', 'request')).toBe('request');
});
