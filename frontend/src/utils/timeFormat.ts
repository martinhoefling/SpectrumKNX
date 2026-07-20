// Date-aware time formatting for the visualization (#281). When the plotted
// range spans more than one calendar day, time-only labels ("14:30") are
// ambiguous, so axis ticks, tooltips and the pan/zoom timeline show a date too.

/** True when the two instants fall on different calendar days (local time). */
export const spansMultipleDays = (minMs: number, maxMs: number): boolean =>
  new Date(minMs).toDateString() !== new Date(maxMs).toDateString();

/**
 * Axis tick label: `HH:mm`, prefixed with a short `MM-DD` date on multi-day
 * ranges so ticks that cross midnight stay unambiguous.
 */
export const formatAxisTime = (ms: number, multiDay: boolean): string => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!multiDay) return time;
  const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
  return `${date} ${time}`;
};

/**
 * Full timestamp for tooltips and the pan/zoom timeline edges: `HH:mm:ss`,
 * with a `YYYY-MM-DD` date prefix on multi-day ranges.
 */
export const formatFullTime = (ms: number, multiDay: boolean): string => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  if (!multiDay) return time;
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${date} ${time}`;
};
