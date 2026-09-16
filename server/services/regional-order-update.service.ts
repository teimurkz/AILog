import { storageService, type RegionalOrderRecord } from './storage.service.js';
import { stopOrderTracking, updateCachedOrderStatus } from './driver-tracking.service.js';
import { withoutGps } from './gps-access.service.js';
import { isClosedRegionalOrder, isRegionalOrderStatus, type StatusChangeOptions } from '../../shared/regional-order-status.js';

export class RegionalOrderUpdateError extends Error {
  constructor(message: string, public statusCode: number) { super(message); }
}

// Invoked inside the same Firestore transaction as the HTTP request, so a
// driver's completion cannot race an administrator's correction unnoticed.
export function updateRegionalOrder(id: string, input: Partial<RegionalOrderRecord> & StatusChangeOptions,
  actor: { isAdmin: boolean; email: string }) {
  const existing = storageService.getOrder(id);
  if (!existing) throw new RegionalOrderUpdateError('Заявка не найдена.', 404);
  const { expectedStatus, correctClosedStatus, statusCorrections: _ignoredAudit,
    deliveredAt: _ignoredDeliveryDate, dispatchedAt: _ignoredDispatchDate, ...businessInput } = input;
  const updates = withoutGps(businessInput);
  if (updates.status !== undefined && !isRegionalOrderStatus(updates.status)) {
    throw new RegionalOrderUpdateError('Некорректный статус заявки.', 400);
  }
  if (updates.status !== undefined && expectedStatus !== undefined && expectedStatus !== existing.status) {
    throw new RegionalOrderUpdateError('Статус заявки уже изменился. Откройте заявку заново и повторите изменение.', 409);
  }
  const status = updates.status ?? existing.status;
  const statusChanged = status !== existing.status;
  const correction = statusChanged && isClosedRegionalOrder(existing.status);
  if (correction) {
    if (correctClosedStatus === true && !actor.isAdmin) {
      throw new RegionalOrderUpdateError('Исправить статус закрытого рейса может только администратор.', 403);
    }
    if (!actor.isAdmin || correctClosedStatus !== true || expectedStatus !== existing.status) {
      throw new RegionalOrderUpdateError('Рейс уже закрыт. Администратор может исправить статус в окне управления заявкой. Для новой доставки создайте новую заявку.', 409);
    }
  }

  const patch: Partial<RegionalOrderRecord> = { ...updates, id: existing.id,
    createdAt: existing.createdAt, createdByEmail: existing.createdByEmail, createdByName: existing.createdByName };
  if (correction) {
    patch.statusCorrections = [...(existing.statusCorrections || []), {
      from: existing.status, to: status, at: new Date().toISOString(), by: actor.email,
      ...(existing.deliveredAt ? { previousDeliveredAt: existing.deliveredAt } : {}),
    }];
    if (status !== 'delivered') patch.deliveredAt = undefined;
    if (!isClosedRegionalOrder(status)) {
      // Keep the real GPS history of this same trip, but require fresh consent
      // and a new live message. Old Telegram edits must not restart tracking.
      stopOrderTracking(existing.id);
      patch.driverConsent = false;
      patch.isTrackingActive = false;
      patch.speed = 0;
      patch.liveLocationExpiresAt = undefined;
    }
  }
  if (statusChanged) return updateCachedOrderStatus(existing.id, status, patch)!;
  // Editing a plate/name on a delivered order must not change its delivery date
  // or stop timestamp, and must not replay an old status from the browser.
  return storageService.saveOrder({ ...existing, ...patch });
}
