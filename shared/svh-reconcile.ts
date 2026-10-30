import { stageShipmentSync } from './shipment-link';
import { sortStages, stageDate, type TruckStage, type TruckTrackingEntry } from './truck-tracking';

/**
 * Reconciliation of the SVH partner's parking file ("МехКаз 2026") with "Слежка авто".
 * The partner bills parking from the day a truck enters the SVH yard to the day it is unloaded.
 */

export interface PartnerDate { day: string | null; raw: string; bad: boolean }
export interface PartnerRow {
  row: number; no: string; invoiceRaw: string; invoice: string | null; truck: string; product: string;
  arrived: PartnerDate; moved: PartnerDate; unloaded: PartnerDate;
}

const DAY = 86400000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
export const formatDay = (day?: string | null) => day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : '';
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** An Excel cell → day. The partner writes dates as Excel dates or US text "9/28/26"; "28.09.2026" is accepted too. */
export function partnerDate(value: unknown, today: string): PartnerDate {
  if (value === null || value === undefined || String(value).trim() === '') return { day: null, raw: '', bad: false };
  let day: string | null = null;
  if (typeof value === 'number' && value > 20000 && value < 80000) day = iso(Date.UTC(1899, 11, 30) + Math.round(value) * DAY);
  else if (value instanceof Date && Number.isFinite(value.getTime())) day = iso(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  else {
    // Tolerates typos seen in the partner's file: "29//10/2026", "22.092026".
    const text = String(value).trim().replace(/\/{2,}/g, '/').replace(/^(\d{1,2})\.(\d{2})(\d{4})$/, '$1.$2.$3');
    const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    const ru = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
    const toDay = (month: string, date: string, year: string) => {
      const candidate = `${year.length === 2 ? '20' + year : year}-${month.padStart(2, '0')}-${date.padStart(2, '0')}`;
      const parsed = Date.parse(candidate);
      return Number.isFinite(parsed) && iso(parsed) === candidate ? candidate : null;
    };
    // US month/day first; "29/10/2026" is only valid as day/month.
    if (us) day = toDay(us[1], us[2], us[3]) || toDay(us[2], us[1], us[3]);
    else if (ru) day = toDay(ru[2], ru[1], ru[3]);
  }
  const raw = value instanceof Date ? formatDay(day) : typeof value === 'number' ? formatDay(day) : String(value).trim();
  // A year far from today ("10/19/20") is a typo, not a date to bill by.
  const plausible = day && Math.abs(daysBetween(day, today)) <= 400;
  return plausible ? { day, raw, bad: false } : { day: null, raw, bad: true };
}

/** "20260903-351" → "351"; a bare number stays as it is. */
export function partnerInvoice(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const afterDash = text.match(/-\s*(\d+)\s*$/);
  if (afterDash) return String(Number(afterDash[1]));
  return /^\d{2,5}$/.test(text) ? String(Number(text)) : null;
}

const norm = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const COLUMNS = {
  arrived: { find: (h: string) => h.includes('подачи') || h.includes('тупик'), fallback: 1 },
  invoice: { find: (h: string) => h.startsWith('инвойс'), fallback: 4 },
  truck: { find: (h: string) => h.includes('т/с'), fallback: 7 },
  product: { find: (h: string) => h.includes('наименование'), fallback: 8 },
  moved: { find: (h: string) => h.includes('перемещ'), fallback: 15 },
  unloaded: { find: (h: string) => h.includes('выгрузк'), fallback: 16 },
};

/** Reads the partner sheet (rows as `sheet_to_json(..., { header: 1, raw: true })`). Month separators and empty rows are skipped. */
export function parsePartnerSheet(rows: unknown[][], today: string): PartnerRow[] {
  const headerIndex = rows.findIndex(row => row?.some(cell => norm(cell).includes('подачи')) && row.some(cell => norm(cell).includes('выгрузк')));
  const header = (rows[headerIndex] || []).map(norm);
  const column = Object.fromEntries(Object.entries(COLUMNS).map(([name, spec]) => {
    const found = header.findIndex(spec.find);
    return [name, found >= 0 ? found : spec.fallback];
  })) as Record<keyof typeof COLUMNS, number>;
  const result: PartnerRow[] = [];
  rows.forEach((row, index) => {
    if (index <= headerIndex || !row) return;
    const no = String(row[0] ?? '').trim();
    const arrived = partnerDate(row[column.arrived], today);
    // A data row has a running number and an arrival date; "МАЙ 2026г" / "счет" rows have neither.
    if (!/^\d+$/.test(no) || (!arrived.day && !arrived.bad)) return;
    result.push({
      row: index + 1, no, invoiceRaw: String(row[column.invoice] ?? '').trim(), invoice: partnerInvoice(row[column.invoice]),
      truck: String(row[column.truck] ?? '').trim(), product: String(row[column.product] ?? '').trim(),
      arrived, moved: partnerDate(row[column.moved], today), unloaded: partnerDate(row[column.unloaded], today),
    });
  });
  return result;
}

/** Which "Слежка авто" stages hold the arrival, unloading and moving dates. */
export function stageRoles(stages: TruckStage[]) {
  const ordered = sortStages(stages);
  const arrived = ordered.find(stage => stageShipmentSync(stage) === 'customs') || ordered[0];
  const unloaded = ordered.find(stage => stageShipmentSync(stage) === 'unloaded') || ordered[1];
  const moved = ordered.find(stage => stage.id === 'moved') || ordered.filter(stage => stage !== arrived && stage !== unloaded).at(-1);
  return { arrived: arrived?.id, unloaded: unloaded?.id, moved: moved?.id };
}

const trailingNumber = (value: string) => value.trim().match(/(\d+)\s*$/)?.[1];

/**
 * Parking days: from entering the yard to unloading at the SVH. Without an unloading date the truck
 * went straight to the commercial warehouse (moving date); with neither it is still parked → until today.
 */
export function parkingDays(arrived: string | null, unloaded: string | null, moved: string | null, today: string) {
  if (!arrived) return { days: null as number | null, open: false };
  const end = unloaded || moved;
  return end ? { days: Math.max(0, daysBetween(arrived, end)), open: false } : { days: Math.max(0, daysBetween(arrived, today)), open: true };
}

export type ReconcileStatus = 'ok' | 'mismatch' | 'not-found' | 'ambiguous' | 'no-invoice';
export interface ReconcileRow {
  partner: PartnerRow;
  crm: { id: string; invoice: string; arrived: string | null; unloaded: string | null; moved: string | null } | null;
  status: ReconcileStatus;
  issues: string[];
  partnerDays: number | null; partnerOpen: boolean;
  crmDays: number | null; crmOpen: boolean;
  /** Partner days minus CRM days: more than 0 = the partner bills more than we recorded. */
  diff: number | null;
}

const LABEL = { arrived: 'Заезд', unloaded: 'Выгрузка', moved: 'Перемещение' } as const;

export interface ReconcilePeriod { from: string; to: string }

/**
 * `period` limits the check to trucks that entered the yard in it (by the partner's arrival date);
 * without it the whole file is checked.
 */
export function reconcile(allRows: PartnerRow[], entries: TruckTrackingEntry[], stages: TruckStage[], today: string, period?: ReconcilePeriod | null) {
  const roles = stageRoles(stages);
  const partnerRows = period ? allRows.filter(row => row.arrived.day && row.arrived.day >= period.from && row.arrived.day <= period.to) : allRows;
  const byNumber = new Map<string, TruckTrackingEntry[]>();
  for (const entry of entries) {
    const number = trailingNumber(entry.invoice || '');
    if (number) byNumber.set(String(Number(number)), [...(byNumber.get(String(Number(number))) || []), entry]);
  }
  const matched = new Set<string>();
  const rows: ReconcileRow[] = partnerRows.map(partner => {
    const issues: string[] = [];
    for (const field of ['arrived', 'unloaded', 'moved'] as const) {
      if (partner[field].bad) issues.push(`${LABEL[field]}: у партнёра непонятная дата «${partner[field].raw}»`);
    }
    const counted = parkingDays(partner.arrived.day, partner.unloaded.day, partner.moved.day, today);
    // An unreadable end date must not turn into "parked until today".
    const parking = counted.open && (partner.unloaded.bad || partner.moved.bad) ? { days: null, open: false } : counted;
    const base = { partner, partnerDays: parking.days, partnerOpen: parking.open };
    if (!partner.invoice) return { ...base, crm: null, status: 'no-invoice', issues, crmDays: null, crmOpen: false, diff: null };
    const candidates = byNumber.get(partner.invoice) || [];
    if (candidates.length !== 1) {
      return { ...base, crm: null, status: candidates.length ? 'ambiguous' : 'not-found',
        issues: [...issues, candidates.length ? `В «Слежке авто» несколько фур с номером ${partner.invoice}` : `Инвойса ${partner.invoice} нет в «Слежке авто»`],
        crmDays: null, crmOpen: false, diff: null };
    }
    const entry = candidates[0];
    matched.add(entry.id);
    const crm = {
      id: entry.id, invoice: entry.invoice,
      arrived: roles.arrived ? stageDate(entry, roles.arrived) || null : null,
      unloaded: roles.unloaded ? stageDate(entry, roles.unloaded) || null : null,
      moved: roles.moved ? stageDate(entry, roles.moved) || null : null,
    };
    for (const field of ['arrived', 'unloaded', 'moved'] as const) {
      const theirs = partner[field].day, ours = crm[field];
      if (theirs && ours && theirs !== ours) {
        const shift = daysBetween(ours, theirs);
        issues.push(`${LABEL[field]}: у партнёра ${formatDay(theirs)}, в CRM ${formatDay(ours)} (${shift > 0 ? '+' : ''}${shift} дн.)`);
      } else if (theirs && !ours) issues.push(`${LABEL[field]}: в CRM нет даты (у партнёра ${formatDay(theirs)})`);
      else if (!theirs && ours && !partner[field].bad) issues.push(`${LABEL[field]}: у партнёра нет даты (в CRM ${formatDay(ours)})`);
    }
    const ours = parkingDays(crm.arrived, crm.unloaded, crm.moved, today);
    const diff = parking.days !== null && ours.days !== null ? parking.days - ours.days : null;
    return { ...base, crm, status: issues.length ? 'mismatch' : 'ok', issues, crmDays: ours.days, crmOpen: ours.open, diff };
  });

  // Trucks we recorded in the period that the partner's file does not list at all
  // (checked against the whole file: arrival dates may differ by a day across the period edge).
  const arrivals = partnerRows.map(row => row.arrived.day).filter((day): day is string => Boolean(day)).sort();
  const range = period || (arrivals.length ? { from: arrivals[0], to: arrivals[arrivals.length - 1] } : null);
  const inFile = new Set(allRows.map(row => row.invoice).filter(Boolean));
  const missing = range && roles.arrived ? entries.filter(entry => {
    const day = stageDate(entry, roles.arrived!);
    const number = trailingNumber(entry.invoice || '');
    return !matched.has(entry.id) && !(number && inFile.has(String(Number(number)))) && day && day >= range.from && day <= range.to;
  }).map(entry => ({ id: entry.id, invoice: entry.invoice, productName: entry.productName, arrived: stageDate(entry, roles.arrived!) }))
    .sort((a, b) => a.arrived.localeCompare(b.arrived)) : [];

  const sum = (values: (number | null)[]) => values.reduce<number>((total, value) => total + (value || 0), 0);
  const compared = rows.filter(row => row.crm);
  return {
    rows, missing, period: range,
    summary: {
      total: rows.length,
      /** Rows of the file left out by the period (other dates or an unreadable arrival). */
      outside: allRows.length - rows.length,
      ok: rows.filter(row => row.status === 'ok').length,
      mismatch: rows.filter(row => row.status === 'mismatch').length,
      notFound: rows.filter(row => row.status === 'not-found' || row.status === 'ambiguous').length,
      noInvoice: rows.filter(row => row.status === 'no-invoice').length,
      partnerDays: sum(compared.map(row => row.partnerDays)),
      crmDays: sum(compared.map(row => row.crmDays)),
      allPartnerDays: sum(rows.map(row => row.partnerDays)),
    },
  };
}
