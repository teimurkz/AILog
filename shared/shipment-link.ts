// Links "Слежка авто" to "Отправления": when the team moves a truck through the SVH stages,
// the matching shipment gets the SVH arrival / unload date and its status automatically.
import { formatTrackingDate, stageDate, type TruckStage, type TruckTrackingEntry } from './truck-tracking';

/** What a stage's date means for the linked shipment. */
export type ShipmentSync = NonNullable<TruckStage['shipmentSync']>;
export const SHIPMENT_SYNC_OPTIONS: ShipmentSync[] = ['customs', 'unloaded'];
const DEFAULT_SYNC: Record<string, ShipmentSync> = { arrived: 'customs', unloaded: 'unloaded' };

/** The stage's link to shipments: its own setting, else the default for the built-in stages. */
export function stageShipmentSync(stage: Pick<TruckStage, 'id' | 'shipmentSync'>): ShipmentSync | null {
  return stage.shipmentSync !== undefined ? stage.shipmentSync : DEFAULT_SYNC[stage.id] ?? null;
}

export interface LinkableShipment {
  id: string;
  invoice_id?: string;
  commercial_invoice_number?: string;
  status?: string;
  customs_arrival_date?: string;
  unl_date?: string;
}

const key = (value?: string) => String(value || '').normalize('NFC').trim().replace(/\s+/g, '').toLowerCase();
const trailingNumber = (value?: string) => String(value || '').trim().match(/(\d+(?:[.-]\d+)*)$/)?.[1];

/**
 * The one shipment a tracking invoice belongs to: the same name ("Mehkaz 475"), otherwise the
 * same invoice number ("475" ↔ "Mehkaz 475" or a full invoice "…-475"). Ambiguous → none.
 */
export function findLinkedShipment<T extends LinkableShipment>(invoice: string, shipments: T[]): T | null {
  const wanted = key(invoice);
  if (!wanted) return null;
  const exact = shipments.filter(shipment => key(shipment.invoice_id) === wanted);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const number = trailingNumber(invoice);
  if (!number || number.replace(/\D/g, '').length < 2) return null;
  const byNumber = shipments.filter(shipment => trailingNumber(shipment.invoice_id) === number
    || String(shipment.commercial_invoice_number || '').trim() === number
    || String(shipment.commercial_invoice_number || '').trim().endsWith('-' + number));
  return byNumber.length === 1 ? byNumber[0] : null;
}

export interface ShipmentSyncPatch {
  customs_arrival_date?: string;
  unl_date?: string;
  status?: 'Customs' | 'Delivered';
}

/**
 * The shipment changes implied by the truck's stage dates, or null when nothing changes.
 * Dates are only filled or corrected, never cleared, and a delivered shipment is never moved back.
 */
export function shipmentPatchFor(entry: Pick<TruckTrackingEntry, 'stageDates'>, stages: TruckStage[],
  shipment: LinkableShipment): ShipmentSyncPatch | null {
  const patch: ShipmentSyncPatch = {};
  for (const stage of stages) {
    const sync = stageShipmentSync(stage), date = formatTrackingDate(stageDate(entry, stage.id));
    if (!sync || !date) continue;
    if (sync === 'customs' && shipment.customs_arrival_date !== date) patch.customs_arrival_date = date;
    if (sync === 'unloaded' && shipment.unl_date !== date) patch.unl_date = date;
  }
  const customs = stages.some(stage => stageShipmentSync(stage) === 'customs' && stageDate(entry, stage.id));
  const unloaded = stages.some(stage => stageShipmentSync(stage) === 'unloaded' && stageDate(entry, stage.id));
  if (unloaded && shipment.status !== 'Delivered') patch.status = 'Delivered';
  else if (customs && !unloaded && shipment.status !== 'Delivered' && shipment.status !== 'Customs') patch.status = 'Customs';
  return Object.keys(patch).length ? patch : null;
}
