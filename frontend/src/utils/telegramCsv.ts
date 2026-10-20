// CSV export of telegrams (#522). The columns match the backend's
// `telegram_export.CSV_COLUMNS`, so a list export and a database export
// (`/api/export?format=csv`) open the same way in a spreadsheet.
import type { Telegram } from '../hooks/useWebSocket';

export type CsvDelimiter = ',' | ';';

const COLUMNS: [string, (t: Telegram) => string | number | null | undefined][] = [
  ['timestamp', t => t.timestamp],
  ['source', t => t.source_address],
  ['source_name', t => t.source_name],
  ['target', t => t.target_address],
  ['target_name', t => t.target_name],
  ['type', t => t.simplified_type ?? t.telegram_type],
  ['direction', t => t.direction],
  ['dpt', t => (t.dpt_main == null ? '' : t.dpt_sub == null ? String(t.dpt_main) : `${t.dpt_main}.${String(t.dpt_sub).padStart(3, '0')}`)],
  ['dpt_name', t => t.dpt_name],
  ['value', t => t.value_formatted],
  ['value_numeric', t => t.value_numeric],
  ['unit', t => t.unit],
  ['raw', t => t.raw_hex],
];

/** Quotes a cell when it contains the delimiter, a quote or a line break (RFC 4180). */
function csvCell(value: string | number | null | undefined, delimiter: CsvDelimiter): string {
  if (value == null) return '';
  const s = String(value);
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text (header + one line per telegram, CRLF line ends like Python's csv module). */
export function telegramsToCsv(telegrams: Telegram[], delimiter: CsvDelimiter = ','): string {
  const lines = [COLUMNS.map(([label]) => label).join(delimiter)];
  for (const t of telegrams) lines.push(COLUMNS.map(([, get]) => csvCell(get(t), delimiter)).join(delimiter));
  return lines.join('\r\n') + '\r\n';
}

/** Default delimiter: ';' where the locale writes decimal commas (e.g. German Excel), else ','. */
export function defaultCsvDelimiter(locale?: string): CsvDelimiter {
  return (1.5).toLocaleString(locale).includes(',') ? ';' : ',';
}

/** Saves telegrams as a CSV file, with a UTF-8 BOM so Excel detects the encoding. */
export function downloadTelegramsCsv(telegrams: Telegram[], delimiter: CsvDelimiter = defaultCsvDelimiter()): void {
  const blob = new Blob(['﻿', telegramsToCsv(telegrams, delimiter)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  a.href = url;
  a.download = `spectrum-knx-view-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
