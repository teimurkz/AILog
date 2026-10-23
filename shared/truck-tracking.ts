// "Слежка авто": trucks that have already reached our SVH (temporary storage warehouse).
// Replaces the team's Excel sheet. The stages (tabs) are configured by the team and stored in
// Firestore; by default they are: arrived at the SVH → unloaded at the SVH → moved to the
// commercial warehouse. Every stage has its own date column. Dates are stored as YYYY-MM-DD.

export const STAGE_COLORS = ['blue', 'amber', 'emerald', 'violet', 'rose', 'cyan', 'orange', 'slate'] as const;
export type StageColor = typeof STAGE_COLORS[number];

export interface TruckStage {
  id: string;
  /** Tab name, e.g. "Выгружена на СВХ". */
  label: string;
  /** Header of the stage's date column, e.g. "Разгрузили на СВХ". */
  dateLabel: string;
  color: StageColor;
  order: number;
  /** Days a truck may stay in this stage before it is flagged as idle; empty = not tracked. */
  idleDays?: number | null;
}

export const DEFAULT_STAGES: TruckStage[] = [
  { id: 'arrived', label: 'Прибыла на СВХ', dateLabel: 'Дата прибытия', color: 'blue', order: 0, idleDays: 2 },
  { id: 'unloaded', label: 'Выгружена на СВХ', dateLabel: 'Разгрузили на СВХ', color: 'amber', order: 1, idleDays: 3 },
  { id: 'moved', label: 'Перемещена на склад', dateLabel: 'Перемещено на склад', color: 'emerald', order: 2, idleDays: null },
];

export interface TruckTrackingEntry {
  id: string;
  invoice: string;
  productName: string;
  /** Stage id → date the truck reached that stage. */
  stageDates: Record<string, string>;
  /** Stage id. */
  status: string;
  comment?: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  statusChangedAt?: string;
}

/** A change to one entry; `stageDates` holds only the dates that change. */
export interface TruckTrackingPatch {
  invoice?: string;
  productName?: string;
  comment?: string;
  status?: string;
  stageDates?: Record<string, string>;
}

export type TruckTrackingImportRow = Pick<TruckTrackingEntry, 'invoice' | 'productName' | 'stageDates' | 'status' | 'comment'>;

export function sortStages(stages: TruckStage[]): TruckStage[] {
  return [...stages]
    .map(stage => ({ ...stage, color: (STAGE_COLORS as readonly string[]).includes(stage.color) ? stage.color : 'slate' as StageColor }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'ru'));
}

export function newStageId() {
  return `stage_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Brings a stored document to the current shape; trucks in a deleted stage show in the first one. */
export function normalizeEntry(raw: Record<string, any>, stages: TruckStage[]): TruckTrackingEntry {
  const stageDates = raw.stageDates && typeof raw.stageDates === 'object' ? { ...raw.stageDates } : {};
  const status = stages.some(stage => stage.id === raw.status) ? raw.status : stages[0]?.id ?? '';
  return { ...raw, id: raw.id, invoice: raw.invoice || '', productName: raw.productName || '', comment: raw.comment || '', stageDates, status } as TruckTrackingEntry;
}

export const stageDate = (entry: Pick<TruckTrackingEntry, 'stageDates'>, stageId: string) => entry.stageDates?.[stageId] || '';

const pad = (value: number) => String(value).padStart(2, '0');

export function todayIso(today = new Date()) {
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

// Accepts what Excel copies: 23.10.2026, 23/10/26, 2026-10-23 or an Excel serial number.
export function parseTrackingDate(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${pad(+match[2])}-${pad(+match[3])}`;
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (match) {
    const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    const [day, month] = [+match[1], +match[2]];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${pad(month)}-${pad(day)}`;
    return '';
  }
  if (/^\d{5}$/.test(text)) {
    const date = new Date(Date.UTC(1899, 11, 30) + +text * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return '';
}

export function formatTrackingDate(value?: string): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

/** Whole days from the date until today (0 = today); null for an empty or invalid date. */
export function daysSince(date: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return Math.round((Date.parse(todayIso(today)) - Date.parse(date)) / 86400000);
}

/** How long the truck has been in its current stage: from that stage's date, or the latest earlier one. */
export function daysInStage(entry: Pick<TruckTrackingEntry, 'status' | 'stageDates'>, stages: TruckStage[], today = new Date()) {
  const index = stages.findIndex(stage => stage.id === entry.status);
  for (let i = index; i >= 0; i -= 1) {
    const date = stageDate(entry, stages[i].id);
    if (date) return daysSince(date, today);
  }
  return null;
}

export function isTruckIdle(entry: Pick<TruckTrackingEntry, 'status' | 'stageDates'>, stages: TruckStage[], today = new Date()) {
  const limit = stages.find(stage => stage.id === entry.status)?.idleDays;
  const days = daysInStage(entry, stages, today);
  return Boolean(limit && limit > 0) && days !== null && days >= (limit as number);
}

/**
 * Filling in a later stage's date moves the truck to that stage; clearing the date of the
 * current stage steps it back to the furthest earlier stage that has a date.
 * Returns null when the status should stay as it is.
 */
export function statusAfterDateEdit(
  entry: Pick<TruckTrackingEntry, 'status' | 'stageDates'>, stages: TruckStage[], stageId: string, value: string,
): string | null {
  const target = stages.findIndex(stage => stage.id === stageId);
  const current = stages.findIndex(stage => stage.id === entry.status);
  if (value && target > current) return stageId;
  if (!value && stageId === entry.status) {
    for (let i = target - 1; i >= 0; i -= 1) if (stageDate(entry, stages[i].id)) return stages[i].id;
    return target > 0 ? stages[0].id : null;
  }
  return null;
}

/** Moving a truck to a stage by hand fills that stage's empty date with today (still editable). */
export function stagePatch(entry: Pick<TruckTrackingEntry, 'stageDates'>, stageId: string, today = new Date()): TruckTrackingPatch {
  return stageDate(entry, stageId) ? { status: stageId } : { status: stageId, stageDates: { [stageId]: todayIso(today) } };
}

const normalizeText = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// Recognises headers and statuses of the default stages written in other words.
const DEFAULT_STAGE_ALIASES: [RegExp, string][] = [
  [/перемещ|коммерч|склад|moved|move/i, 'moved'],
  [/разгру|выгру|unload/i, 'unloaded'],
  [/прибы|приех|arriv/i, 'arrived'],
];

function findStage(text: string, stages: TruckStage[], fields: ('label' | 'dateLabel')[]): TruckStage | undefined {
  const value = normalizeText(text);
  if (!value) return undefined;
  const byId = stages.find(stage => stage.id === text.trim());
  if (byId) return byId;
  const exact = stages.find(stage => fields.some(field => normalizeText(stage[field]) === value));
  if (exact) return exact;
  const partial = stages.find(stage => fields.some(field => {
    const name = normalizeText(stage[field]);
    return name.length > 3 && (value.includes(name) || name.includes(value));
  }));
  if (partial) return partial;
  const alias = DEFAULT_STAGE_ALIASES.find(([pattern, id]) => pattern.test(value) && stages.some(stage => stage.id === id));
  return alias ? stages.find(stage => stage.id === alias[1]) : undefined;
}

export const parseStageStatus = (value: unknown, stages: TruckStage[]) =>
  findStage(String(value ?? ''), stages, ['label', 'dateLabel'])?.id ?? null;

type Column = 'invoice' | 'productName' | 'status' | 'comment' | `date:${string}` | undefined;
const FIXED_HEADERS: [RegExp, Column][] = [
  [/инвойс|invoice|счет|счёт/i, 'invoice'],
  [/наимен|продукт|товар|product/i, 'productName'],
  [/статус|status/i, 'status'],
  [/коммент|примеч|comment|note/i, 'comment'],
];
const YES = /^(да|yes|\+|✓|v)$/i;

/** Column order used when the pasted rows have no header (the team's original sheet). */
export function defaultPasteColumns(stages: TruckStage[]): string[] {
  return ['Инвойс', 'Наименование продукта', ...stages.slice(0, 2).map(stage => stage.dateLabel), 'Статус'];
}

/** Parses rows copied from Excel (tab-separated); a header row is optional. */
export function parseTruckTrackingPaste(text: string, stages: TruckStage[]): TruckTrackingImportRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(line => line.trim());
  if (!lines.length || !stages.length) return [];
  const split = (line: string) => line.split('\t').map(cell => cell.trim().replace(/^"(.*)"$/s, '$1'));
  const headerColumn = (cell: string): Column => {
    const fixed = FIXED_HEADERS.find(([pattern]) => pattern.test(cell))?.[1];
    if (fixed) return fixed;
    const stage = findStage(cell, stages, ['dateLabel', 'label']);
    return stage ? `date:${stage.id}` : undefined;
  };
  const headerColumns = split(lines[0]).map(headerColumn);
  const hasHeader = headerColumns.filter(Boolean).length >= 2;
  const columns: Column[] = hasHeader ? headerColumns
    : ['invoice', 'productName', ...stages.slice(0, 2).map(stage => `date:${stage.id}` as Column), 'status'];

  return (hasHeader ? lines.slice(1) : lines).map(line => {
    const cells = split(line);
    const value = (column: Column) => {
      const index = columns.indexOf(column);
      return index >= 0 ? cells[index] ?? '' : '';
    };
    const stageDates: Record<string, string> = {};
    let reached = -1;
    stages.forEach((stage, index) => {
      const raw = value(`date:${stage.id}`);
      const date = parseTrackingDate(raw);
      if (date) stageDates[stage.id] = date;
      // A "да"/"+" in a stage column without a date still means the stage is done.
      if (date || YES.test(raw)) reached = index;
    });
    return {
      invoice: value('invoice'),
      productName: value('productName'),
      stageDates,
      status: parseStageStatus(value('status'), stages) ?? stages[Math.max(reached, 0)].id,
      comment: value('comment'),
    };
  }).filter(row => row.invoice || row.productName);
}
