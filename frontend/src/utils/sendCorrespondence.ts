import type { Telegram } from '../hooks/useWebSocket';
import type { BusPayload } from './dptValues';
import type { ScheduledSendStatus } from './knxSend';

/** delay/every: positive integers only; applied on blur (0 / decimals / junk → clear). */
export function sanitizeSecondsInput(raw: string): string {
  const t = raw.trim();
  if (t === '') return '';
  if (!/^[1-9]\d*$/.test(t)) return '';
  return t;
}

/** Fields that define popover ↔ send-panel row correspondence. */
export type SendCorrespondenceKey = {
  address: string;
  dpt: string;
  value: string;
  delay: string;
  every: string;
};

export function correspondenceKeyFromDraft(draft: {
  address: string;
  dpt: string;
  value: string;
  delay: string;
  every: string;
}): SendCorrespondenceKey {
  return {
    address: draft.address.trim(),
    dpt: draft.dpt.trim(),
    value: draft.value,
    delay: sanitizeSecondsInput(draft.delay),
    every: sanitizeSecondsInput(draft.every),
  };
}

export function rowsEqualForCorrespondence(
  a: SendCorrespondenceKey,
  b: SendCorrespondenceKey,
): boolean {
  return (
    a.address === b.address
    && a.dpt === b.dpt
    && a.value === b.value
    && a.delay === b.delay
    && a.every === b.every
  );
}

export type SendPanelCommand =
  | { type: 'ensureRow'; nonce: number; key: SendCorrespondenceKey; name?: string | null }
  | { type: 'cancelRow'; nonce: number; rowId: string }
  | { type: 'writeViaRow'; nonce: number; rowId: string; payload: BusPayload; response?: boolean }
  | { type: 'readViaRow'; nonce: number; rowId: string };

export type SendPanelCommandResult = {
  nonce: number;
  rowId: string | null;
  created: boolean;
  matched: boolean;
};

/** Status projection for a send-panel row (popover mirrors panel RowStatus). */
export type LinkedRowStatus = {
  rowId: string;
  job: ScheduledSendStatus | null;
  feedback: { ok: boolean; msg: string } | null;
  busy: boolean;
  statusWatch?: 'write' | 'read' | null;
  statusTelegram?: Telegram | null;
  address?: string;
  name?: string;
  value?: string;
  dpt?: string;
};
