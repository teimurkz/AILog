export interface OutlookSettings {
  tenantId: string;
  clientId: string;
  mailbox: string;
  /** Allowed senders: addresses and/or whole domains ("@company.com"), separated by commas. */
  sender: string;
  importFrom: string;
  travelDays: number;
  enabled: boolean;
  /** Route of shipments created from emails without an Excel invoice (scans and PDF only). */
  defaultRoute?: ShipmentRoute;
  /** Name of such shipments: "<prefix> <number>", e.g. "Mehkaz 478"; empty gives just "478". */
  namePrefix?: string;
}
export const SHIPMENT_ROUTES = ['Amol - Almaty', 'Tehran - Almaty'] as const;
export type ShipmentRoute = typeof SHIPMENT_ROUTES[number];
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
  /** The original email is kept, so the review can be resolved by attaching it to a shipment. */
  linkable?: boolean;
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
export type MailImportSettings = Pick<OutlookSettings, 'mailbox' | 'sender' | 'importFrom' | 'travelDays' | 'enabled' | 'defaultRoute' | 'namePrefix'>;
export interface MailRefreshResult {
  requestedAt: string;
  from: string;
  to: string;
  days: number;
  rechecked: number;
  resolved: number;
}
export interface PowerAutomateStatus {
  settings: MailImportSettings;
  configured: boolean;
  /** A "resend emails for a period" flow URL is saved (the URL itself never leaves the server). */
  refreshConfigured?: boolean;
  refreshHost?: string | null;
  lastRefresh?: MailRefreshResult | null;
  lastReceived: string | null;
  lastError: string | null;
  lastErrorAt?: string | null;
}

// Treat invoice names as identifiers. Never parse 0012.30 as a number or strip
// punctuation: those transformations can merge different trucks.
export const invoiceKey = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, '').toLowerCase();
export const emailKey = (value: string) => value.trim().toLowerCase();

const emailPattern = /^[a-z0-9.!#$%&*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const domainPattern = /^@?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Sender rules from the settings field: full addresses, or domains written as
 * "@company.com" / "company.com" that accept every address of that domain.
 * Throws when an entry is neither.
 */
export function senderRules(value: string): string[] {
  const entries = [...new Set(value.split(/[\s,;]+/).map(emailKey).filter(Boolean))];
  if (!entries.length || entries.length > 50) throw new Error('Укажите от 1 до 50 отправителей: адреса или домены.');
  return entries.map(entry => {
    if (emailPattern.test(entry)) return entry;
    if (domainPattern.test(entry)) return '@' + entry.replace(/^@/, '');
    throw new Error(`«${entry.slice(0, 80)}» — не адрес и не домен. Пример: al.babaei@solico-group.ir, @solico-group.com`);
  });
}
/** Exact address match, or the address belongs to an allowed domain (not its subdomains). */
export function senderAllowed(address: string, rules: string): boolean {
  const from = emailKey(address);
  if (!emailPattern.test(from)) return false;
  let list: string[];
  try { list = senderRules(rules); } catch { return false; }
  return list.some(rule => rule.startsWith('@') ? from.endsWith(rule) : from === rule);
}
/** The one address to pre-filter by in Microsoft Graph, when the rules name exactly one address. */
export function singleSender(rules: string): string | undefined {
  try { const list = senderRules(rules); return list.length === 1 && !list[0].startsWith('@') ? list[0] : undefined; }
  catch { return undefined; }
}

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
  if (!emailPattern.test(value.mailbox || '')) throw new Error('Проверьте адрес почты.');
  const senders = senderRules(String(value.sender || ''));
  const time = Date.parse(value.importFrom || '');
  if (!Number.isFinite(time) || time > Date.now()) throw new Error('Укажите дату начала импорта не позднее текущего времени.');
  if (!Number.isInteger(value.travelDays) || value.travelDays! < 1 || value.travelDays! > 180) throw new Error('Ожидаемый срок перевозки: от 1 до 180 дней.');
  if (typeof value.enabled !== 'boolean') throw new Error('Не указан режим импорта.');
  const defaultRoute = value.defaultRoute ?? 'Amol - Almaty';
  if (!(SHIPMENT_ROUTES as readonly string[]).includes(defaultRoute)) throw new Error('Выберите маршрут для писем без Excel.');
  const namePrefix = String(value.namePrefix ?? '').trim().replace(/\s+/g, ' ');
  if (namePrefix.length > 40 || /[\x00-\x1f/\\]/.test(namePrefix)) throw new Error('Название для писем без Excel: до 40 символов, без / и \\.');
  return { mailbox: emailKey(value.mailbox!),
    sender: senders.join(', '), importFrom: new Date(time).toISOString(), travelDays: value.travelDays!, enabled: value.enabled, defaultRoute, namePrefix };
}

/** Name of a shipment created from an email without Excel: "Mehkaz 478" or "478". */
export const autoShipmentName = (number: string, prefix?: string) => (prefix?.trim() ? `${prefix.trim()} ${number}` : number);

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
/** Calendar days of a manual refresh period (inclusive), at most 92 days, not in the future (Almaty). */
export function refreshDays(from: string, to: string, now = Date.now()): string[] {
  if (!isoDay.test(from) || !isoDay.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new Error('Укажите даты периода.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  if (from > to) throw new Error('Дата начала периода позже даты окончания.');
  if (to > today) throw new Error('Период не может заканчиваться в будущем.');
  const days: string[] = [];
  for (let time = Date.parse(from + 'T00:00:00Z'); time <= Date.parse(to + 'T00:00:00Z'); time += 86400000) days.push(new Date(time).toISOString().slice(0, 10));
  if (days.length > 92) throw new Error('Период обновления — не больше 92 дней. Разбейте его на части.');
  return days;
}

/** Only Power Automate / Logic Apps HTTP-trigger URLs may be called by the server. */
export function validateRefreshUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Вставьте ссылку HTTP POST URL из триггера потока.'); }
  const host = url.hostname.toLowerCase();
  const allowed = ['.logic.azure.com', '.powerplatform.com', '.powerautomate.com'].some(suffix => host.endsWith(suffix));
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || url.port) {
    throw new Error('Это не ссылка триггера Power Automate. Скопируйте HTTP POST URL из «When a HTTP request is received».');
  }
  return url.toString();
}
