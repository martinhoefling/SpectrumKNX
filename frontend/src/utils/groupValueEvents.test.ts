import { expect, test } from 'vitest';
import {
  answeredReadIds,
  busEventKind,
  gaReadPhases,
  isGroupRead,
  isGroupResponse,
  isReadKind,
  matchingResponse,
  mergeGaReadPhase,
  readAnsweredByVisible,
  readEventAnswered,
  responsesFollowingReads,
  rowsIntersectingViewport,
  telegramBusEventKind,
} from './groupValueEvents';

const row = (
  timestamp: string,
  simplified_type: string,
  target_address = '1/2/3',
  telegram_type?: string,
) => ({ timestamp, simplified_type, target_address, telegram_type });

test('display labels and APCI names share one Read/Response/Write classifier', () => {
  expect(busEventKind('READ')).toBe('read');
  expect(busEventKind('Read')).toBe('read');
  expect(busEventKind('RESPONSE')).toBe('response');
  expect(busEventKind('GroupValueResponse')).toBe('response');
  expect(busEventKind('GroupValueRead')).toBe('read');
  expect(busEventKind('GroupValueWrite')).toBe('write');
  expect(busEventKind('WRITE')).toBe('write');
  expect(isReadKind('READ')).toBe(true);
  expect(isReadKind('RESPONSE')).toBe(false);
  expect(isReadKind('GroupValueRead')).toBe(true);
  // "Response" does not contain "Read"; a response label is never a read.
  expect(isReadKind('GroupValueResponse')).toBe(false);
});

test('simplified_type wins, so a row is never both a Read and a Response', () => {
  const mixed = {
    simplified_type: 'Read',
    telegram_type: 'GroupValueResponse',
  };
  expect(telegramBusEventKind(mixed)).toBe('read');
  expect(isGroupRead(mixed)).toBe(true);
  expect(isGroupResponse(mixed)).toBe(false);

  expect(isGroupRead({ simplified_type: null, telegram_type: 'GroupValueRead' })).toBe(true);
  expect(isGroupResponse({ simplified_type: '', telegram_type: 'GroupValueResponse' })).toBe(true);
  expect(isGroupRead(null)).toBe(false);
});

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

test('the goto target is the earliest later Response, not a later one', () => {
  const read = row('2026-01-01T10:00:00Z', 'Read');
  const first = row('2026-01-01T10:00:02Z', 'Response');
  const second = row('2026-01-01T10:00:09Z', 'Response');
  expect(matchingResponse(read, [second, read, first])).toBe(first);
  const followed = responsesFollowingReads([read, second, first]);
  expect(followed.get(`${read.timestamp}|1/2/3`)).toBe(first);
});

test('address match is exact, including surrounding spaces', () => {
  const read = row('2026-01-01T10:00:00Z', 'Read', '1/2/3');
  expect(matchingResponse(read, [row('2026-01-01T10:00:01Z', 'Response', '1/2/3 ')])).toBeNull();
});

test('send-panel phase follows telegrams as they arrive', () => {
  const read = row('2026-01-01T10:00:00Z', 'Read', '1/2/3');
  expect(gaReadPhases([read]).get('1/2/3')).toBe('request');
  const response = row('2026-01-01T10:00:01Z', 'Response', '1/2/3');
  expect(gaReadPhases([read, response]).get('1/2/3')).toBe('answered');
  const again = row('2026-01-01T10:00:05Z', 'Read', '1/2/3');
  expect(gaReadPhases([read, response, again]).get('1/2/3')).toBe('request');
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

test('a time-sorted Read is answered only when a later Response intersects the viewport', () => {
  const response = row('2026-01-01T10:00:02Z', 'Response');
  const read = row('2026-01-01T10:00:00Z', 'Read');
  const rows = [response, read];
  const spans = [
    { index: 0, start: 0, end: 85 },
    { index: 1, start: 85, end: 170 },
  ];
  const top = rowsIntersectingViewport(rows, spans, 0, 80);
  expect(top).toEqual([response]);
  expect(readAnsweredByVisible(read, top)).toBe(true);

  const bottom = rowsIntersectingViewport(rows, spans, 90, 80);
  expect(bottom).toEqual([read]);
  expect(readAnsweredByVisible(read, bottom)).toBe(false);

  // Unmeasured spans and overscan outside the scrollport do not count.
  expect(rowsIntersectingViewport(rows, [{ index: 0, start: 0, end: 0 }], 0, 80)).toEqual([]);
  expect(rowsIntersectingViewport(rows, spans, 200, 80)).toEqual([]);
  expect(rowsIntersectingViewport(rows, spans, 0, 0)).toEqual([]);
});
