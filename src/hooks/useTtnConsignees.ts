import { useState } from 'react';
import { useFirestoreCollection } from './useFirestoreCollection';
import { consigneesApi } from '../services/api';
import { dataLoadError } from '../services/collection-state';
import { companyKey, type TtnConsignee } from '../../shared/ttn';

/** Directory of TTN consignees, shared by the whole team. */
export const useTtnConsignees = () => {
  const { data, ...state } = useFirestoreCollection<TtnConsignee>('ttn_consignees');
  const [writeError, setWriteError] = useState<string | null>(null);
  const consignees = data.filter(entry => entry.name).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  /** Saves a new consignee, or updates the one with the same company name. Returns the saved entry. */
  const saveConsignee = async (consignee: Omit<TtnConsignee, 'id' | 'createdAt'> & { id?: string }) => {
    setWriteError(null);
    const same = consignee.id ? undefined : consignees.find(entry => companyKey(entry.name) === companyKey(consignee.name));
    try {
      return await consigneesApi.save({ ...same, ...consignee, id: consignee.id ?? same?.id, createdAt: same?.createdAt ?? new Date().toISOString() });
    } catch (error) { setWriteError(dataLoadError(error)); throw error; }
  };
  const deleteConsignee = async (id: string) => {
    setWriteError(null);
    try { await consigneesApi.delete(id); }
    catch (error) { setWriteError(dataLoadError(error)); throw error; }
  };
  return { consignees, ...state, error: writeError || state.error, retry: () => { setWriteError(null); state.retry(); }, saveConsignee, deleteConsignee };
};
