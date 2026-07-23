import { describe, expect, test } from 'vitest';
import { decodeRawDpt, rawDptUnit, RAW_DPT_OPTIONS } from './rawDpt';

describe('decodeRawDpt (#315)', () => {
  test('8-bit unsigned / signed', () => {
    expect(decodeRawDpt([0xff], '5')).toBe(255);
    expect(decodeRawDpt([0x00], '5')).toBe(0);
    expect(decodeRawDpt([0xff], '6')).toBe(-1);
    expect(decodeRawDpt([0x80], '6')).toBe(-128);
    expect(decodeRawDpt([0x7f], '6')).toBe(127);
  });

  test('8-bit percent scalings', () => {
    expect(decodeRawDpt([0xff], '5.001')).toBeCloseTo(100, 6);
    expect(decodeRawDpt([0x80], '5.001')).toBeCloseTo((128 * 100) / 255, 6);
    expect(decodeRawDpt([0xff], '5.004')).toBe(255);
  });

  test('2-byte unsigned / signed (big-endian)', () => {
    expect(decodeRawDpt([0x12, 0x34], '7')).toBe(0x1234);
    expect(decodeRawDpt([0xff, 0xff], '7')).toBe(65535);
    expect(decodeRawDpt([0xff, 0xff], '8')).toBe(-1);
    expect(decodeRawDpt([0x80, 0x00], '8')).toBe(-32768);
  });

  test('DPT 9 KNX 2-byte float', () => {
    // 0x0000 → 0
    expect(decodeRawDpt([0x00, 0x00], '9')).toBeCloseTo(0, 6);
    // 21.0 °C encodes as 0x0C1A in the KNX 16-bit float format.
    expect(decodeRawDpt([0x0c, 0x1a], '9')).toBeCloseTo(21.0, 4);
    // 0.01 * 1 * 2^0 = 0.01 (mantissa 1, exponent 0)
    expect(decodeRawDpt([0x00, 0x01], '9')).toBeCloseTo(0.01, 6);
    // Negative: sign set, mantissa -1 → -0.01
    expect(decodeRawDpt([0x87, 0xff], '9')).toBeCloseTo(-0.01, 6);
  });

  test('4-byte unsigned / signed / float (big-endian)', () => {
    expect(decodeRawDpt([0x00, 0x00, 0x00, 0x01], '12')).toBe(1);
    expect(decodeRawDpt([0xff, 0xff, 0xff, 0xff], '13')).toBe(-1);
    // IEEE-754 float 1.0 = 0x3F800000
    expect(decodeRawDpt([0x3f, 0x80, 0x00, 0x00], '14')).toBeCloseTo(1.0, 6);
  });

  test('rejects width mismatches and invalid bytes', () => {
    expect(decodeRawDpt([0x12], '7')).toBeNull(); // needs 2 bytes
    expect(decodeRawDpt([0x12, 0x34, 0x56], '7')).toBeNull();
    expect(decodeRawDpt([], '5')).toBeNull();
    expect(decodeRawDpt([300], '5')).toBeNull(); // not a byte
    expect(decodeRawDpt([0x12], 'nonsense')).toBeNull();
  });

  test('rawDptUnit exposes the option unit', () => {
    expect(rawDptUnit('5.001')).toBe('%');
    expect(rawDptUnit('7')).toBe('');
    expect(rawDptUnit('missing')).toBe('');
  });

  test('every option round-trips a payload of its declared width', () => {
    for (const opt of RAW_DPT_OPTIONS) {
      const bytes = Array.from({ length: opt.bytes }, () => 0x01);
      expect(decodeRawDpt(bytes, opt.key)).not.toBeNull();
    }
  });
});
