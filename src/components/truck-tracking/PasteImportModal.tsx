import React from 'react';
import { ClipboardPaste, FileSpreadsheet, Loader2, X } from 'lucide-react';
import {
  defaultPasteColumns, formatTrackingDate, parseTruckTrackingPaste, stageDateLabel, stageLabel, type TruckStage, type TruckTrackingImportRow,
} from '../../../shared/truck-tracking';
import { readWorkbookAsTsv } from '../../utils/truck-tracking-excel';
import { COLOR_STYLES } from './statusStyles';
import { useTrackingText } from './useTrackingText';
import { cn } from '../../lib/utils';

interface PasteImportModalProps {
  initialText: string;
  stages: TruckStage[];
  existingInvoices: Set<string>;
  onClose: () => void;
  onImport: (rows: TruckTrackingImportRow[]) => Promise<void>;
}

export const PasteImportModal = ({ initialText, stages, existingInvoices, onClose, onImport }: PasteImportModalProps) => {
  const { text: t, language } = useTrackingText();
  const [text, setText] = React.useState(initialText);
  const [skipDuplicates, setSkipDuplicates] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [fileError, setFileError] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const parsed = React.useMemo(() => parseTruckTrackingPaste(text, stages), [text, stages]);
  const stageById = Object.fromEntries(stages.map(stage => [stage.id, stage]));
  const columns = defaultPasteColumns(stages, t, language);
  const isDuplicate = (invoice: string) => Boolean(invoice) && existingInvoices.has(invoice.trim().toLowerCase());
  const rows = skipDuplicates ? parsed.filter(row => !isDuplicate(row.invoice)) : parsed;
  const duplicates = parsed.length - parsed.filter(row => !isDuplicate(row.invoice)).length;

  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [busy, onClose]);

  const loadFile = async (file?: File) => {
    if (!file) return;
    setFileError('');
    try { setText(await readWorkbookAsTsv(file)); }
    catch { setFileError(t.fileError); }
  };

  return (
    <div className="crm-dialog-overlay fixed inset-0 z-50 flex items-start justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center" onMouseDown={() => !busy && onClose()}>
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t.importTitle}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h3 className="font-semibold text-slate-900">{t.importTitle}</h3>
            <p className="mt-0.5 text-sm text-slate-500">{t.importDescription(columns.join(', '))}</p>
          </div>
          <button onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t.close}><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} className="crm-button-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold">
              <FileSpreadsheet className="h-4 w-4" /> {t.uploadFile}
            </button>
            {fileError && <span className="text-xs text-red-600">{fileError}</span>}
          </div>
          <textarea
            autoFocus
            dir="auto"
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder={`${columns.join('\t')}\nINV-1024\t${t.sampleProduct}\t23.10.2026\t\t${stages[0] ? stageLabel(stages[0], language) : ''}`}
            className="h-36 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 outline-none focus:border-blue-400 focus:bg-white"
          />

          {parsed.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-slate-700">{t.recognized(parsed.length)}</span>
                {duplicates > 0 && (
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={skipDuplicates} onChange={event => setSkipDuplicates(event.target.checked)} className="h-4 w-4 accent-blue-600" />
                    {t.skipDuplicates(duplicates)}
                  </label>
                )}
              </div>
              <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-start text-slate-500">
                    <tr>
                      {[t.invoice, t.productName, ...stages.map(stage => stageDateLabel(stage, language)), t.status].map((title, index) =>
                        <th key={index} className="px-3 py-2 text-start font-semibold">{title}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsed.slice(0, 100).map((row, index) => (
                      <tr key={index} className={cn(skipDuplicates && isDuplicate(row.invoice) && 'opacity-40 line-through')}>
                        <td className="px-3 py-1.5 font-semibold text-slate-800">{row.invoice || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-700">{row.productName || '—'}</td>
                        {stages.map(stage => <td key={stage.id} className="px-3 py-1.5" dir="ltr">{formatTrackingDate(row.stageDates[stage.id]) || '—'}</td>)}
                        <td className="px-3 py-1.5">
                          <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 font-semibold', COLOR_STYLES[stageById[row.status]?.color ?? 'slate'].pill)}>
                            {stageById[row.status] ? stageLabel(stageById[row.status], language) : ''}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.length > 100 && <p className="text-xs text-slate-500">{t.first100}</p>}
            </div>
          )}
          {text.trim() && !parsed.length && <p className="text-sm text-amber-700">{t.notRecognized}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4 sm:p-5">
          <button onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">{t.cancel}</button>
          <button
            disabled={!rows.length || busy}
            onClick={async () => { setBusy(true); try { await onImport(rows); } finally { setBusy(false); } }}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPaste className="h-4 w-4" />}
            {t.addToTable(rows.length)}
          </button>
        </div>
      </div>
    </div>
  );
};
