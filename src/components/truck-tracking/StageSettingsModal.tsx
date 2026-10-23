import React from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, X } from 'lucide-react';
import { STAGE_COLORS, newStageId, type StageColor, type TruckStage } from '../../../shared/truck-tracking';
import { COLOR_STYLES } from './statusStyles';
import { cn } from '../../lib/utils';

interface StageSettingsModalProps {
  stages: TruckStage[];
  counts: Record<string, number>;
  startWithNew?: boolean;
  onClose: () => void;
  onSave: (stages: TruckStage[], moves: Record<string, string>) => Promise<void>;
}

const unusedColor = (stages: TruckStage[]): StageColor =>
  STAGE_COLORS.find(color => !stages.some(stage => stage.color === color)) ?? 'slate';

const blankStage = (stages: TruckStage[]): TruckStage =>
  ({ id: newStageId(), label: '', dateLabel: '', color: unusedColor(stages), order: stages.length, idleDays: null });

/** Stages become tabs, board columns and date columns, in this order. */
export const StageSettingsModal = ({ stages, counts, startWithNew, onClose, onSave }: StageSettingsModalProps) => {
  const [draft, setDraft] = React.useState<TruckStage[]>(() => startWithNew ? [...stages, blankStage(stages)] : stages);
  const [moves, setMoves] = React.useState<Record<string, string>>({});
  const [deleting, setDeleting] = React.useState<{ id: string; target: string } | null>(null);
  const [colorFor, setColorFor] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const lastLabelRef = React.useRef<HTMLInputElement>(null);
  const focusLast = React.useRef(Boolean(startWithNew));

  React.useEffect(() => {
    if (focusLast.current) { lastLabelRef.current?.focus(); focusLast.current = false; }
  });

  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [busy, onClose]);

  // Trucks waiting in a stage: its own plus those moved into it from stages deleted in this dialog.
  const trucksIn = (id: string) => (counts[id] || 0) + Object.entries(moves)
    .filter(([, to]) => to === id).reduce((sum, [from]) => sum + trucksIn(from), 0);

  const patch = (id: string, changes: Partial<TruckStage>) =>
    setDraft(current => current.map(stage => stage.id === id ? { ...stage, ...changes } : stage));
  const shift = (index: number, by: number) => setDraft(current => {
    const next = [...current];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    return next;
  });
  const add = () => { focusLast.current = true; setDraft(current => [...current, blankStage(current)]); };

  const askDelete = (id: string) => {
    const others = draft.filter(stage => stage.id !== id);
    if (!others.length) { setError('Должен остаться хотя бы один этап.'); return; }
    if (trucksIn(id)) setDeleting({ id, target: others[0].id });
    else remove(id);
  };
  const remove = (id: string, target?: string) => {
    setDraft(current => current.filter(stage => stage.id !== id));
    setMoves(current => {
      // Trucks already headed to this stage follow its trucks to the new target.
      const next = Object.fromEntries(Object.entries(current).map(([from, to]) => [from, to === id && target ? target : to]));
      if (target) next[id] = target;
      return next;
    });
    setDeleting(null);
    setError('');
  };

  const save = async () => {
    const cleaned = draft.map((stage, order) => ({
      ...stage, order, label: stage.label.trim(), dateLabel: stage.dateLabel.trim() || `Дата: ${stage.label.trim()}`,
    }));
    if (cleaned.some(stage => !stage.label)) { setError('Укажите название у каждой вкладки.'); return; }
    setBusy(true);
    setError('');
    try { await onSave(cleaned, moves); onClose(); }
    catch { setError('Не удалось сохранить. Проверьте подключение и права (роль «логистика» или «админ»).'); }
    finally { setBusy(false); }
  };

  return (
    <div className="crm-dialog-overlay fixed inset-0 z-50 flex items-start justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center" onMouseDown={() => !busy && onClose()}>
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Настройка этапов">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h3 className="font-semibold text-slate-900">Этапы (вкладки)</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Каждый этап — это вкладка, колонка на доске и свой столбец с датой. Порядок важен: дата более позднего этапа переводит фуру дальше.
              Настройки общие для всей команды.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-4 sm:p-5">
          <div className="hidden grid-cols-[64px_28px_1fr_1fr_96px_36px] gap-2 px-1 text-[11px] font-semibold uppercase text-slate-400 sm:grid">
            <span>Порядок</span><span /><span>Название вкладки</span><span>Столбец с датой</span><span>Простой, дн.</span><span />
          </div>
          {draft.map((stage, index) => (
            <div key={stage.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
              <div className="grid grid-cols-[64px_28px_1fr_36px] items-center gap-2 sm:grid-cols-[64px_28px_1fr_1fr_96px_36px]">
                <div className="flex gap-0.5">
                  <button onClick={() => shift(index, -1)} disabled={index === 0} className="rounded-md p-1.5 text-slate-500 hover:bg-white disabled:opacity-30" aria-label="Выше"><ArrowUp className="h-4 w-4" /></button>
                  <button onClick={() => shift(index, 1)} disabled={index === draft.length - 1} className="rounded-md p-1.5 text-slate-500 hover:bg-white disabled:opacity-30" aria-label="Ниже"><ArrowDown className="h-4 w-4" /></button>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setColorFor(colorFor === stage.id ? null : stage.id)}
                    className={cn('h-6 w-6 rounded-full ring-2 ring-white ring-offset-1 ring-offset-slate-300', COLOR_STYLES[stage.color].dot)}
                    aria-label={`Цвет: ${COLOR_STYLES[stage.color].name}`}
                    title="Сменить цвет"
                  />
                  {colorFor === stage.id && (
                    <div className="absolute left-0 top-8 z-10 grid w-max grid-cols-4 gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                      {STAGE_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => { patch(stage.id, { color }); setColorFor(null); }}
                          className={cn('h-6 w-6 rounded-full', COLOR_STYLES[color].dot, stage.color === color && 'ring-2 ring-slate-900 ring-offset-1')}
                          aria-label={COLOR_STYLES[color].name}
                          title={COLOR_STYLES[color].name}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <input
                  ref={index === draft.length - 1 ? lastLabelRef : undefined}
                  value={stage.label}
                  onChange={event => patch(stage.id, { label: event.target.value })}
                  placeholder="Например: На таможенном оформлении"
                  aria-label="Название вкладки"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
                />
                <input
                  value={stage.dateLabel}
                  onChange={event => patch(stage.id, { dateLabel: event.target.value })}
                  placeholder={stage.label ? `Дата: ${stage.label}` : 'Например: Оформлено'}
                  aria-label="Столбец с датой"
                  className="col-span-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 sm:col-span-1"
                />
                <input
                  type="number"
                  min={0}
                  value={stage.idleDays ?? ''}
                  onChange={event => patch(stage.id, { idleDays: event.target.value === '' ? null : Math.max(0, Math.round(+event.target.value)) })}
                  placeholder="—"
                  aria-label="Простой, дней"
                  title="Через сколько дней в этом этапе фура считается простаивающей. Пусто — не следить."
                  className="col-span-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 sm:col-span-1"
                />
                <button onClick={() => askDelete(stage.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Удалить этап ${stage.label}`} title="Удалить этап">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {deleting?.id === stage.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  <span>В этой вкладке фур: {trucksIn(stage.id)}. Перенести их в</span>
                  <select
                    value={deleting.target}
                    onChange={event => setDeleting({ id: stage.id, target: event.target.value })}
                    className="rounded-md border border-red-200 bg-white px-2 py-1 text-sm text-slate-800"
                  >
                    {draft.filter(other => other.id !== stage.id).map(other => <option key={other.id} value={other.id}>{other.label || 'Без названия'}</option>)}
                  </select>
                  <button onClick={() => remove(stage.id, deleting.target)} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700">Удалить этап</button>
                  <button onClick={() => setDeleting(null)} className="rounded-md px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">Отмена</button>
                </div>
              )}
            </div>
          ))}
          <button onClick={add} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700">
            <Plus className="h-4 w-4" /> Добавить этап
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 p-4 sm:p-5">
          {error && <span className="mr-auto text-sm text-red-600">{error}</span>}
          <button onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Отмена</button>
          <button onClick={() => void save()} disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить
          </button>
        </div>
      </div>
    </div>
  );
};
