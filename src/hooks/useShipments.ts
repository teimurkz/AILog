import { useMemo } from 'react';
import { useFirestoreCollection } from './useFirestoreCollection';
import type { Shipment } from '../types';

export const useShipments = () => {
  const { data, ...state } = useFirestoreCollection<Shipment>('shipments');
  // Sort after reading: orderBy would omit legacy documents without this field.
  const shipments = useMemo(() => [...data].sort((a, b) =>
    (Date.parse(b.last_updated || '') || 0) - (Date.parse(a.last_updated || '') || 0)), [data]);
  return { shipments, ...state };
};
