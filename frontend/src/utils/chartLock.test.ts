import { describe, it, expect } from 'vitest';
import { splitLockedBuckets } from './chartLock';
import type { ChartBucket, ChartSeries } from '../hooks/useChartData';

const series = (address: string): ChartSeries => ({ address, name: address, data: [1], real: [true] });

const bucket = (unit: string, addresses: string[]): ChartBucket => ({
  unit, isBinary: false, isEvents: false, timestamps: [1000], series: addresses.map(series),
});

describe('splitLockedBuckets', () => {
  it('passes through a bucket with no lock thresholds unchanged, as a single group', () => {
    const buckets = [bucket('lx', ['1/1/1', '1/1/2'])];
    const out = splitLockedBuckets(buckets, ['1/1/1', '1/1/2'], { '1/1/1': 'lx', '1/1/2': 'lx' }, {});
    expect(out).toHaveLength(1);
    expect(out[0].bucket.series.map(s => s.address)).toEqual(['1/1/1', '1/1/2']);
    expect(out[0]).toMatchObject({ groupIndex: 1, groupCount: 1, isLatest: true });
  });

  it('reorders an unlocked bucket to selection order too, not arrival order', () => {
    const buckets = [bucket('lx', ['1/1/3', '1/1/1', '1/1/2'])]; // arrival order
    const addressToUnit = { '1/1/1': 'lx', '1/1/2': 'lx', '1/1/3': 'lx' };
    const out = splitLockedBuckets(buckets, ['1/1/2', '1/1/1', '1/1/3'], addressToUnit, {});
    expect(out[0].bucket.series.map(s => s.address)).toEqual(['1/1/2', '1/1/1', '1/1/3']);
  });

  it('splits a locked unit into two charts by selection order', () => {
    const buckets = [bucket('lx', ['1/1/1', '1/1/2', '1/1/3'])];
    const addressToUnit = { '1/1/1': 'lx', '1/1/2': 'lx', '1/1/3': 'lx' };
    // Locked after the first 2 GAs were selected.
    const out = splitLockedBuckets(buckets, ['1/1/1', '1/1/2', '1/1/3'], addressToUnit, { lx: [2] });

    expect(out).toHaveLength(2);
    expect(out[0].bucket.series.map(s => s.address)).toEqual(['1/1/1', '1/1/2']);
    expect(out[0]).toMatchObject({ groupIndex: 1, groupCount: 2, isLatest: false });
    expect(out[1].bucket.series.map(s => s.address)).toEqual(['1/1/3']);
    expect(out[1]).toMatchObject({ groupIndex: 2, groupCount: 2, isLatest: true });
  });

  it('respects selection order, not the bucket series array order', () => {
    const buckets = [bucket('lx', ['1/1/3', '1/1/1', '1/1/2'])]; // arbitrary series order
    const addressToUnit = { '1/1/1': 'lx', '1/1/2': 'lx', '1/1/3': 'lx' };
    // Selection order: 2 was picked first, then 1, then 3. Lock after the first 2 selections.
    const out = splitLockedBuckets(buckets, ['1/1/2', '1/1/1', '1/1/3'], addressToUnit, { lx: [2] });

    expect(out[0].bucket.series.map(s => s.address)).toEqual(['1/1/2', '1/1/1']);
    expect(out[1].bucket.series.map(s => s.address)).toEqual(['1/1/3']);
  });

  it('supports multiple locks, producing three charts', () => {
    const buckets = [bucket('lx', ['1/1/1', '1/1/2', '1/1/3', '1/1/4'])];
    const addressToUnit = Object.fromEntries(['1/1/1', '1/1/2', '1/1/3', '1/1/4'].map(a => [a, 'lx']));
    const out = splitLockedBuckets(buckets, ['1/1/1', '1/1/2', '1/1/3', '1/1/4'], addressToUnit, { lx: [1, 3] });

    expect(out).toHaveLength(3);
    expect(out.map(g => g.bucket.series.map(s => s.address))).toEqual([
      ['1/1/1'], ['1/1/2', '1/1/3'], ['1/1/4'],
    ]);
    expect(out.map(g => g.isLatest)).toEqual([false, false, true]);
  });

  it('leaves other units alone', () => {
    const buckets = [bucket('lx', ['1/1/1', '1/1/2']), bucket('°C', ['1/1/3'])];
    const addressToUnit = { '1/1/1': 'lx', '1/1/2': 'lx', '1/1/3': '°C' };
    const out = splitLockedBuckets(buckets, ['1/1/1', '1/1/2', '1/1/3'], addressToUnit, { lx: [1] });

    expect(out).toHaveLength(3); // lx split into 2 + °C untouched
    expect(out.find(g => g.bucket.unit === '°C')).toMatchObject({ groupIndex: 1, groupCount: 1 });
  });

  it('produces unique keys across split groups', () => {
    const buckets = [bucket('lx', ['1/1/1', '1/1/2'])];
    const out = splitLockedBuckets(buckets, ['1/1/1', '1/1/2'], { '1/1/1': 'lx', '1/1/2': 'lx' }, { lx: [1] });
    expect(new Set(out.map(g => g.key)).size).toBe(out.length);
  });
});
