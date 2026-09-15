export interface OutlookSettings {
  tenantId: string;
  clientId: string;
  mailbox: string;
  sender: string;
  importFrom: string;
  travelDays: number;
  enabled: boolean;
}
export interface MailDocument {
  id: string;
  fileName: string;
  size: number;
  contentType: string;
  sha256: string;
  url: string;
  receivedAt: string;
}
export interface OutlookImportLog {
  id: string;
  subject: string;
  receivedAt: string;
  checkedAt: string;
  status: 'created' | 'updated' | 'review';
  invoice?: string;
  shipmentId?: string;
  documents?: number;
  reason?: string;
}
export interface OutlookStatus {
  settings: OutlookSettings;
  connected: boolean;
  connectedMailbox: string | null;
  lastHeartbeat: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  busy: boolean;
  logs: OutlookImportLog[];
}
export interface OutlookLogin {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  interval: number;
}
export type MailImportSettings = Pick<OutlookSettings, 'mailbox' | 'sender' | 'importFrom' | 'travelDays' | 'enabled'>;
export interface PowerAutomateStatus {
  settings: MailImportSettings;
  configured: boolean;
  lastReceived: string | null;
  lastError: string | null;
  lastErrorAt?: string | null;
}

// Treat invoice names as identifiers. Never parse 0012.30 as a number or strip
// punctuation: those transformations can merge different trucks.
export const invoiceKey = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, '').toLowerCase();
export const emailKey = (value: string) => value.trim().toLowerCase();

export function validateOutlookSettings(input: unknown): OutlookSettings {
  const value = input as Partial<OutlookSettings>;
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!value || !guid.test(value.tenantId || '') || !guid.test(value.clientId || '')) {
    throw new Error('Укажите Tenant ID и Client ID приложения Microsoft.');
  }
  return { tenantId: value.tenantId!, clientId: value.clientId!, ...validateMailImportSettings(value) };
}
export function validateMailImportSettings(input: unknown): MailImportSettings {
  const value = input as Partial<MailImportSettings>;
  if (!value) throw new Error('Укажите настройки импорта.');
  const email = /^[a-z0-9.!#$%&*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  if (!email.test(value.mailbox || '') || !email.test(value.sender || '')) throw new Error('Проверьте адрес почты и адрес отправителя.');
  const time = Date.parse(value.importFrom || '');
  if (!Number.isFinite(time) || time > Date.now()) throw new Error('Укажите дату начала импорта не позднее текущего времени.');
  if (!Number.isInteger(value.travelDays) || value.travelDays! < 1 || value.travelDays! > 180) throw new Error('Ожидаемый срок перевозки: от 1 до 180 дней.');
  if (typeof value.enabled !== 'boolean') throw new Error('Не указан режим импорта.');
  return { mailbox: emailKey(value.mailbox!),
    sender: emailKey(value.sender!), importFrom: new Date(time).toISOString(), travelDays: value.travelDays!, enabled: value.enabled };
}
