import { differenceInDays, parseISO, isAfter } from 'date-fns';
import { Shipment } from '../types';

function shipmentDate(value?: string, almaty = false): Date | undefined {
  if (!value) return;
  const dotted = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const normalized = dotted ? `${dotted[3]}-${dotted[2]}-${dotted[1]}` : value;
  const parsed = parseISO(almaty && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized + 'T00:00:00+05:00' : normalized);
  if (!Number.isFinite(parsed.getTime())) return;
  return parsed;
}
export function shipmentDaysPassed(shipment: Partial<Shipment>, now = new Date()): number | null {
  const byEmail = shipment.transit_start_source === 'email';
  const start = shipmentDate(byEmail ? shipment.documents_received_at : shipment.departure_date, byEmail);
  const arrival = shipmentDate(shipment.actual_arrival_date, byEmail) || shipmentDate(shipment.unl_date, byEmail);
  if (!start || (shipment.status === 'Delivered' && !arrival)) return null;
  const end = arrival || now;
  if (end.getTime() < start.getTime()) return 0;
  // Email receipts contain an exact instant. Use elapsed 24-hour periods so
  // colleagues in different browser time zones see the same counter.
  return shipment.transit_start_source === 'email' ? Math.floor((end.getTime() - start.getTime()) / 86400000) : differenceInDays(end, start);
}

export const isShipmentDelayed = (shipment: Shipment): boolean => {
  if (shipment.status === 'Delivered') return false;
  if (shipment.status === 'Delay') return true;

  const now = new Date();
  const deadline = parseISO(shipment.arrival_deadline || '');
  const lastUpdated = parseISO(shipment.last_updated || '');

  const isPastDeadline = isAfter(now, deadline);
  const isStale = differenceInDays(now, lastUpdated) >= 14;

  return isPastDeadline || isStale;
};
