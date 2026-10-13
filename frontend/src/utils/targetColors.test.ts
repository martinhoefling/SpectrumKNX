import { beforeEach, describe, expect, it } from 'vitest';
import { setPref } from './prefs';

beforeEach(() => {
  localStorage.clear();
});

// The store loads the stored colours once, when the module is first imported.
const freshModule = async () => {
  const { vi } = await import('vitest');
  vi.resetModules();
  return import('./targetColors');
};

describe('target colours (#509)', () => {
  it('a first click picks the first colour no other filtered address has', async () => {
    const { TARGET_COLORS, nextTargetColor } = await freshModule();
    expect(nextTargetColor({}, '1/2/3')).toBe(TARGET_COLORS[0]);
    expect(nextTargetColor({ '1/2/4': TARGET_COLORS[0] }, '1/2/3')).toBe(TARGET_COLORS[1]);
    expect(nextTargetColor({ a: TARGET_COLORS[0], b: TARGET_COLORS[2] }, '1/2/3')).toBe(TARGET_COLORS[1]);
    // Colours of addresses that are not in the filter do not count as taken.
    expect(nextTargetColor({ old: TARGET_COLORS[0] }, '1/2/3', ['1/2/3'])).toBe(TARGET_COLORS[0]);
  });

  it('with every colour taken it starts over at the first', async () => {
    const { TARGET_COLORS, nextTargetColor } = await freshModule();
    const all = Object.fromEntries(TARGET_COLORS.map((c, i) => [`0/0/${i}`, c]));
    expect(nextTargetColor(all, '1/2/3')).toBe(TARGET_COLORS[0]);
  });

  it('further clicks walk the palette and end at no colour', async () => {
    const { TARGET_COLORS, nextTargetColor } = await freshModule();
    let colors: Record<string, string> = {};
    const seen: (string | null)[] = [];
    for (let i = 0; i <= TARGET_COLORS.length; i++) {
      const next = nextTargetColor(colors, '1/2/3');
      seen.push(next);
      colors = next ? { '1/2/3': next } : {};
    }
    expect(seen).toEqual([...TARGET_COLORS, null]);
  });

  it('remembers colours across a reload and forgets a removed one', async () => {
    const first = await freshModule();
    first.setTargetColor('1/2/3', first.TARGET_COLORS[2]);
    first.setTargetColor('1/2/4', first.TARGET_COLORS[0]);
    first.setTargetColor('1/2/4', null);

    const { renderHook } = await import('@testing-library/react');
    const second = await freshModule();
    const { result } = renderHook(() => second.useTargetColors());
    expect(result.current).toEqual({ '1/2/3': second.TARGET_COLORS[2] });
  });

  it('ignores a malformed stored value and colours outside the palette', async () => {
    const { renderHook } = await import('@testing-library/react');
    setPref('targetColors', 'not json');
    let mod = await freshModule();
    expect(renderHook(() => mod.useTargetColors()).result.current).toEqual({});

    setPref('targetColors', JSON.stringify({ '1/2/3': 'url(evil)', '1/2/4': mod.TARGET_COLORS[1], '1/2/5': 7 }));
    mod = await freshModule();
    expect(renderHook(() => mod.useTargetColors()).result.current).toEqual({ '1/2/4': mod.TARGET_COLORS[1] });
  });
});
