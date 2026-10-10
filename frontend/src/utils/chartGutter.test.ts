import { expect, test } from 'vitest';
import { LABEL_GUTTER, gutterWidthFor, metricGutterWidth, sharedLeftGutter } from './chartGutter';
import type { ChartBucket } from '../hooks/useChartData';

// 7px per character stands in for the canvas measurement.
const measure = (text: string) => text.length * 7;

const bucket = (over: Partial<ChartBucket>, values: (number | null)[] = [1]): ChartBucket => ({
  unit: '°C', isBinary: false, isEvents: false, timestamps: values.map((_, i) => i),
  series: [{ address: '1/2/3', name: 'A', data: values } as ChartBucket['series'][number]],
  ...over,
});

test('a metric chart needs room for its widest tick label, within limits', () => {
  // "24 °C" → 5 chars → 35 + 30 = 65
  expect(metricGutterWidth(bucket({}, [21.5, 23.4]).series, '°C', measure)).toBe(65);
  // tiny label: clamped up to the minimum
  expect(metricGutterWidth(bucket({ unit: '' }, [1]).series, '', measure)).toBe(60);
  // absurdly long unit: clamped down to the maximum
  expect(metricGutterWidth(bucket({}, [1]).series, 'x'.repeat(80), measure)).toBe(220);
  // negative values count by magnitude; gaps are ignored
  expect(metricGutterWidth(bucket({}, [null, -30000, 5]).series, 'lx', measure))
    .toBe(`${(30000).toLocaleString()} lx`.length * 7 + 30);
});

test('without a canvas the metric gutter falls back to a safe fixed width', () => {
  expect(metricGutterWidth(bucket({}).series, '°C', () => null)).toBe(150);
});

test('binary and event charts need their label gutter', () => {
  expect(gutterWidthFor(bucket({ isBinary: true }), measure)).toBe(LABEL_GUTTER);
  expect(gutterWidthFor(bucket({ isEvents: true }), measure)).toBe(LABEL_GUTTER);
});

test('all charts on screen share the widest gutter any of them needs', () => {
  const temperature = bucket({}, [23.4]);                    // 65
  const lux = bucket({ unit: 'lx' }, [30000]);               // wider tick labels
  const luxWidth = gutterWidthFor(lux, measure);
  expect(luxWidth).toBeGreaterThan(65);

  // metric charts only: the widest of them
  expect(sharedLeftGutter([temperature, lux], measure)).toBe(luxWidth);
  // with a timeline or events chart present: its label gutter, since it is wider
  expect(sharedLeftGutter([temperature, lux, bucket({ isBinary: true })], measure)).toBe(LABEL_GUTTER);
  // a metric chart wider than the label gutter wins over it
  const huge = bucket({ unit: 'x'.repeat(40) }, [1]);
  expect(sharedLeftGutter([huge, bucket({ isEvents: true })], measure)).toBe(220);
  expect(sharedLeftGutter([], measure)).toBe(0);
});
