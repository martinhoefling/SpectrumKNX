import { describe, expect, test } from 'vitest';
import { parseDptMain, formatDpt } from './knxSend';

describe('parseDptMain', () => {
  test('parses a full main.sub DPT', () => {
    expect(parseDptMain('5.010')).toBe(5);
    expect(parseDptMain('1.001')).toBe(1);
    expect(parseDptMain('232.600')).toBe(232);
  });

  test('parses a bare main DPT', () => {
    expect(parseDptMain('1')).toBe(1);
    expect(parseDptMain('9')).toBe(9);
  });

  test('tolerates surrounding whitespace', () => {
    expect(parseDptMain('  5.010 ')).toBe(5);
  });

  test('returns undefined for empty or malformed input', () => {
    expect(parseDptMain('')).toBeUndefined();
    expect(parseDptMain('   ')).toBeUndefined();
    expect(parseDptMain('abc')).toBeUndefined();
    expect(parseDptMain('5.')).toBeUndefined();
    expect(parseDptMain('.1')).toBeUndefined();
    expect(parseDptMain('5.x')).toBeUndefined();
  });

  test('is the inverse of formatDpt for the main part', () => {
    expect(parseDptMain(formatDpt(5, 10))).toBe(5);
    expect(parseDptMain(formatDpt(1))).toBe(1);
  });
});
