/**
 * New regional orders as a list for a transport company to start looking for trucks.
 * Only what a carrier needs for the search: route, loading date, truck, cargo. Client contacts,
 * invoices and staff e-mails stay in the CRM.
 */

export interface CarrierOrderSource {
  id: string;
  orderNumber?: string;
  status?: string;
  originCity?: string;
  destinationCity?: string;
  deliveryAddress?: string;
  deliveryPoints?: Array<{ address?: string; note?: string }>;
  shipmentDate?: string;
  truckType?: string;
  palletsCount?: string;
  weight?: string;
  cargoDescription?: string;
  comments?: string;
}

export interface CarrierRequestRow {
  id: string;
  orderNumber: string;
  loadingDate: string;
  origin: string;
  destination: string;
  route: string;
  unloading: string[];
  truckType: string;
  pallets: string;
  weight: string;
  cargo: string;
  comment: string;
}

export interface CarrierDirection {
  route: string;
  truckType: string;
  trucks: number;
  firstDate: string;
  orderNumbers: string[];
}

export interface CarrierRequest {
  rows: CarrierRequestRow[];
  directions: CarrierDirection[];
}

const clean = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value);

/** Dated orders first, earliest loading first; free-text and missing dates go last. */
function byLoadingDate(a: CarrierRequestRow, b: CarrierRequestRow) {
  const da = isDay(a.loadingDate) ? a.loadingDate : '9999' + a.loadingDate;
  const db = isDay(b.loadingDate) ? b.loadingDate : '9999' + b.loadingDate;
  return da.localeCompare(db) || a.route.localeCompare(b.route, 'ru') || a.orderNumber.localeCompare(b.orderNumber, 'ru', { numeric: true });
}

/**
 * The orders to send: the chosen ones when `ids` is given, otherwise every order still waiting for a truck.
 * `unknownPlace` fills a missing city so the route still reads.
 */
export function buildCarrierRequest(orders: CarrierOrderSource[], options: { ids?: string[]; unknownPlace?: string } = {}): CarrierRequest {
  const chosen = options.ids?.length ? new Set(options.ids) : null;
  const unknown = options.unknownPlace ?? '—';
  const rows = orders
    .filter(order => chosen ? chosen.has(order.id) : order.status === 'new')
    .map(order => {
      const origin = clean(order.originCity) || unknown;
      const destination = clean(order.destinationCity) || unknown;
      const points = (order.deliveryPoints || [])
        .map(point => [clean(point.address), clean(point.note)].filter(Boolean).join(' — '))
        .filter(Boolean);
      const address = clean(order.deliveryAddress);
      return {
        id: order.id,
        orderNumber: clean(order.orderNumber),
        loadingDate: clean(order.shipmentDate),
        origin, destination, route: `${origin} → ${destination}`,
        unloading: points.length ? points : address ? [address] : [],
        truckType: clean(order.truckType),
        pallets: clean(order.palletsCount),
        weight: clean(order.weight),
        cargo: clean(order.cargoDescription),
        comment: clean(order.comments),
      };
    })
    .sort(byLoadingDate);

  const groups = new Map<string, CarrierDirection>();
  for (const row of rows) {
    const key = JSON.stringify([row.origin.toLowerCase(), row.destination.toLowerCase(), row.truckType.toLowerCase()]);
    const group = groups.get(key) || { route: row.route, truckType: row.truckType, trucks: 0, firstDate: '', orderNumbers: [] };
    group.trucks += 1;
    if (row.orderNumber) group.orderNumbers.push(row.orderNumber);
    // Rows come earliest first, so the first real date is the earliest one.
    if (!group.firstDate && isDay(row.loadingDate)) group.firstDate = row.loadingDate;
    groups.set(key, group);
  }
  const directions = [...groups.values()]
    .sort((a, b) => b.trucks - a.trucks || a.route.localeCompare(b.route, 'ru') || a.truckType.localeCompare(b.truckType, 'ru'));
  return { rows, directions };
}
