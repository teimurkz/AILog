export interface CollectionState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  confirmed: boolean;
}

export function dataLoadError(error: unknown): string {
  const code = String((error as { code?: string })?.code || '');
  if (code.includes('permission-denied')) return 'Нет доступа к данным. Проверьте, что вы вошли под рабочей учётной записью.';
  if (code.includes('unauthenticated')) return 'Сеанс входа завершён. Войдите в CRM повторно.';
  return 'Не удалось загрузить данные. Проверьте подключение и повторите попытку.';
}

export function normalizeDocument(id: string, data: Record<string, any>, idField = 'id'): any {
  const normalize = (value: any): any => {
    if (value?.toDate instanceof Function) return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  return { ...normalize(data), [idField]: id };
}

// An empty local cache is not evidence that a Firebase collection is empty.
export function watchCollection<T>(
  listen: (next: (data: T[], fromCache: boolean) => void, fail: (error: unknown) => void) => () => void,
  publish: (state: CollectionState<T>) => void,
  timeoutMs = 15000,
) {
  let stopped = false;
  let state: CollectionState<T> = { data: [], loading: true, error: null, confirmed: false };
  const emit = (patch: Partial<CollectionState<T>>) => {
    if (!stopped) { state = { ...state, ...patch }; publish(state); }
  };
  emit({});
  const timer = setTimeout(() => emit({ loading: false, error: dataLoadError(null) }), timeoutMs);
  let stop = () => {};
  const fail = (error: unknown) => {
    clearTimeout(timer);
    emit({ loading: false, error: dataLoadError(error) });
  };
  try { stop = listen((data, fromCache) => {
    if (stopped) return;
    if (fromCache) {
      if (data.length || state.data.length || state.confirmed) emit({
        ...(data.length ? { data } : {}), loading: false, confirmed: false,
        error: 'Показаны последние загруженные данные. Ожидаем подтверждение соединения.'
      });
      return;
    }
    clearTimeout(timer);
    emit({ data, loading: false, error: null, confirmed: true });
  }, fail); } catch (error) { fail(error); }
  return () => { stopped = true; clearTimeout(timer); stop(); };
}
