import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export function DataLoadNotice({ loading, error, onRetry }: { loading?: boolean; error?: string | null; onRetry: () => void }) {
  if (!loading && !error) return null;
  return <div role={error ? 'alert' : 'status'} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 flex items-center gap-3">
    {error ? <AlertCircle className="h-5 w-5 shrink-0" /> : <RefreshCw className="h-5 w-5 shrink-0 animate-spin" />}
    <p className="flex-1">{error || 'Загружаем данные…'}</p>
    {error && <button type="button" onClick={onRetry} className="rounded-lg border border-amber-300 px-3 py-2 font-semibold hover:bg-amber-100">Повторить</button>}
  </div>;
}
