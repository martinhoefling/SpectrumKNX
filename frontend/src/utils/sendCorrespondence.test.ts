import { describe, expect, it } from 'vitest';
import {
  sanitizeSecondsInput,
  correspondenceKeyFromDraft,
  rowsEqualForCorrespondence,
} from './sendCorrespondence';

describe('sanitizeSecondsInput', () => {
  it('keeps positive integers', () => {
    expect(sanitizeSecondsInput('12')).toBe('12');
  });
  it('clears zero, decimals, and junk', () => {
    expect(sanitizeSecondsInput('0')).toBe('');
    expect(sanitizeSecondsInput('1.5')).toBe('');
    expect(sanitizeSecondsInput('abc')).toBe('');
  });
});

describe('correspondence matching', () => {
  it('matches identical keys', () => {
    const a = correspondenceKeyFromDraft({
      address: '1/1/1', dpt: '1.001', value: '1', delay: '5', every: '',
    });
    const b = correspondenceKeyFromDraft({
      address: ' 1/1/1 ', dpt: '1.001', value: '1', delay: '5', every: '',
    });
    expect(rowsEqualForCorrespondence(a, b)).toBe(true);
  });

  it('does not match when DPT differs', () => {
    const a = correspondenceKeyFromDraft({
      address: '1/1/1', dpt: '1.001', value: '', delay: '2', every: '',
    });
    const b = correspondenceKeyFromDraft({
      address: '1/1/1', dpt: '5.001', value: '', delay: '2', every: '',
    });
    expect(rowsEqualForCorrespondence(a, b)).toBe(false);
  });
});
