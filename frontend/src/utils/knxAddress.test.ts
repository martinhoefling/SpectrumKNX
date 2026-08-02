import { describe, expect, it } from 'vitest';
import { compareKnxAddress } from './knxAddress';

describe('compareKnxAddress', () => {
  it('sorts PAs numerically not lexicographically', () => {
    const addrs = ['1.0.10', '1.0.2', '1.0.1', '1.0.100', '1.0.11'];
    const sorted = [...addrs].sort(compareKnxAddress);
    expect(sorted).toEqual(['1.0.1', '1.0.2', '1.0.10', '1.0.11', '1.0.100']);
  });

  it('sorts 3-part GAs numerically', () => {
    const addrs = ['1/2/10', '1/2/2', '1/2/1', '1/10/1', '1/2/11'];
    const sorted = [...addrs].sort(compareKnxAddress);
    expect(sorted).toEqual(['1/2/1', '1/2/2', '1/2/10', '1/2/11', '1/10/1']);
  });

  it('sorts 2-part GAs numerically', () => {
    const addrs = ['0/10', '0/2', '0/1', '1/1', '0/11'];
    const sorted = [...addrs].sort(compareKnxAddress);
    expect(sorted).toEqual(['0/1', '0/2', '0/10', '0/11', '1/1']);
  });

  it('handles mixed 2-part and 3-part GAs', () => {
    const addrs = ['1/2/3', '1/2', '1/1/255', '1/1'];
    const sorted = [...addrs].sort(compareKnxAddress);
    expect(sorted).toEqual(['1/1', '1/1/255', '1/2', '1/2/3']);
  });

  it('considers leading segments first', () => {
    const addrs = ['2/1/1', '1/2/1', '1/1/2'];
    const sorted = [...addrs].sort(compareKnxAddress);
    expect(sorted).toEqual(['1/1/2', '1/2/1', '2/1/1']);
  });

  it('returns 0 for equal addresses', () => {
    expect(compareKnxAddress('1/2/3', '1/2/3')).toBe(0);
    expect(compareKnxAddress('1.1.1', '1.1.1')).toBe(0);
  });
});
