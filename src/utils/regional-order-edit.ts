import type { RegionalTruckOrder, RegionalOrderStatus } from '../types';
import { isClosedRegionalOrder, type StatusChangeOptions } from '../../shared/regional-order-status';

type EditableOrder = Pick<RegionalTruckOrder, 'status' | 'assignedDriver' | 'assignedTruckPlate'>;
export function buildRegionalOrderEdit(original: EditableOrder, draft: EditableOrder): Partial<RegionalTruckOrder> & StatusChangeOptions {
  const patch: Partial<RegionalTruckOrder> & StatusChangeOptions = {};
  const assignedDriver = (draft.assignedDriver || '').trim();
  const assignedTruckPlate = (draft.assignedTruckPlate || '').trim();
  if (assignedDriver !== (original.assignedDriver || '')) patch.assignedDriver = assignedDriver;
  if (assignedTruckPlate !== (original.assignedTruckPlate || '')) patch.assignedTruckPlate = assignedTruckPlate;
  let status: RegionalOrderStatus = draft.status;
  // Only auto-assign a newly filled order; an explicit status correction wins.
  if (original.status === 'new' && status === 'new' && Object.keys(patch).length && (assignedDriver || assignedTruckPlate)) status = 'assigned';
  if (status !== original.status) {
    patch.status = status;
    patch.expectedStatus = original.status;
    if (isClosedRegionalOrder(original.status)) patch.correctClosedStatus = true;
  }
  return patch;
}
