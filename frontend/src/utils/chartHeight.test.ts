import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CHART_HEIGHT, MIN_CHART_HEIGHT, clampChartHeight, readChartHeight, writeChartHeight } from './chartHeight';
import { setPref } from './prefs';

beforeEach(() => localStorage.clear());

describe('chart heights (#185)', () => {
  it('clamps to the allowed range and rounds', () => {
    expect(clampChartHeight(10)).toBe(MIN_CHART_HEIGHT);
    expect(clampChartHeight(99999)).toBe(MAX_CHART_HEIGHT);
    expect(clampChartHeight(412.6)).toBe(413);
  });

  it('remembers a height per chart', () => {
    expect(readChartHeight('°C')).toBeNull();
    writeChartHeight('°C', 450);
    writeChartHeight('%', 200);
    expect(readChartHeight('°C')).toBe(450);
    expect(readChartHeight('%')).toBe(200);
    expect(readChartHeight('lx')).toBeNull();
  });

  it('forgets a height when reset', () => {
    writeChartHeight('°C', 450);
    writeChartHeight('°C', null);
    expect(readChartHeight('°C')).toBeNull();
  });

  it('stores a clamped value and survives a malformed pref', () => {
    writeChartHeight('°C', 5);
    expect(readChartHeight('°C')).toBe(MIN_CHART_HEIGHT);
    setPref('chartHeights', 'not json');
    expect(readChartHeight('°C')).toBeNull();
    setPref('chartHeights', '[1,2]');
    expect(readChartHeight('°C')).toBeNull();
    setPref('chartHeights', '{"°C":"tall"}');
    expect(readChartHeight('°C')).toBeNull();
  });
});
