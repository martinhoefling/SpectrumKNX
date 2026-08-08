import { describe, it, expect } from 'vitest';
import { makeAddressPatternMatcher } from './addressPattern';

describe('makeAddressPatternMatcher', () => {
  it('matches an exact address', () => {
    const m = makeAddressPatternMatcher('1/2/3');
    expect(m('1/2/3')).toBe(true);
    expect(m('1/2/4')).toBe(false);
  });

  it('matches a wildcard segment (group address)', () => {
    const m = makeAddressPatternMatcher('1/5/*');
    expect(m('1/5/0')).toBe(true);
    expect(m('1/5/255')).toBe(true);
    expect(m('1/6/0')).toBe(false);
  });

  it('matches wildcards in multiple segments', () => {
    const m = makeAddressPatternMatcher('*/*/255');
    expect(m('1/5/255')).toBe(true);
    expect(m('9/0/255')).toBe(true);
    expect(m('9/0/254')).toBe(false);
  });

  it('matches a physical-address wildcard', () => {
    const m = makeAddressPatternMatcher('*.1.*');
    expect(m('1.1.5')).toBe(true);
    expect(m('9.1.200')).toBe(true);
    expect(m('1.2.5')).toBe(false);
  });

  it('rejects a value with the wrong segment count', () => {
    const m = makeAddressPatternMatcher('1/5/*');
    expect(m('1.5.3')).toBe(false); // different delimiter entirely
  });

  it('matches a range between two full physical addresses', () => {
    const m = makeAddressPatternMatcher('1.2.12-1.2.91');
    expect(m('1.2.12')).toBe(true);
    expect(m('1.2.50')).toBe(true);
    expect(m('1.2.91')).toBe(true);
    expect(m('1.2.11')).toBe(false);
    expect(m('1.2.92')).toBe(false);
    expect(m('1.3.1')).toBe(false);
  });

  it('matches a group-address range', () => {
    const m = makeAddressPatternMatcher('3/1/1-3/1/127');
    expect(m('3/1/1')).toBe(true);
    expect(m('3/1/127')).toBe(true);
    expect(m('3/1/128')).toBe(false);
  });

  it('handles a reversed range (hi given before lo)', () => {
    const m = makeAddressPatternMatcher('3/1/127-3/1/1');
    expect(m('3/1/50')).toBe(true);
  });

  it('matches a DPT-key range and a DPT-key wildcard', () => {
    const m = makeAddressPatternMatcher('1.008-1.011, 16.*');
    expect(m('1.008')).toBe(true);
    expect(m('1.010')).toBe(true);
    expect(m('1.012')).toBe(false);
    expect(m('16.000')).toBe(true);
    expect(m('16.001')).toBe(true);
    expect(m('9.001')).toBe(false);
  });

  it('ORs multiple comma-separated tokens', () => {
    const m = makeAddressPatternMatcher('1/1/1, 1/2/*, 2/0/0-2/0/9');
    expect(m('1/1/1')).toBe(true);
    expect(m('1/2/99')).toBe(true);
    expect(m('2/0/5')).toBe(true);
    expect(m('3/0/0')).toBe(false);
  });

  it('an empty pattern matches everything', () => {
    const m = makeAddressPatternMatcher('   ');
    expect(m('anything')).toBe(true);
  });

  it('ignores whitespace around tokens', () => {
    const m = makeAddressPatternMatcher(' 1/1/1 , 1/2/3 ');
    expect(m('1/1/1')).toBe(true);
    expect(m('1/2/3')).toBe(true);
  });
});
