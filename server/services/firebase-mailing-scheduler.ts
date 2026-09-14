import { db } from '../config/firebase.js';
import { runMailingTick, SCHEDULER_STATE, type MailingJobStore } from './mailing-job-runner.js';
import { executeMailingDispatch } from './scheduler.service.js';
import { getWarehouseData } from './warehouse.service.js';

export const firebaseMailingStore: MailingJobStore = {
  transaction: work => db.runTransaction(async tx => work({
    get: async path => (await tx.get(db.doc(path))).data(),
    set: (path, patch) => { tx.set(db.doc(path), JSON.parse(JSON.stringify(patch)), { merge: true }); },
  })),
};

export async function runFirebaseMailingTick() {
  try {
    await runMailingTick({
      store: firebaseMailingStore,
      loadWarehouse: () => getWarehouseData(true, undefined, { requireFresh: true }),
      dispatch: executeMailingDispatch,
    });
  } catch {
    // Leave a visible error if possible; never fall back to local settings/recipients.
    await db.doc(SCHEDULER_STATE).set({ lastRunStatus: 'failed', lastError: 'Не удалось выполнить проверку расписания. Проверьте журнал функции warehouseMailing и доступ к Firestore.' }, { merge: true }).catch(() => {});
    throw new Error('Warehouse mailing scheduler failed; check Firestore access and schedule configuration.');
  }
}
