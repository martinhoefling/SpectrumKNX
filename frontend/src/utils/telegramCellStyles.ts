/**
 * Telegram-table cell style class names. Visual tokens live as `--tt-*` CSS
 * variables / `.tt-*` classes in index.css so future prefs can restyle cells
 * without touching call sites.
 */

export const TT = {
  cell: 'tt-cell',
  time: 'tt-time',
  timeDate: 'tt-time-date',
  delta: 'tt-delta',
  deltaRow: 'tt-delta-row',
  addr: 'tt-addr',
  addrSource: 'tt-addr-source',
  addrTarget: 'tt-addr-target',
  subtitle: 'tt-subtitle',
  subtitleTargetName: 'tt-subtitle-target-name',
  type: 'tt-type',
  typeWrite: 'tt-type-write',
  typeRead: 'tt-type-read',
  typeResponse: 'tt-type-response',
  typeOther: 'tt-type-other',
  directionIn: 'tt-direction-in',
  directionOut: 'tt-direction-out',
  dpt: 'tt-dpt',
  dptDot: 'tt-dpt-dot',
  dptDot1: 'tt-dpt-dot-1',
  dptDot5: 'tt-dpt-dot-5',
  dptDot9: 'tt-dpt-dot-9',
  dptDotUnknown: 'tt-dpt-dot-unknown',
  value: 'tt-value',
  valueUnit: 'tt-value-unit',
  valueRow: 'tt-value-row',
  valueToggle: 'tt-value-toggle',
  rawBadge: 'raw-badge',
} as const;

/** Type label class for Write / Read / Response (falls back to other). */
export function ttTypeClass(simplified: string | null | undefined): string {
  switch (simplified) {
    case 'Write': return `${TT.type} ${TT.typeWrite}`;
    case 'Read': return `${TT.type} ${TT.typeRead}`;
    case 'Response': return `${TT.type} ${TT.typeResponse}`;
    default: return `${TT.type} ${TT.typeOther}`;
  }
}

/** Direction subtitle class. */
export function ttDirectionClass(direction: string | null | undefined): string {
  return direction === 'Outgoing' ? TT.directionOut : TT.directionIn;
}

/** DPT colour-dot class from main category. */
export function ttDptDotClass(dptMain: number | null | undefined): string {
  if (dptMain === 1) return `${TT.dptDot} ${TT.dptDot1}`;
  if (dptMain === 5) return `${TT.dptDot} ${TT.dptDot5}`;
  if (dptMain === 9) return `${TT.dptDot} ${TT.dptDot9}`;
  return `${TT.dptDot} ${TT.dptDotUnknown}`;
}
