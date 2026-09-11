import { collection, doc, onSnapshot, getDocsFromServer, getDocFromServer, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { isOwnerIdentity } from '../../shared/access-policy';
import { normalizeDocument, watchCollection, type CollectionState } from './collection-state';

// GPS collections are deliberately excluded from this ordinary CRM reader.
export type CrmCollection = 'shipments' | 'users' | 'saved_trucks' | 'saved_delivery_contacts';
export function subscribeToOwnerOrders<T>(publish: (state: CollectionState<T>) => void) {
  return watchCollection<T>((next, fail) => {
    if (!auth.currentUser || !isOwnerIdentity(auth.currentUser)) {
      fail({ code: 'permission-denied' });
      return () => {};
    }
    // Only the verified owner can use the existing direct Firestore read permission.
    return onSnapshot(collection(db, 'regional_orders'), { includeMetadataChanges: true }, snapshot => {
      next(snapshot.docs.map(doc => normalizeDocument(doc.id, doc.data())), snapshot.metadata.fromCache);
    }, fail);
  }, publish);
}
export function subscribeToCrmCollection<T>(path: CrmCollection, publish: (state: CollectionState<T>) => void) {
  return watchCollection<T>((next, fail) => onSnapshot(collection(db, path), { includeMetadataChanges: true }, snapshot => {
    next(snapshot.docs.map(doc => normalizeDocument(doc.id, doc.data(), path === 'users' ? 'uid' : 'id')), snapshot.metadata.fromCache);
  }, fail), publish);
}
export async function readCrmCollection<T>(path: CrmCollection): Promise<T[]> {
  const snapshot = await getDocsFromServer(collection(db, path));
  return snapshot.docs.map(doc => normalizeDocument(doc.id, doc.data(), path === 'users' ? 'uid' : 'id'));
}
export async function readCrmDocument<T>(path: CrmCollection, id: string): Promise<T> {
  const snapshot = await getDocFromServer(doc(db, path, id));
  if (!snapshot.exists()) throw new Error('Запись не найдена.');
  return normalizeDocument(snapshot.id, snapshot.data(), path === 'users' ? 'uid' : 'id');
}
export async function readShipmentLogs<T>(id: string): Promise<T[]> {
  const snapshot = await getDocsFromServer(collection(db, 'shipments', id, 'logs'));
  return snapshot.docs.map(doc => ({ ...normalizeDocument(doc.id, doc.data()), shipmentId: id }));
}

export async function saveCrmDocument<T>(path: CrmCollection, data: Record<string, any>, id?: string, updateOnly = false): Promise<T> {
  const ref = id ? doc(db, path, id) : doc(collection(db, path));
  const fields = Object.fromEntries(Object.entries({ ...data, [path === 'users' ? 'uid' : 'id']: ref.id }).filter(([, value]) => value !== undefined));
  if (updateOnly) await updateDoc(ref, fields);
  else await setDoc(ref, fields, { merge: true });
  return readCrmDocument<T>(path, ref.id);
}
export async function deleteCrmDocument(path: CrmCollection, id: string) {
  await deleteDoc(doc(db, path, id));
  return { success: true, id, uid: id };
}
export async function addShipmentLog<T>(shipmentId: string, data: Record<string, any>): Promise<T> {
  const ref = doc(collection(db, 'shipments', shipmentId, 'logs'));
  const fields = Object.fromEntries(Object.entries({ ...data, id: ref.id, shipmentId, timestamp: new Date().toISOString() }).filter(([, value]) => value !== undefined));
  await setDoc(ref, fields);
  return fields as T;
}
