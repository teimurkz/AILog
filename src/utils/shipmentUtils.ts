import { differenceInDays, parseISO, isAfter } from 'date-fns';
import { Shipment } from '../types';

export const isShipmentDelayed = (shipment: Shipment): boolean => {
  if (shipment.status === 'Delivered') return false;
  if (shipment.status === 'Delay') return true;

  const now = new Date();
  const deadline = parseISO(shipment.arrival_deadline);
  const lastUpdated = parseISO(shipment.last_updated);

  const isPastDeadline = isAfter(now, deadline);
  const isStale = differenceInDays(now, lastUpdated) >= 14;

  return isPastDeadline || isStale;
};
