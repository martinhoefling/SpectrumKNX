/**
 * Data width / kind of each DPT main type, following the KNX System
 * Specification "Datapoint Types" main-type table (#273).
 */
const DPT_MAIN_WIDTHS: Record<number, string> = {
  1: '1-bit',
  2: '2-bit · 1-bit controlled',
  3: '4-bit · 3-bit controlled',
  4: '8-bit character',
  5: '8-bit unsigned',
  6: '8-bit signed',
  7: '2-byte unsigned',
  8: '2-byte signed',
  9: '2-byte float',
  10: '3-byte time',
  11: '3-byte date',
  12: '4-byte unsigned',
  13: '4-byte signed',
  14: '4-byte float',
  15: '4-byte access data',
  16: '14-byte string',
  17: '8-bit scene number',
  18: '8-bit scene control',
  19: '8-byte date & time',
  20: '8-bit enumeration',
  21: '8-bit bit set',
  22: '2-byte bit set',
  23: '2-bit enumeration',
  25: '2-nibble',
  26: '8-bit scene info',
  27: '4-byte bit set',
  28: 'UTF-8 string',
  29: '8-byte signed',
  232: '3-byte RGB colour',
  235: 'tariff & energy',
  238: '8-bit scene',
  251: '6-byte RGBW colour',
};

/** "1-bit" for main 1, '' for mains not in the spec table. */
export const dptWidthLabel = (main: number): string => DPT_MAIN_WIDTHS[main] ?? '';

/** Label for a bare main-type filter key ("1" = every 1.x subtype). */
export const bareDptLabel = (main: number): string => {
  const width = dptWidthLabel(main);
  return `DPT ${main} · all${width ? ` ${width}` : ''} subtypes`;
};
