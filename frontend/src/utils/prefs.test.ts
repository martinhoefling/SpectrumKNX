import { describe, it, expect, beforeEach } from 'vitest';
import { getPref, setPref, removePref } from './prefs';

const clearCookies = () => {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=-99999999; path=/`;
  }
};

describe('prefs', () => {
  beforeEach(() => {
    localStorage.clear();
    clearCookies();
  });

  it('returns null for unknown preferences', () => {
    expect(getPref('nope')).toBeNull();
  });

  it('round-trips values through localStorage', () => {
    setPref('theme', 'dark');
    expect(getPref('theme')).toBe('dark');
    expect(localStorage.getItem('spectrum-knx.theme')).toBe('dark');
  });

  it('stores empty strings distinctly from missing values', () => {
    setPref('loadLimit', '');
    expect(getPref('loadLimit')).toBe('');
  });

  it('removes values', () => {
    setPref('rateMode', 'm');
    removePref('rateMode');
    expect(getPref('rateMode')).toBeNull();
  });

  it('migrates a legacy cookie to localStorage on first read', () => {
    document.cookie = 'theme=light; path=/';
    expect(getPref('theme')).toBe('light');
    // Value moved into localStorage…
    expect(localStorage.getItem('spectrum-knx.theme')).toBe('light');
    // …and the cookie is gone.
    expect(document.cookie).not.toContain('theme=light');
  });

  it('prefers localStorage over a lingering legacy cookie', () => {
    document.cookie = 'theme=light; path=/';
    setPref('theme', 'dark');
    expect(getPref('theme')).toBe('dark');
  });

  it('erases the legacy cookie on write so it cannot resurface', () => {
    document.cookie = 'rateMode=h; path=/';
    setPref('rateMode', 's');
    expect(document.cookie).not.toContain('rateMode=h');
    expect(getPref('rateMode')).toBe('s');
  });

  it('migrates JSON-valued cookies intact', () => {
    const widths = JSON.stringify({ time: 120, source: 90 });
    document.cookie = `columnWidths=${widths}; path=/`;
    expect(getPref('columnWidths')).toBe(widths);
    expect(JSON.parse(getPref('columnWidths')!)).toEqual({ time: 120, source: 90 });
  });
});
