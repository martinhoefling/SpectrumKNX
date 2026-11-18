import { describe, expect, test } from 'vitest';
import {
  coerceValue,
  formatDpt,
  isTextDptMain,
  parseDptMain,
  payloadFromValue,
  textDptCharWidth,
  textDptEncoding,
  textDptWritePayload,
} from './knxSend';

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

describe('coerceValue', () => {
  test('reads hex and binary integers', () => {
    expect(coerceValue('0x10')).toBe(16);
    expect(coerceValue('0X0A')).toBe(10);
    expect(coerceValue('0b11')).toBe(3);
    expect(coerceValue('0B01')).toBe(1);
  });

  test('refuses a radix prefix without valid digits', () => {
    expect(() => coerceValue('0b12')).toThrow('Invalid value: 0b12');
    expect(() => coerceValue('0x')).toThrow('Invalid value: 0x');
    expect(() => coerceValue('0b')).toThrow('Invalid value: 0b');
  });
});

describe('payloadFromValue', () => {
  test('accepts decimal, hex and binary inside a bare main width', () => {
    expect(payloadFromValue('0', '2')).toBe(0);
    expect(payloadFromValue('3', '2')).toBe(3);
    expect(payloadFromValue('0x3', '2')).toBe(3);
    expect(payloadFromValue('0b01', '2')).toBe(1);
    expect(payloadFromValue('0b11', '2')).toBe(3);
  });

  test('rejects values that do not fit the bare main', () => {
    expect(() => payloadFromValue('4', '2')).toThrow('Value 4 is out of range for DPT 2 (0–3)');
    expect(() => payloadFromValue('0b100', '2')).toThrow('Value 4 is out of range for DPT 2 (0–3)');
    expect(() => payloadFromValue('0x4', '2')).toThrow('Value 4 is out of range for DPT 2 (0–3)');
    expect(() => payloadFromValue('nope', '2')).toThrow('Invalid value: nope');
  });

  test('reads a signed bare main as two\'s complement for hex and binary', () => {
    expect(payloadFromValue('-1', '6')).toBe(-1);
    expect(payloadFromValue('0xFF', '6')).toBe(-1);
    expect(payloadFromValue('0b10000000', '6')).toBe(-128);
    expect(() => payloadFromValue('255', '6')).toThrow('Value 255 is out of range for DPT 6 (-128–127)');
    expect(() => payloadFromValue('0x100', '6')).toThrow('Value 256 is out of range for DPT 6 (-128–127)');
  });

  test('leaves a full subtype to the number, including hex', () => {
    expect(payloadFromValue('0x10', '5.001')).toBe(16);
    expect(payloadFromValue('21.5', '9.001')).toBe(21.5);
  });
});

describe('text DPT helpers', () => {
  test('recognises character/string mains and their widths', () => {
    expect(isTextDptMain(4)).toBe(true);
    expect(isTextDptMain(16)).toBe(true);
    expect(isTextDptMain(28)).toBe(true);
    expect(isTextDptMain(5)).toBe(false);
    expect(textDptCharWidth(4)).toBe(1);
    expect(textDptCharWidth(16)).toBe(14);
    expect(textDptCharWidth(28)).toBeNull();
  });

  test('maps subtypes to ASCII / Latin-1 / UTF-8', () => {
    expect(textDptEncoding('4')).toBe('ascii');
    expect(textDptEncoding('4.001')).toBe('ascii');
    expect(textDptEncoding('4.002')).toBe('latin1');
    expect(textDptEncoding('16')).toBe('ascii');
    expect(textDptEncoding('16.000')).toBe('ascii');
    expect(textDptEncoding('16.001')).toBe('latin1');
    expect(textDptEncoding('28')).toBe('utf8');
    expect(textDptEncoding('28.001')).toBe('utf8');
    expect(textDptEncoding('5.001')).toBeNull();
  });

  test('pads and slices fixed-width payloads without trimming', () => {
    expect(textDptWritePayload('', '4.001')).toBe(' ');
    expect(textDptWritePayload('Hi', '16.000')).toBe('Hi'.padEnd(14, ' '));
    expect(textDptWritePayload('  Hi', '16.000')).toBe('  Hi'.padEnd(14, ' '));
    expect(textDptWritePayload('x'.repeat(20), '16.000')).toBe('x'.repeat(14));
    expect(textDptWritePayload('AB', '4.001')).toBe('A');
    expect(textDptWritePayload('Café', '28.001')).toBe('Café');
  });

  test('rejects characters outside the DPT charset', () => {
    expect(() => textDptWritePayload('Ä', '16.000')).toThrow(
      'Character not allowed for DPT 16.000 (ASCII)',
    );
    expect(textDptWritePayload('Ä', '16.001')).toBe('Ä'.padEnd(14, ' '));
    expect(textDptWritePayload('Ä', '4.002')).toBe('Ä');
  });
});
