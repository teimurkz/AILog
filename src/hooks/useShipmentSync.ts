import { useEffect, useMemo, useRef } from 'react';
import { shipmentsApi } from '../services/api';
import { findLinkedShipment, shipmentPatchFor } from '../../shared/shipment-link';
import { formatTrackingDate, stageDate, stageLabel, type TruckStage, type TruckTrackingEntry } from '../../shared/truck-tracking';
import type { Shipment } from '../types';

/**
 * Keeps "Отправления" in step with "Слежка авто": for every truck whose invoice matches one
 * shipment, the SVH arrival / unload dates and the status are written to that shipment.
 * Runs only for users who may edit shipments, and only after both lists are confirmed by the server.
 */
export function useShipmentSync(entries: TruckTrackingEntry[], stages: TruckStage[], shipments: Shipment[], enabled: boolean) {
  const links = useMemo(() => new Map(entries.map(entry => [entry.id, findLinkedShipment(entry.invoice, shipments)])), [entries, shipments]);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    for (const entry of entries) {
      const shipment = links.get(entry.id);
      if (!shipment) continue;
      const patch = shipmentPatchFor(entry, stages, shipment);
      if (!patch) continue;
      const signature = shipment.id + JSON.stringify(patch);
      if (inFlight.current.has(signature)) continue;
      inFlight.current.add(signature);
      // Shipment journal entries stay in Russian like the rest of the shipment history.
      const reached = [...stages].reverse().find(stage => stageDate(entry, stage.id));
      const note = reached ? `Слежка авто: ${stageLabel(reached, 'ru')} ${formatTrackingDate(stageDate(entry, reached.id))}` : 'Слежка авто';
      void shipmentsApi.update(shipment.id, patch)
        .then(() => patch.status ? shipmentsApi.addLog(shipment.id, { location: 'СВХ', message: note, updatedBy: 'Слежка авто' }) : undefined)
        .catch(error => console.warn('Слежка авто: не удалось обновить отправление', shipment.id, error))
        .finally(() => setTimeout(() => inFlight.current.delete(signature), 30000));
    }
  }, [entries, stages, links, enabled]);

  return links;
}
