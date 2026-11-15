// How jsdom serializes an inline style value. jsdom 31 rewrites values
// (`inset 4px 0 0 0 #3b82f6` -> `rgb(59, 130, 246) 4px 0px inset`,
// `transparent` background -> `none`), so compare against its own output
// instead of a hard-coded string.
export function cssValue(property: string, value: string): string {
  const probe = document.createElement('div');
  probe.style.setProperty(property, value);
  return probe.style.getPropertyValue(property);
}
