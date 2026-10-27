import React from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, ClipboardPaste, Columns3, Download, FileSpreadsheet, GripVertical, Loader2, Plus, Search, Settings2, Table2, Trash2, X,
} from 'lucide-react';
import {
  daysInStage, formatTrackingDate, isTruckIdle, stageDate, stagePatch, statusAfterDateEdit, todayIso,
  type TruckStage, type TruckTrackingEntry, type TruckTrackingImportRow, type TruckTrackingPatch,
} from '../../../shared/truck-tracking';
import { useTruckTracking, useTruckTrackingStages } from '../../hooks/useTruckTracking';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { downloadTruckTracking, downloadTruckTrackingAll } from '../../utils/truck-tracking-excel';
import { DataLoadNotice } from '../common/DataLoadNotice';
import { EditableCell, type CellMove } from './EditableCell';
import { PasteImportModal } from './PasteImportModal';
import { StageSettingsModal } from './StageSettingsModal';
import { COLOR_STYLES } from './statusStyles';
import { cn } from '../../lib/utils';

// Editable columns: fixed text fields plus one date column per stage ("date:<stageId>").
type Field = 'invoice' | 'productName' | 'comment' | `date:${string}`;
type SortKey = Field | 'status';
const TEXT_LABELS: Record<string, string> = { invoice: 'Инвойс', productName: 'Наименование продукта', comment: 'Комментарий' };
const PREFS_KEY = 'truck-tracking-prefs';

const isDateField = (field: string): field is `date:${string}` => field.startsWith('date:');
const fieldValue = (entry: TruckTrackingEntry, field: Field) =>
  isDateField(field) ? stageDate(entry, field.slice(5)) : (entry[field as 'invoice'] || '');
const truckName = (entry: Pick<TruckTrackingEntry, 'invoice' | 'productName'>) => entry.invoice || entry.productName || 'без инвойса';

const readPrefs = (): { tab?: string; view?: 'table' | 'board' } => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
};

const StageHint = ({ entry, stages }: { entry: TruckTrackingEntry; stages: TruckStage[] }) => {
  const days = daysInStage(entry, stages);
  if (days === null || days < 0 || entry.status === stages[stages.length - 1]?.id) return null;
  const text = days === 0 ? 'с сегодня' : `${days} дн. на этапе`;
  return isTruckIdle(entry, stages)
    ? <span className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">{text}</span>
    : <span className="whitespace-nowrap text-[10px] font-medium text-slate-500">{text}</span>;
};

const StatusSelect = ({ value, stages, disabled, onChange, className }: {
  value: string; stages: TruckStage[]; disabled?: boolean; onChange: (status: string) => void; className?: string;
}) => {
  const color = COLOR_STYLES[stages.find(stage => stage.id === value)?.color ?? 'slate'];
  return (
    <div className={cn('relative inline-flex max-w-full items-center rounded-full text-xs font-semibold', color.pill, className)}>
      <span className={cn('pointer-events-none absolute left-2.5 h-1.5 w-1.5 rounded-full', color.dot)} />
      <select
        value={value}
        disabled={disabled}
        aria-label="Статус"
        onChange={event => onChange(event.target.value)}
        onClick={event => event.stopPropagation()}
        className="max-w-full cursor-pointer appearance-none truncate rounded-full bg-transparent py-1 pl-6 pr-3 outline-none disabled:cursor-default"
      >
        {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
      </select>
    </div>
  );
};

const DEPLOY_RULES_COMMAND = '(test -d AILog || git clone https://github.com/teimurkz/AILog.git) && cd AILog && git pull --ff-only origin main && npx -y firebase-tools deploy --only firestore:rules --project logisticsapp-216d5';

const RulesNotice = ({ onRetry }: { onRetry: () => void }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <div role="alert" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-1">
          <p className="font-semibold">Вкладке нужен доступ к своим данным в Firestore</p>
          <p>
            Правила доступа для «Слежки авто» ещё не опубликованы. Это делается один раз: администратор открывает
            Google Cloud Shell под рабочим аккаунтом и выполняет команду:
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-800 ring-1 ring-amber-200">{DEPLOY_RULES_COMMAND}</code>
        <button
          type="button"
          onClick={() => { void navigator.clipboard?.writeText(DEPLOY_RULES_COMMAND).then(() => setCopied(true)).catch(() => {}); }}
          className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-amber-100"
        >
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-amber-800">Подробности — в файле TRUCK-TRACKING.md в репозитории.</p>
        <button type="button" onClick={onRetry} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold hover:bg-amber-100">Повторить</button>
      </div>
    </div>
  );
};

export const TruckTracking = () => {
  const { isLogistics } = useAuth();
  const { showToast, showError, showInfo } = useToast();
  const { stages, loading: stagesLoading, saveStages } = useTruckTrackingStages();
  const { entries, loading, error, confirmed, retry, create, createMany, update, updateEach, removeMany, restore } = useTruckTracking(stages);
  const canEdit = isLogistics;

  const [tab, setTab] = React.useState<string>(() => readPrefs().tab || 'all');
  const [view, setView] = React.useState<'table' | 'board'>(() => readPrefs().view === 'board' ? 'board' : 'table');
  const [search, setSearch] = React.useState('');
  const [idleOnly, setIdleOnly] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>(() => ({ key: `date:${stages[0]?.id}`, dir: 1 }));
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<{ id: string; field: Field } | null>(null);
  const [quick, setQuick] = React.useState({ invoice: '', productName: '', date: todayIso() });
  const [adding, setAdding] = React.useState(false);
  const [pasteText, setPasteText] = React.useState<string | null>(null);
  const [stageDialog, setStageDialog] = React.useState<null | 'edit' | 'new'>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; label: string } | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const dragged = React.useRef<string[]>([]);
  const quickInvoiceRef = React.useRef<HTMLInputElement>(null);

  const stageById = React.useMemo(() => Object.fromEntries(stages.map(stage => [stage.id, stage])), [stages]);
  const fields: Field[] = React.useMemo(() => ['invoice', 'productName', ...stages.map(stage => `date:${stage.id}` as Field), 'comment'], [stages]);
  const label = (field: Field) => isDateField(field) ? stageById[field.slice(5)]?.dateLabel ?? '' : TEXT_LABELS[field];
  const activeTab = tab === 'all' || stageById[tab] ? tab : 'all'; // the saved tab may have been deleted

  React.useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ tab, view })); } catch { /* preferences are optional */ }
  }, [tab, view]);

  // Ctrl+V anywhere on the tab with cells copied from Excel opens the import preview.
  React.useEffect(() => {
    if (!canEdit) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const text = event.clipboardData?.getData('text/plain') || '';
      if (text.includes('\t')) { event.preventDefault(); setPasteText(text); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [canEdit]);

  const counts = React.useMemo(() => {
    const result: Record<string, number> = Object.fromEntries(stages.map(stage => [stage.id, 0]));
    entries.forEach(entry => { result[entry.status] = (result[entry.status] || 0) + 1; });
    return result;
  }, [entries, stages]);
  const idleCount = entries.filter(entry => isTruckIdle(entry, stages)).length;

  const searched = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter(entry => (!idleOnly || isTruckIdle(entry, stages)) && (!query ||
      [entry.invoice, entry.productName, entry.comment, ...stages.map(stage => formatTrackingDate(stageDate(entry, stage.id)))]
        .some(value => value?.toLowerCase().includes(query))));
  }, [entries, search, idleOnly, stages]);

  const sorted = React.useMemo(() => [...searched].sort((a, b) => {
    const value = (entry: TruckTrackingEntry) => sort.key === 'status'
      ? String(stages.findIndex(stage => stage.id === entry.status)).padStart(3, '0') : fieldValue(entry, sort.key);
    const [left, right] = [value(a), value(b)];
    if (!left && right) return 1;   // empty values always go last
    if (left && !right) return -1;
    return left.localeCompare(right, 'ru', { numeric: true }) * sort.dir || (b.createdAt || '').localeCompare(a.createdAt || '');
  }), [searched, sort, stages]);

  const visible = activeTab === 'all' ? sorted : sorted.filter(entry => entry.status === activeTab);
  const visibleIds = visible.map(entry => entry.id);
  const allSelected = visible.length > 0 && visibleIds.every(id => selected.has(id));
  const existingInvoices = React.useMemo(() => new Set(entries.map(entry => entry.invoice.trim().toLowerCase()).filter(Boolean)), [entries]);

  // Drop selections that disappeared (deleted by a teammate).
  React.useEffect(() => {
    setSelected(previous => {
      const ids = new Set(entries.map(entry => entry.id));
      const next = new Set([...previous].filter(id => ids.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [entries]);

  const failed = () => showError('Изменения не сохранены. Проверьте подключение и права доступа (нужна роль «логистика» или «админ»).');

  const moveTo = async (ids: string[], status: string) => {
    const rows = entries.filter(entry => ids.includes(entry.id) && entry.status !== status);
    if (!rows.length) return;
    try {
      await updateEach(rows.map(row => ({ id: row.id, patch: stagePatch(row, status) })));
      setSelected(new Set());
      showToast({
        type: 'success',
        message: rows.length === 1 ? `Фура «${truckName(rows[0])}» → ${stageById[status]?.label}` : `${rows.length} фур → ${stageById[status]?.label}`,
        onUndo: () => { void restore(rows).catch(failed); },
      });
    } catch { failed(); }
  };

  const removeRows = async (ids: string[]) => {
    const rows = entries.filter(entry => ids.includes(entry.id));
    if (!rows.length) return;
    try {
      await removeMany(rows.map(row => row.id));
      setSelected(new Set());
      showToast({
        type: 'success', duration: 7000,
        message: rows.length === 1 ? `Фура «${truckName(rows[0])}» удалена` : `Удалено фур: ${rows.length}`,
        onUndo: () => { void restore(rows).catch(failed); },
      });
    } catch { failed(); }
  };

  const nextCell = (id: string, field: Field, move: CellMove, ids: string[]) => {
    const position = ids.indexOf(id) * fields.length + fields.indexOf(field) + (move === 'next' ? 1 : -1);
    if (position < 0 || position >= ids.length * fields.length) return null;
    return { id: ids[Math.floor(position / fields.length)], field: fields[position % fields.length] };
  };

  const commit = async (entry: TruckTrackingEntry, field: Field, value: string, move: CellMove | undefined, ids: string[]) => {
    setEditing(move ? nextCell(entry.id, field, move, ids) : null);
    if (fieldValue(entry, field) === value) return;
    let patch: TruckTrackingPatch;
    let autoStatus: string | null = null;
    if (isDateField(field)) {
      const stageId = field.slice(5);
      autoStatus = statusAfterDateEdit(entry, stages, stageId, value);
      patch = { stageDates: { [stageId]: value }, ...(autoStatus ? { status: autoStatus } : {}) };
    } else {
      patch = { [field]: value };
    }
    try {
      await update(entry.id, patch);
      if (autoStatus) showInfo(`Фура «${truckName(entry)}» перемещена во вкладку «${stageById[autoStatus]?.label}»`);
    } catch { failed(); }
  };

  const addQuick = async () => {
    if (!quick.invoice.trim() && !quick.productName.trim()) { quickInvoiceRef.current?.focus(); return; }
    setAdding(true);
    try {
      await create({
        invoice: quick.invoice.trim(), productName: quick.productName.trim(),
        stageDates: quick.date ? { [stages[0].id]: quick.date } : {}, status: stages[0].id,
      });
      setQuick({ invoice: '', productName: '', date: todayIso() });
      quickInvoiceRef.current?.focus();
    } catch { failed(); }
    finally { setAdding(false); }
  };

  const importRows = async (rows: TruckTrackingImportRow[]) => {
    try {
      await createMany(rows.map(row => ({ ...row, comment: row.comment || undefined })));
      setPasteText(null);
      showToast({ type: 'success', message: `Добавлено фур: ${rows.length}` });
    } catch { failed(); }
  };

  const renameStage = async () => {
    if (!renaming) return;
    const name = renaming.label.trim();
    setRenaming(null);
    if (!name || name === stageById[renaming.id]?.label) return;
    try { await saveStages(stages.map(stage => stage.id === renaming.id ? { ...stage, label: name } : stage), {}, entries); }
    catch { failed(); }
  };

  const startDrag = (event: React.DragEvent, id: string) => {
    dragged.current = selected.has(id) ? [...selected] : [id];
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged.current.join(','));
  };
  const dropProps = (status: string) => canEdit ? {
    onDragOver: (event: React.DragEvent) => { if (dragged.current.length) { event.preventDefault(); setDropTarget(status); } },
    onDragLeave: () => setDropTarget(current => current === status ? null : current),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setDropTarget(null);
      const ids = dragged.current;
      dragged.current = [];
      void moveTo(ids, status);
    },
  } : {};
  const endDrag = () => { dragged.current = []; setDropTarget(null); };

  const toggleSort = (key: SortKey) => setSort(current => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }));
  const toggle = (id: string) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const cell = (entry: TruckTrackingEntry, field: Field, ids: string[], extra?: Partial<React.ComponentProps<typeof EditableCell>>) => (
    <EditableCell
      value={fieldValue(entry, field)}
      type={isDateField(field) ? 'date' : 'text'}
      label={label(field)}
      display={isDateField(field) ? formatTrackingDate(fieldValue(entry, field)) : undefined}
      editing={editing?.id === entry.id && editing.field === field}
      disabled={!canEdit}
      onStart={() => setEditing({ id: entry.id, field })}
      onCancel={() => setEditing(null)}
      onCommit={(value, move) => void commit(entry, field, value, move, ids)}
      className={isDateField(field) ? 'whitespace-nowrap' : undefined}
      {...extra}
    />
  );

  // Every signed-in user may read these collections, so "no access" means the rules
  // from firestore.rules have not been published yet (see TRUCK-TRACKING.md).
  if (!entries.length && error?.startsWith('Нет доступа')) {
    return <RulesNotice onRetry={retry} />;
  }

  if (stagesLoading || (!entries.length && (loading || (error && !confirmed)))) {
    return <DataLoadNotice loading={loading || stagesLoading} error={error} onRetry={retry} />;
  }

  const sortHeader = (title: string, sortKey: SortKey, className?: string) => (
    <th key={sortKey} className={cn('px-2 py-2.5 font-semibold', className)}>
      <button onClick={() => toggleSort(sortKey)} className="inline-flex items-center gap-1 rounded px-1 text-left hover:text-slate-900">
        {title}
        {sort.key === sortKey && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  const stageTab = (stage: TruckStage) => {
    const active = activeTab === stage.id;
    if (renaming?.id === stage.id) {
      return (
        <input
          key={stage.id}
          autoFocus
          value={renaming.label}
          onChange={event => setRenaming({ id: stage.id, label: event.target.value })}
          onBlur={() => void renameStage()}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); void renameStage(); }
            if (event.key === 'Escape') setRenaming(null);
          }}
          aria-label="Название вкладки"
          className="my-1.5 w-48 shrink-0 rounded-md border border-blue-400 px-2 py-1 text-sm outline-none"
        />
      );
    }
    return (
      <button
        key={stage.id}
        {...dropProps(stage.id)}
        onClick={() => { setTab(stage.id); setSelected(new Set()); }}
        onDoubleClick={() => canEdit && setRenaming({ id: stage.id, label: stage.label })}
        title={canEdit ? 'Двойной клик — переименовать. Перетащите сюда фуры, чтобы сменить этап.' : undefined}
        className={cn(
          'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
          active ? COLOR_STYLES[stage.color].tab : 'border-transparent text-slate-500 hover:text-slate-800',
          dropTarget === stage.id && 'rounded-t-lg bg-blue-50 text-blue-700',
        )}
      >
        <span className={cn('h-2 w-2 rounded-full', COLOR_STYLES[stage.color].dot)} />
        {stage.label}
        <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}>{counts[stage.id] || 0}</span>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Stage overview: each card is also a drop target */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))' }}>
        {stages.map(stage => (
          <button
            key={stage.id}
            {...dropProps(stage.id)}
            onClick={() => { setTab(stage.id); setView('table'); }}
            className={cn(
              'rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-2xs transition-all hover:border-slate-300',
              activeTab === stage.id && view === 'table' && 'ring-2 ring-blue-500/30 border-blue-300',
              dropTarget === stage.id && 'scale-[1.02] border-blue-400 bg-blue-50 ring-2 ring-blue-400',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">{stage.label}</span>
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', COLOR_STYLES[stage.color].dot)} />
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{counts[stage.id] || 0}</div>
          </button>
        ))}
        <button
          onClick={() => setIdleOnly(value => !value)}
          title="Фуры, которые находятся в этапе дольше заданного в настройках этапов числа дней"
          className={cn('rounded-xl border bg-white p-3.5 text-left shadow-2xs transition-all',
            idleOnly ? 'border-red-300 ring-2 ring-red-400/30' : 'border-slate-200 hover:border-slate-300')}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Простаивают</span>
            <AlertTriangle className={cn('h-4 w-4', idleCount ? 'text-red-500' : 'text-slate-300')} />
          </div>
          <div className={cn('mt-1 text-2xl font-semibold', idleCount ? 'text-red-600' : 'text-slate-900')}>{idleCount}</div>
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Поиск по инвойсу, продукту, дате..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-8 text-sm outline-none focus:border-blue-400 focus:bg-white"
            />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Очистить поиск"><X className="h-4 w-4" /></button>}
          </div>
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {([['table', Table2, 'Таблица'], ['board', Columns3, 'Доска']] as const).map(([id, Icon, title]) => (
              <button key={id} onClick={() => setView(id)} className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold', view === id ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800')}>
                <Icon className="h-3.5 w-3.5" /> {title}
              </button>
            ))}
          </div>
          {canEdit && (
            <button onClick={() => setStageDialog('edit')} className="crm-button-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold" title="Добавить, переименовать, удалить или переставить этапы">
              <Settings2 className="h-3.5 w-3.5" /> Этапы
            </button>
          )}
          {canEdit && (
            <button onClick={() => setPasteText('')} className="crm-button-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold" title="Или просто нажмите Ctrl+V с ячейками из Excel">
              <ClipboardPaste className="h-3.5 w-3.5" /> Из Excel
            </button>
          )}
          <button
            onClick={() => downloadTruckTracking(view === 'table' ? visible : sorted, stages)}
            disabled={!entries.length}
            title="Только то, что сейчас на экране: текущая вкладка с учётом поиска и фильтров"
            className="crm-button-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5" /> Экспорт
          </button>
          <button
            onClick={() => downloadTruckTrackingAll(entries, stages)}
            disabled={!entries.length}
            title="Все фуры всех статусов одним файлом: сводка, лист «Все фуры» и отдельный лист на каждый статус"
            className="crm-button-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Экспорт всё
          </button>
          {canEdit && (
            <button onClick={() => { setView('table'); requestAnimationFrame(() => quickInvoiceRef.current?.focus()); }} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
              <Plus className="h-3.5 w-3.5" /> Добавить фуру
            </button>
          )}
        </div>

        {!canEdit && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Режим просмотра. Редактировать могут пользователи с ролью «логистика» или «админ».
          </div>
        )}
        {error && entries.length > 0 && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{error}</div>}

        {view === 'table' ? (
          <>
            {/* Stage mini-tabs: click to filter, drop rows to move them, double-click to rename */}
            <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-2">
              <button
                onClick={() => { setTab('all'); setSelected(new Set()); }}
                className={cn('flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  activeTab === 'all' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800')}
              >
                Все
                <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', activeTab === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}>{entries.length}</span>
              </button>
              {stages.map(stageTab)}
              {canEdit && (
                <button onClick={() => setStageDialog('new')} className="ml-1 shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="Добавить этап" aria-label="Добавить этап">
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>

            {selected.size > 0 && canEdit && (
              <div className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                <span className="font-semibold text-blue-900">Выбрано: {selected.size}</span>
                <span className="text-blue-800">Переместить в</span>
                {stages.map(stage => (
                  <button key={stage.id} onClick={() => void moveTo([...selected], stage.id)} className={cn('rounded-full px-2.5 py-1 text-xs font-semibold hover:brightness-95', COLOR_STYLES[stage.color].pill)}>
                    {stage.label}
                  </button>
                ))}
                <span className="flex-1" />
                <button onClick={() => void removeRows([...selected])} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"><Trash2 className="h-3.5 w-3.5" /> Удалить</button>
                <button onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-white">Снять выбор</button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 760 + stages.length * 150 }}>
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="w-12 px-2 py-2.5">
                      {canEdit && <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))} className="h-4 w-4 accent-blue-600" aria-label="Выбрать все" />}
                    </th>
                    {sortHeader('Инвойс', 'invoice', 'w-[150px]')}
                    {sortHeader('Наименование продукта', 'productName')}
                    {stages.map(stage => sortHeader(stage.dateLabel, `date:${stage.id}`, 'w-[150px]'))}
                    {sortHeader('Статус', 'status', 'w-[220px]')}
                    {sortHeader('Комментарий', 'comment', 'w-[200px]')}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {canEdit && (
                    <tr className="bg-blue-50/40">
                      <td className="px-2 py-2 text-center"><Plus className="mx-auto h-4 w-4 text-blue-500" /></td>
                      {(['invoice', 'productName', 'date'] as const).map(key => (
                        <td key={key} className="px-2 py-2">
                          <input
                            ref={key === 'invoice' ? quickInvoiceRef : undefined}
                            type={key === 'date' ? 'date' : 'text'}
                            value={quick[key]}
                            onChange={event => setQuick(current => ({ ...current, [key]: event.target.value }))}
                            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addQuick(); } }}
                            placeholder={key === 'invoice' ? 'Новый инвойс' : key === 'productName' ? 'Наименование продукта' : undefined}
                            aria-label={key === 'date' ? stages[0].dateLabel : TEXT_LABELS[key]}
                            className="w-full rounded-md border border-dashed border-blue-200 bg-white px-2 py-1 text-sm outline-none placeholder:text-slate-400 focus:border-solid focus:border-blue-400"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2 text-xs text-slate-400" colSpan={stages.length + 1}>
                        Enter — добавить фуру во вкладку «{stages[0].label}»
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={() => void addQuick()} disabled={adding} className="rounded-md bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:bg-slate-300" aria-label="Добавить">
                          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    </tr>
                  )}
                  {visible.map(entry => (
                    <tr
                      key={entry.id}
                      draggable={canEdit && !editing}
                      onDragStart={event => startDrag(event, entry.id)}
                      onDragEnd={endDrag}
                      className={cn(
                        'group align-middle transition-colors hover:bg-slate-50/80',
                        selected.has(entry.id) && 'bg-blue-50/60 hover:bg-blue-50',
                        isTruckIdle(entry, stages) && 'shadow-[inset_3px_0_0_#ef4444]',
                      )}
                      title={entry.updatedAt ? `Изменено ${new Date(entry.updatedAt).toLocaleString('ru-RU')}${entry.updatedBy ? ` · ${entry.updatedBy}` : ''}` : undefined}
                    >
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-0.5">
                          {canEdit && <GripVertical className="h-4 w-4 cursor-grab text-slate-300 opacity-0 group-hover:opacity-100" aria-hidden />}
                          {canEdit && <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggle(entry.id)} className="h-4 w-4 accent-blue-600" aria-label={`Выбрать ${truckName(entry)}`} />}
                        </div>
                      </td>
                      <td className="px-1 py-1">{cell(entry, 'invoice', visibleIds, { className: 'font-semibold text-slate-900' })}</td>
                      <td className="px-1 py-1">{cell(entry, 'productName', visibleIds)}</td>
                      {stages.map(stage => <td key={stage.id} className="px-1 py-1">{cell(entry, `date:${stage.id}`, visibleIds)}</td>)}
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusSelect value={entry.status} stages={stages} disabled={!canEdit} onChange={status => void moveTo([entry.id], status)} />
                          <StageHint entry={entry} stages={stages} />
                        </div>
                      </td>
                      <td className="px-1 py-1">{cell(entry, 'comment', visibleIds, { className: 'text-xs text-slate-600', placeholder: '' })}</td>
                      <td className="px-2 py-1">
                        {canEdit && (
                          <button onClick={() => void removeRows([entry.id])} className="rounded-md p-1.5 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100" aria-label={`Удалить ${truckName(entry)}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <div className="px-4 py-12 text-center text-sm text-slate-500">
                  {entries.length
                    ? 'Нет фур с такими условиями.'
                    : canEdit ? 'Пока пусто. Добавьте фуру в строке выше или скопируйте строки из Excel и нажмите Ctrl+V.' : 'Пока пусто.'}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
              <span>Показано {visible.length} из {entries.length}</span>
              {canEdit && <span>Клик по ячейке — редактировать · Tab — следующая ячейка · дата этапа сама меняет статус · двойной клик по вкладке — переименовать</span>}
            </div>
          </>
        ) : (
          /* Board: one column per stage, drag cards between columns */
          <div className="flex gap-3 overflow-x-auto p-3">
            {stages.map(stage => {
              const cards = sorted.filter(entry => entry.status === stage.id);
              const ids = cards.map(card => card.id);
              return (
                <div
                  key={stage.id}
                  {...dropProps(stage.id)}
                  className={cn('flex min-h-[200px] min-w-[260px] flex-1 flex-col rounded-xl border border-t-4 border-slate-200 bg-slate-50/70 transition-colors', COLOR_STYLES[stage.color].column, dropTarget === stage.id && 'bg-blue-50 ring-2 ring-blue-400')}
                >
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm font-semibold text-slate-800">{stage.label}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">{cards.length}</span>
                  </div>
                  <div className="flex-1 space-y-2 px-2 pb-2">
                    {cards.map(entry => (
                      <div
                        key={entry.id}
                        draggable={canEdit && !editing}
                        onDragStart={event => startDrag(event, entry.id)}
                        onDragEnd={endDrag}
                        className={cn('rounded-lg border border-slate-200 bg-white p-2 shadow-2xs', canEdit && 'cursor-grab active:cursor-grabbing', isTruckIdle(entry, stages) && 'border-l-4 border-l-red-500')}
                      >
                        {cell(entry, 'invoice', ids, { className: 'font-semibold text-slate-900', placeholder: 'Инвойс' })}
                        {cell(entry, 'productName', ids, { className: 'text-xs text-slate-600', placeholder: 'Наименование' })}
                        <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-slate-500">
                          {stages.map(dateStage => (
                            <div key={dateStage.id}>
                              <div className="truncate px-2" title={dateStage.dateLabel}>{dateStage.dateLabel}</div>
                              {cell(entry, `date:${dateStage.id}`, ids, { className: 'whitespace-nowrap px-2 text-xs' })}
                            </div>
                          ))}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-1 px-1">
                          <StageHint entry={entry} stages={stages} />
                          <StatusSelect value={entry.status} stages={stages} disabled={!canEdit} onChange={next => void moveTo([entry.id], next)} className="ml-auto origin-right scale-90" />
                        </div>
                      </div>
                    ))}
                    {!cards.length && <div className="rounded-lg border border-dashed border-slate-300 px-2 py-6 text-center text-xs text-slate-400">{canEdit ? 'Перетащите сюда фуру' : 'Пусто'}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pasteText !== null && (
        <PasteImportModal initialText={pasteText} stages={stages} existingInvoices={existingInvoices} onClose={() => setPasteText(null)} onImport={importRows} />
      )}
      {stageDialog && (
        <StageSettingsModal
          stages={stages}
          counts={counts}
          startWithNew={stageDialog === 'new'}
          onClose={() => setStageDialog(null)}
          onSave={async (next, moves) => {
            await saveStages(next, moves, entries);
            showToast({ type: 'success', message: 'Этапы сохранены' });
          }}
        />
      )}
    </div>
  );
};
