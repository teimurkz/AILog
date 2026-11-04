import React from 'react';
import { Building2, Edit3, Plus, Trash2 } from 'lucide-react';
import { consigneeLine } from '../../../shared/ttn';
import { useTtnConsignees } from '../../hooks/useTtnConsignees';
import { useSectionText } from '../../i18n/useSectionText';
import { TTN_TEXT } from '../regional/ttn-i18n';
import { ConsigneeForm, type ConsigneeDraft } from '../regional/ConsigneeForm';
import { DataLoadNotice } from '../common/DataLoadNotice';

const EMPTY: ConsigneeDraft = { name: '', bin: '', address: '', unloadingPoint: '' };

/** «Справочники» tab: consignees with the requisites the TTN prints. */
export const ConsigneesDirectory = ({ searchQuery }: { searchQuery: string }) => {
  const { text: t } = useSectionText(TTN_TEXT);
  const { consignees, loading, error, retry, saveConsignee, deleteConsignee } = useTtnConsignees();
  /** null: closed; 'new': adding; an id: editing that entry. */
  const [editing, setEditing] = React.useState<string | null>(null);
  const query = searchQuery.trim().toLowerCase();
  const shown = consignees.filter(entry => !query || [entry.name, entry.bin, entry.address, entry.unloadingPoint]
    .some(value => value?.toLowerCase().includes(query)));

  return (
    <div className="space-y-4">
      <DataLoadNotice loading={loading} error={error} onRetry={retry} />
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Building2 className="h-4 w-4 text-blue-600" /> {t.directoryTitle}</h3>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">{t.directoryIntro}</p>
        </div>
        {editing !== 'new' && (
          <button onClick={() => setEditing('new')}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500">
            <Plus className="h-4 w-4" /> {t.addConsignee}
          </button>
        )}
      </div>

      {editing === 'new' && (
        <ConsigneeForm initial={EMPTY} onCancel={() => setEditing(null)} onSave={async draft => { await saveConsignee(draft); setEditing(null); }} />
      )}

      {!shown.length && !loading && editing !== 'new' && (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-600">{t.directoryEmpty}</p>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {shown.map(entry => editing === entry.id ? (
          <ConsigneeForm key={entry.id} initial={entry} onCancel={() => setEditing(null)}
            onSave={async draft => { await saveConsignee({ ...draft, id: entry.id }); setEditing(null); }} />
        ) : (
          <div key={entry.id} className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{entry.name}</h4>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => setEditing(entry.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-700"
                  title={t.editConsignee} aria-label={t.editConsignee}><Edit3 className="h-3.5 w-3.5" /></button>
                <button onClick={() => { if (window.confirm(t.confirmDeleteConsignee(entry.name))) void deleteConsignee(entry.id); }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500" title={t.deleteConsignee} aria-label={t.deleteConsignee}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {entry.bin && <p className="text-xs text-slate-500">{t.consigneeBin}: <span className="font-mono text-slate-700 dark:text-slate-300">{entry.bin}</span></p>}
            {entry.address && <p className="text-xs text-slate-500">{t.consigneeAddress}: <span className="text-slate-700 dark:text-slate-300">{entry.address}</span></p>}
            {entry.unloadingPoint && <p className="text-xs text-slate-500">{t.consigneeUnloading}: <span className="text-slate-700 dark:text-slate-300">{entry.unloadingPoint}</span></p>}
            <p className="border-t border-slate-100 pt-1.5 text-[11px] text-slate-400 dark:border-slate-700">{t.printedAs} <span lang="ru">{consigneeLine(entry)}</span></p>
          </div>
        ))}
      </div>
    </div>
  );
};
