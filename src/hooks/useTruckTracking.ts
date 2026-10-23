import { useMemo } from 'react';
import { collection, deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useFirestoreCollection } from './useFirestoreCollection';
import {
  DEFAULT_STAGES, normalizeEntry, sortStages,
  type TruckStage, type TruckTrackingEntry, type TruckTrackingImportRow, type TruckTrackingPatch,
} from '../../shared/truck-tracking';

const PATH = 'truck_tracking';
const STAGES_PATH = 'truck_tracking_stages';
const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch.
const clean = (data: Record<string, any>) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));

// Stage dates are written as field paths ("stageDates.unloaded"), so two people editing
// different dates of the same truck never overwrite each other.
const toFields = ({ stageDates, ...rest }: TruckTrackingPatch) => ({
  ...rest,
  ...Object.fromEntries(Object.entries(stageDates || {}).map(([id, date]) => [`stageDates.${id}`, date])),
});

async function commitInChunks(writes: ((batch: ReturnType<typeof writeBatch>) => void)[]) {
  for (let start = 0; start < writes.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db);
    writes.slice(start, start + BATCH_LIMIT).forEach(write => write(batch));
    await batch.commit();
  }
}

/** The team's stages. Until someone edits them, the defaults are used. */
export const useTruckTrackingStages = () => {
  const { data, ...state } = useFirestoreCollection<TruckStage>(STAGES_PATH);
  const stored = useMemo(() => sortStages(data), [data]);
  const stages = stored.length ? stored : DEFAULT_STAGES;

  /**
   * Saves the whole stage list at once. `moves` sends trucks of deleted stages to another
   * stage before the stage disappears.
   */
  const saveStages = async (next: TruckStage[], moves: Record<string, string>, entries: TruckTrackingEntry[]) => {
    const now = new Date().toISOString();
    await commitInChunks(entries
      .filter(entry => moves[entry.status])
      .map(entry => batch => batch.update(doc(db, PATH, entry.id), { status: moves[entry.status], statusChangedAt: now, updatedAt: now })));
    const keep = new Set(next.map(stage => stage.id));
    await commitInChunks([
      ...next.map((stage, order) => (batch: ReturnType<typeof writeBatch>) =>
        batch.set(doc(db, STAGES_PATH, stage.id), clean({ ...stage, order, idleDays: stage.idleDays ?? null }))),
      ...stored.filter(stage => !keep.has(stage.id)).map(stage => (batch: ReturnType<typeof writeBatch>) =>
        batch.delete(doc(db, STAGES_PATH, stage.id))),
    ]);
  };

  return { stages, ...state, saveStages };
};

// Writes go straight to Firestore: the snapshot listener shows them instantly (latency
// compensation) and every teammate with the tab open receives them in real time.
export const useTruckTracking = (stages: TruckStage[]) => {
  const { profile } = useAuth();
  const { data, ...state } = useFirestoreCollection<Record<string, any>>(PATH);
  const author = profile?.displayName || profile?.email || '';

  const entries = useMemo(() => data.map(entry => normalizeEntry(entry, stages)), [data, stages]);
  const stamp = () => ({ updatedAt: new Date().toISOString(), updatedBy: author });
  const statusStamp = (patch: TruckTrackingPatch) => patch.status ? { statusChangedAt: new Date().toISOString() } : {};

  const newDoc = (draft: Partial<TruckTrackingImportRow>) => {
    const ref = doc(collection(db, PATH));
    const now = new Date().toISOString();
    return { ref, data: clean({
      invoice: '', productName: '', stageDates: {}, status: stages[0]?.id,
      ...draft, id: ref.id, createdAt: now, createdBy: author, statusChangedAt: now, ...stamp(),
    }) };
  };

  const create = async (draft: Partial<TruckTrackingImportRow>) => {
    const { ref, data } = newDoc(draft);
    await setDoc(ref, data);
    return ref.id;
  };

  const createMany = (drafts: Partial<TruckTrackingImportRow>[]) =>
    commitInChunks(drafts.map(draft => batch => { const { ref, data } = newDoc(draft); batch.set(ref, data); }));

  const update = (id: string, patch: TruckTrackingPatch) =>
    updateDoc(doc(db, PATH, id), clean({ ...toFields(patch), ...statusStamp(patch), ...stamp() }));

  // One write per row, each with its own patch (e.g. a move that fills each row's empty date).
  const updateEach = (patches: { id: string; patch: TruckTrackingPatch }[]) =>
    commitInChunks(patches.map(({ id, patch }) => batch =>
      batch.update(doc(db, PATH, id), clean({ ...toFields(patch), ...statusStamp(patch), ...stamp() }))));

  const remove = (id: string) => deleteDoc(doc(db, PATH, id));

  const removeMany = (ids: string[]) => commitInChunks(ids.map(id => batch => batch.delete(doc(db, PATH, id))));

  // Used by "undo": puts rows back with their original ids, dates and history.
  const restore = (rows: TruckTrackingEntry[]) => commitInChunks(rows.map(row => batch => batch.set(doc(db, PATH, row.id), clean({ ...row }))));

  return { entries, ...state, create, createMany, update, updateEach, remove, removeMany, restore };
};
