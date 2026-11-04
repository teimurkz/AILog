import React from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { consigneeLine, type TtnConsignee } from '../../../shared/ttn';
import { useSectionText } from '../../i18n/useSectionText';
import { TTN_TEXT } from './ttn-i18n';

export type ConsigneeDraft = Omit<TtnConsignee, 'id' | 'createdAt'> & { id?: string };

const input = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

/** Requisites of one consignee, with the line it gives on the TTN. Used in the TTN dialog and in «Справочники». */
export const ConsigneeForm = ({ initial, onSave, onCancel }: {
  initial: ConsigneeDraft;
  onSave: (consignee: ConsigneeDraft) => Promise<unknown>;
  onCancel: () => void;
}) => {
  const { text: t } = useSectionText(TTN_TEXT);
  const [draft, setDraft] = React.useState<ConsigneeDraft>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (key: keyof ConsigneeDraft) => (event: React.ChangeEvent<HTMLInputElement>) => setDraft(current => ({ ...current, [key]: event.target.value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...draft, name: draft.name.trim(), bin: draft.bin?.trim() || '', address: draft.address?.trim() || '', unloadingPoint: draft.unloadingPoint?.trim() || '' });
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const label = 'flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400';
  return (
    <form onSubmit={save} className="space-y-2.5 rounded-xl border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_160px]">
        <label className={label}>{t.consigneeName}<input required value={draft.name} onChange={set('name')} className={input} /></label>
        <label className={label}>{t.consigneeBin}<input value={draft.bin || ''} onChange={set('bin')} inputMode="numeric" dir="ltr" className={input} /></label>
      </div>
      <label className={label}>{t.consigneeAddress}<input value={draft.address || ''} onChange={set('address')} className={input} /></label>
      <label className={label}>{t.consigneeUnloading}<input value={draft.unloadingPoint || ''} onChange={set('unloadingPoint')} className={input} /></label>
      {draft.name.trim() && (
        <p className="text-xs text-slate-500">{t.printedAs} <span className="text-slate-800 dark:text-slate-200" lang="ru">{consigneeLine(draft)}</span></p>
      )}
      <div className="flex items-center justify-end gap-2">
        {error && <span className="me-auto text-xs text-red-600">{error}</span>}
        <button type="button" onClick={onCancel} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300">
          <X className="h-3.5 w-3.5" /> {t.cancel}
        </button>
        <button type="submit" disabled={saving || !draft.name.trim()} className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t.saveConsignee}
        </button>
      </div>
    </form>
  );
};
