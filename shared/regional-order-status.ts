export const REGIONAL_ORDER_STATUSES = ['new', 'assigned', 'loading', 'dispatched', 'delivered', 'cancelled'] as const;
export type RegionalOrderStatus = typeof REGIONAL_ORDER_STATUSES[number];
export const isRegionalOrderStatus = (value: unknown): value is RegionalOrderStatus =>
  typeof value === 'string' && (REGIONAL_ORDER_STATUSES as readonly string[]).includes(value);
export const isClosedRegionalOrder = (status: RegionalOrderStatus) => status === 'delivered' || status === 'cancelled';

export interface StatusChangeOptions {
  expectedStatus?: RegionalOrderStatus;
  correctClosedStatus?: boolean;
}

export interface RegionalStatusCorrection {
  from: RegionalOrderStatus;
  to: RegionalOrderStatus;
  at: string;
  by: string;
  previousDeliveredAt?: string;
}
