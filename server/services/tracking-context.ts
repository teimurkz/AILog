import { AsyncLocalStorage } from 'node:async_hooks';
export const usesFirebase = () => process.env.CRM_STORAGE_MODE !== 'local';
export const trackingEffects = new AsyncLocalStorage<Array<() => void>>();
export function afterTrackingCommit(effect: () => void) {
  const pending = trackingEffects.getStore();
  if (pending) pending.push(effect); else effect();
}
