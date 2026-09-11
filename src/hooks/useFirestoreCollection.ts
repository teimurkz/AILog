import { useCallback, useEffect, useState } from 'react';
import { subscribeToCrmCollection, type CrmCollection } from '../services/firestore-collections';
import type { CollectionState } from '../services/collection-state';

export function useFirestoreCollection<T>(path: CrmCollection) {
  const [state, setState] = useState<CollectionState<T>>({ data: [], loading: true, error: null, confirmed: false });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const stop = subscribeToCrmCollection<T>(path, next => setState(previous =>
      !next.confirmed && !next.data.length && previous.data.length ? { ...next, data: previous.data } : next));
    window.addEventListener('online', retry);
    return () => { stop(); window.removeEventListener('online', retry); };
  }, [path, revision, retry]);
  return { ...state, retry };
}
