/**
 * localStorage-backed UI preferences (#246 Phase 1).
 *
 * Preferences were previously stored in cookies; reads fall back to a legacy
 * cookie with the same name and migrate it to localStorage on first access,
 * so existing installations keep their settings.
 *
 * All storage access is wrapped: when localStorage is unavailable (private
 * browsing, storage disabled) preferences silently degrade to defaults.
 */

const PREFIX = 'spectrum-knx.';

const readCookie = (name: string): string | null => {
  const nameEQ = name + '=';
  for (let c of document.cookie.split(';')) {
    while (c.charAt(0) === ' ') c = c.substring(1);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
  }
  return null;
};

const eraseCookie = (name: string) => {
  document.cookie = name + '=; Max-Age=-99999999; path=/';
};

export const getPref = (name: string): string | null => {
  try {
    const stored = localStorage.getItem(PREFIX + name);
    if (stored !== null) return stored;
    // Legacy cookie migration: move the value over once, then drop the cookie.
    const legacy = readCookie(name);
    if (legacy !== null) {
      localStorage.setItem(PREFIX + name, legacy);
      eraseCookie(name);
    }
    return legacy;
  } catch {
    return null;
  }
};

export const setPref = (name: string, value: string) => {
  try {
    localStorage.setItem(PREFIX + name, value);
    eraseCookie(name);
  } catch {
    // Storage unavailable — the preference just won't persist.
  }
};

export const removePref = (name: string) => {
  try {
    localStorage.removeItem(PREFIX + name);
    eraseCookie(name);
  } catch {
    // Storage unavailable — nothing to remove.
  }
};
