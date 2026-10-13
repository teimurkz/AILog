export interface RegionalReportOrder {
  id: string;
  orderNumber?: string;
  status: string;
  originCity?: string;
  destinationCity?: string;
  dispatchedAt?: string;
  shipmentDate?: string;
  assignedTruckPlate?: string;
  assignedDriver?: string;
  invoiceNumber?: string;
  managerName?: string;
}

export interface RegionalReportFilters {
  from?: string;
  to?: string;
  destination?: string;
  status?: 'all' | 'dispatched' | 'delivered';
}

export interface RegionalReportRow {
  id: string;
  orderNumber: string;
  date: string;
  dateSource: 'actual' | 'shipment' | 'missing';
  origin: string;
  destination: string;
  route: string;
  plate: string;
  driver: string;
  invoice: string;
  manager: string;
  status: 'dispatched' | 'delivered';
}

const clean = (value?: string) => String(value || '').trim().replace(/\s+/g, ' ');
const key = (value: string) => clean(value).toLocaleLowerCase('ru-RU');

function validDay(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Do not turn a missing departure into a creation/delivery date. */
export function regionalReportDate(value?: string): string {
  const text = clean(value);
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (isoDay) return validDay(+isoDay[1], +isoDay[2], +isoDay[3]);
  const readableDay = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (readableDay) return validDay(+readableDay[3], +readableDay[2], +readableDay[1]);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return '';
  if (!regionalReportDate(text.slice(0, 10))) return '';
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatRegionalReportDate(date: string): string {
  return date ? date.split('-').reverse().join('.') : 'Не указана';
}

export function buildRegionalOrdersReport(orders: RegionalReportOrder[], filters: RegionalReportFilters = {}) {
  const from = filters.from ? regionalReportDate(filters.from) : '';
  const to = filters.to ? regionalReportDate(filters.to) : '';
  if ((filters.from && !from) || (filters.to && !to)) throw new Error('Укажите корректные даты периода.');
  if (from && to && from > to) throw new Error('Начало периода должно быть не позже его окончания.');

  // Firestore document ID identifies a trip; order numbers and plates can repeat.
  const unique = new Map(orders.filter(order => order.id).map(order => [order.id, order]));
  const sent = [...unique.values()].filter(order => order.status === 'dispatched' || order.status === 'delivered');
  const destinations = [...new Map(sent.filter(order => clean(order.destinationCity))
    .map(order => [key(order.destinationCity!), clean(order.destinationCity)])).values()]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  let undatedExcluded = 0;
  const rows: RegionalReportRow[] = [];
  for (const order of sent) {
    if (filters.status && filters.status !== 'all' && order.status !== filters.status) continue;
    if (filters.destination && key(order.destinationCity || '') !== key(filters.destination)) continue;
    const actual = regionalReportDate(order.dispatchedAt);
    const shipment = regionalReportDate(order.shipmentDate);
    const date = actual || shipment;
    if (!date && (from || to)) { undatedExcluded++; continue; }
    if (date && ((from && date < from) || (to && date > to))) continue;
    const origin = clean(order.originCity) || 'Не указан';
    const destination = clean(order.destinationCity) || 'Не указан';
    rows.push({
      id: order.id, orderNumber: clean(order.orderNumber) || order.id,
      date, dateSource: actual ? 'actual' : shipment ? 'shipment' : 'missing',
      origin, destination, route: `${origin} → ${destination}`,
      plate: clean(order.assignedTruckPlate), driver: clean(order.assignedDriver),
      invoice: clean(order.invoiceNumber), manager: clean(order.managerName),
      status: order.status as RegionalReportRow['status'],
    });
  }
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.orderNumber.localeCompare(b.orderNumber, 'ru'));
  const directions = new Map<string, { route: string; count: number; dispatched: number; delivered: number; firstDate: string; lastDate: string }>();
  for (const row of rows) {
    const routeKey = JSON.stringify([key(row.origin), key(row.destination)]);
    const group = directions.get(routeKey) || { route: row.route, count: 0, dispatched: 0, delivered: 0, firstDate: '', lastDate: '' };
    group.count++;
    group[row.status]++;
    if (row.date) {
      if (!group.firstDate || row.date < group.firstDate) group.firstDate = row.date;
      if (!group.lastDate || row.date > group.lastDate) group.lastDate = row.date;
    }
    directions.set(routeKey, group);
  }
  return {
    rows, destinations,
    directions: [...directions.values()].sort((a, b) => b.count - a.count || a.route.localeCompare(b.route, 'ru')),
    total: rows.length,
    dispatched: rows.filter(row => row.status === 'dispatched').length,
    delivered: rows.filter(row => row.status === 'delivered').length,
    shipmentDates: rows.filter(row => row.dateSource === 'shipment').length,
    undated: rows.filter(row => row.dateSource === 'missing').length,
    undatedExcluded,
  };
}

export type RegionalOrdersReport = ReturnType<typeof buildRegionalOrdersReport>;
