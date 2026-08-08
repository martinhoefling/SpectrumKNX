import { describe, it, expect } from 'vitest';
import { makeValueMatcher, type ValueMatchable } from './valuePattern';

function v(overrides: Partial<ValueMatchable>): ValueMatchable {
  return { value_numeric: null, raw_hex: null, value_formatted: null, unit: null, ...overrides };
}

describe('makeValueMatcher', () => {
  it('treats two plain numbers as an inclusive numeric range', () => {
    const m = makeValueMatcher('100', '200');
    expect(m(v({ value_numeric: 100 }))).toBe(true);
    expect(m(v({ value_numeric: 150 }))).toBe(true);
    expect(m(v({ value_numeric: 200 }))).toBe(true);
    expect(m(v({ value_numeric: 99 }))).toBe(false);
    expect(m(v({ value_numeric: 201 }))).toBe(false);
  });

  it('handles a reversed numeric range', () => {
    const m = makeValueMatcher('200', '100');
    expect(m(v({ value_numeric: 150 }))).toBe(true);
  });

  it('matches a single decimal value with no second row', () => {
    const m = makeValueMatcher('42', '');
    expect(m(v({ value_numeric: 42 }))).toBe(true);
    expect(m(v({ value_numeric: 43 }))).toBe(false);
  });

  it('matches decimal wildcards: + for one digit, * for any run', () => {
    const m = makeValueMatcher('1+3', '');
    expect(m(v({ value_numeric: 123 }))).toBe(true);
    expect(m(v({ value_numeric: 143 }))).toBe(true);
    expect(m(v({ value_numeric: 1243 }))).toBe(false);

    const star = makeValueMatcher('*000', '');
    expect(star(v({ value_numeric: 5000 }))).toBe(true);
    expect(star(v({ value_numeric: 5001 }))).toBe(false);
  });

  it('matches an exact hex pattern against raw_hex', () => {
    const m = makeValueMatcher('0x07', '');
    expect(m(v({ raw_hex: '07' }))).toBe(true);
    expect(m(v({ raw_hex: '08' }))).toBe(false);
  });

  it('matches hex wildcards', () => {
    const m = makeValueMatcher('0x0+', '');
    expect(m(v({ raw_hex: '01' }))).toBe(true);
    expect(m(v({ raw_hex: '0f' }))).toBe(true);
    expect(m(v({ raw_hex: '10' }))).toBe(false);
  });

  it('matches an exact binary pattern against the decoded bits', () => {
    const m = makeValueMatcher('0b1', '');
    expect(m(v({ raw_hex: '01' }))).toBe(true); // 00000001, strips to "1"
    expect(m(v({ raw_hex: '00' }))).toBe(false);
  });

  it('matches binary wildcards against the full decoded byte', () => {
    const m = makeValueMatcher('0b0000000+', '');
    expect(m(v({ raw_hex: '01' }))).toBe(true); // 00000001
    expect(m(v({ raw_hex: '02' }))).toBe(false); // 00000010
  });

  it('matches a quoted pattern as regex against the formatted value', () => {
    const m = makeValueMatcher('"\\d+ lx"', '');
    expect(m(v({ value_formatted: '120 lx' }))).toBe(true);
    expect(m(v({ value_formatted: 'On' }))).toBe(false);
  });

  it('degrades an invalid quoted regex to a literal wildcard pattern', () => {
    const m = makeValueMatcher('"*000"', '');
    expect(m(v({ value_formatted: '5000' }))).toBe(true);
  });

  it('an empty cell matches everything', () => {
    const m = makeValueMatcher('', '');
    expect(m(v({ value_numeric: 1 }))).toBe(true);
  });

  it('ORs the two rows when they are not both plain numbers', () => {
    const m = makeValueMatcher('On', 'Off');
    expect(m(v({ value_formatted: 'On' }))).toBe(true);
    expect(m(v({ value_formatted: 'Off' }))).toBe(true);
    expect(m(v({ value_formatted: 'Toggle' }))).toBe(false);
  });
});
