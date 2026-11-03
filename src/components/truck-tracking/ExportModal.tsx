import React from 'react';
import { Download, X } from 'lucide-react';
import {
  sortStages, stageDateLabel, stageLabel, trackingExportRows, trackingMonths, type TruckStage, type TruckTrackingEntry,
} from '../../../shared/truck-tracking';
import { downloadTruckTracking, downloadTruckTrackingAll } from '../../utils/truck-tracking-excel';
import { COLOR_STYLES } from './statusStyles';
import { useTrackingText } from './useTrackingText';
import { cn } from '../../lib/utils';

interface ExportModalProps {
  entries: TruckTrackingEntry[];
  stages: TruckStage[];
  onClose: () => void;
}

type Period = { kind: 'all' } | { kind: 'month'; month: string } | { kind: 'custom' };

const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
};
const chip = (active: boolean) => cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
  active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50');

/** Excel export of "Слежка авто": a period by arrival date, chosen statuses, one sheet or a sheet per status. */
export const ExportModal = ({ entries, stages, onClose }: ExportModalProps) => {
  const { text: t, language } = useTrackingText();
  const ordered = React.useMemo(() => sortStages(stages), [stages]);
  const months = React.useMemo(() => trackingMonths(entries, stages), [entries, stages]);
  // The latest month is the usual choice.
  const [period, setPeriod] = React.useState<Period>(() => months.length ? { kind: 'month', month: months[months.length - 1] } : { kind: 'all' });
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [statuses, setStatuses] = React.useState<string[]>(() => ordered.map(stage => stage.id));
  const [bySheets, setBySheets] = React.useState(false);

  const range = period.kind === 'month' ? { from: `${period.month}-01`, to: monthEnd(period.month) }
    : period.kind === 'custom' ? { from: from || undefined, to: to || undefined } : {};
  const rows = trackingExportRows(entries, stages, { ...range, statuses });
  // Gregorian months in every language: the filter works on calendar months of the arrival date.
  const monthName = (month: string) =>
    new Date(`${month}-15T00:00:00Z`).toLocaleDateString(`${t.locale}-u-ca-gregory`, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fileLabel = period.kind === 'month' ? period.month
    : period.kind === 'custom' && (from || to) ? `${from || '...'}_${to || '...'}` : '';

  const download = () => {
    (bySheets ? downloadTruckTrackingAll : downloadTruckTracking)(rows, stages, language, fileLabel);
    onClose();
  };

  return (
    <div className="crm-dialog-overlay fixed inset-0 z-50 flex items-start justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center" onMouseDown={onClose}>
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t.exportDialogTitle}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h3 className="font-semibold text-slate-900">{t.exportDialogTitle}</h3>
            <p className="mt-0.5 text-sm text-slate-500">{t.exportOrderNote}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t.close}><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t.exportPeriod} <span className="font-normal normal-case tracking-normal text-slate-400">· {t.exportByDate(ordered[0] ? stageDateLabel(ordered[0], language) : '')}</span>
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {[...months].reverse().map(month => (
                <button key={month} type="button" onClick={() => setPeriod({ kind: 'month', month })}
                  className={chip(period.kind === 'month' && period.month === month)}>{monthName(month)}</button>
              ))}
              <button type="button" onClick={() => setPeriod({ kind: 'custom' })} className={chip(period.kind === 'custom')}>{t.exportCustom}</button>
              <button type="button" onClick={() => setPeriod({ kind: 'all' })} className={chip(period.kind === 'all')}>{t.exportAllTime}</button>
            </div>
            {period.kind === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <label className="flex items-center gap-1.5">{t.exportFrom}
                  <input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5" />
                </label>
                <label className="flex items-center gap-1.5">{t.exportTo}
                  <input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5" />
                </label>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t.exportStatuses}</h4>
              <button type="button" onClick={() => setStatuses(statuses.length === ordered.length ? [] : ordered.map(stage => stage.id))}
                className="text-xs font-semibold text-blue-600 hover:underline">{statuses.length === ordered.length ? t.exportNone : t.all}</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ordered.map(stage => {
                const on = statuses.includes(stage.id);
                return (
                  <label key={stage.id} className={cn('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
                    on ? cn('border-transparent', COLOR_STYLES[stage.color].pill) : 'border-slate-200 text-slate-400')}>
                    <input type="checkbox" checked={on} className="h-3.5 w-3.5"
                      onChange={() => setStatuses(on ? statuses.filter(id => id !== stage.id) : [...statuses, stage.id])} />
                    {stageLabel(stage, language)}
                  </label>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t.exportFormat}</h4>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setBySheets(false)} className={chip(!bySheets)}>{t.exportOneSheet}</button>
              <button type="button" onClick={() => setBySheets(true)} className={chip(bySheets)}>{t.exportBySheets}</button>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-4 sm:p-5">
          <span className="text-sm text-slate-600">{t.exportCount(rows.length)}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="crm-button-secondary rounded-lg border px-3 py-2 text-xs font-semibold">{t.cancel}</button>
            <button onClick={download} disabled={!rows.length}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
              <Download className="h-3.5 w-3.5" /> {t.exportDownload}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
