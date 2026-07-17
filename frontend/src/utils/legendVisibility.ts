// Legend visibility per group address (#192): charts are torn down and
// recreated whenever new data arrives, so user toggles must live outside the
// uPlot instance (and outside React render state — they are set from uPlot
// event hooks). Kept for the session, like series colors.
const hidden = new Set<string>();

export function isSeriesHidden(address: string): boolean {
  return hidden.has(address);
}

export function setSeriesHidden(address: string, value: boolean): void {
  if (value) hidden.add(address);
  else hidden.delete(address);
}

/** Clear the hidden flag for the given addresses. Called when a target is
 * deselected so that reselecting it shows the series again (#205). */
export function clearSeriesHidden(addresses: Iterable<string>): void {
  for (const a of addresses) hidden.delete(a);
}
