import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { pickTexts } from '../../../shared/i18n';
import { useOptionalLanguage } from '../../contexts/LanguageContext';
import { COMMON_TEXTS, translateMessage } from '../../i18n/common-i18n';

export function DataLoadNotice({ loading, error, onRetry }: { loading?: boolean; error?: string | null; onRetry: () => void }) {
  // Russian when rendered outside the CRM's LanguageProvider.
  const language = useOptionalLanguage()?.language ?? 'ru';
  if (!loading && !error) return null;
  const text = pickTexts(COMMON_TEXTS, language).notice;
  return <div role={error ? 'alert' : 'status'} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 flex items-center gap-3">
    {error ? <AlertCircle className="h-5 w-5 shrink-0" /> : <RefreshCw className="h-5 w-5 shrink-0 animate-spin" />}
    <p className="flex-1">{error ? translateMessage(error, language) : text.loading}</p>
    {error && <button type="button" onClick={onRetry} className="rounded-lg border border-amber-300 px-3 py-2 font-semibold hover:bg-amber-100">{text.retry}</button>}
  </div>;
}
