import { pickTexts, type CrmLanguage } from './i18n';
import { stageShipmentSync } from './shipment-link';
import { SVH_ISSUE_TEXTS } from './svh-reconcile-i18n';
import { sortStages, stageDate, type TruckStage, type TruckTrackingEntry } from './truck-tracking';

/**
 * Reconciliation of the SVH partner's parking file ("МехКаз 2026") with "Слежка авто".
 * The partner bills parking from the day a truck enters the SVH yard to the day it is unloaded.
 */

export interface PartnerDate {
  day: string | null; raw: string; bad: boolean;
  /** The date as written when it is implausible ("19.10.2020" → 2020-10-19): the base for repairing a year typo. */
  guess?: string;
  /** The year was a typo and has been corrected; `raw` keeps what the partner wrote. */
  repaired?: boolean;
}
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
  return plausible ? { day, raw, bad: false } : { day: null, raw, bad: true, ...(day ? { guess: day } : {}) };
}

/** Longest parking we believe without questions: beyond it a date is taken for a typo. */
const MAX_PARKING = 180;
const withYear = (day: string, year: number) => {
  const candidate = `${year}${day.slice(4)}`;
  return iso(Date.parse(candidate)) === candidate ? candidate : null;
};

/**
 * Year typos in the partner's file: an end date "19.10.2020" for a truck that arrived on 14.10.2026, or an
 * arrival "22.09.2027" before an unloading on 28.09.2026. The day and month are right, so the year is taken
 * from the other date of the same row; the row keeps the original text and says it was corrected.
 */
export function repairYears(row: Pick<PartnerRow, 'arrived' | 'moved' | 'unloaded'>, today: string) {
  const fits = (arrived: string, end: string) => { const span = daysBetween(arrived, end); return span >= 0 && span <= MAX_PARKING; };
  const repair = (date: PartnerDate, accept: (day: string) => boolean): PartnerDate => {
    const written = date.day || date.guess;
    if (!written) return date;
    const year = Number(today.slice(0, 4));
    const fixed = [year, year - 1, year + 1].map(candidate => withYear(written, candidate)).find(day => day && day !== date.day && accept(day));
    return fixed ? { day: fixed, raw: date.raw || formatDay(written), bad: false, repaired: true } : date;
  };
  let { arrived, moved, unloaded } = row;
  const end = unloaded.day || moved.day;
  // An arrival in the future, or after its own unloading, cannot be right.
  if (arrived.bad || (arrived.day && (arrived.day > today || (end && !fits(arrived.day, end))))) {
    arrived = repair(arrived, day => day <= today && (!end || fits(day, end)));
  }
  if (arrived.day) {
    // A truck cannot have been unloaded after today.
    if (unloaded.bad) unloaded = repair(unloaded, day => day <= today && fits(arrived.day!, day));
    if (moved.bad) moved = repair(moved, day => day <= today && fits(arrived.day!, day));
  }
  return { arrived, moved, unloaded };
}

/**
 * The invoice number both sides share: "20260903-351" → "351", a bare "351" stays. One invoice carried by
 * several trucks keeps its part: "20260907-389.2" → "389.2". A lost dash is restored: "20261010464" → "464".
 */
export function partnerInvoice(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const key = (number: string, part?: string) => `${Number(number)}${part ? `.${Number(part)}` : ''}`;
  const afterDash = text.match(/-\s*(\d+)(?:[.,/](\d{1,2}))?\s*$/);
  if (afterDash) return key(afterDash[1], afterDash[2]);
  const bare = text.match(/^(\d{2,5})(?:[.,/](\d{1,2}))?$/);
  if (bare) return key(bare[1], bare[2]);
  const glued = text.match(/^20\d{6}(\d{2,4})$/);
  return glued ? key(glued[1]) : null;
}

/** The same number from a "Слежка авто" invoice, whatever is written before it. */
export function crmInvoiceKey(value: string): string | null {
  const found = partnerInvoice(value);
  if (found) return found;
  const tail = value.trim().match(/(\d+)(?:[.,/](\d{1,2}))?\s*$/);
  return tail ? `${Number(tail[1])}${tail[2] ? `.${Number(tail[2])}` : ''}` : null;
}
const invoiceBase = (key: string) => key.split('.')[0];

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
      ...repairYears({ arrived, moved: partnerDate(row[column.moved], today), unloaded: partnerDate(row[column.unloaded], today) }, today),
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

/** Saturday or Sunday. */
export const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
/**
 * Trucks that enter the yard on Saturday or Sunday are booked in the CRM on the following Monday.
 * Then the partner's weekend date is the real one: we pay parking from it.
 */
export function weekendBookedMonday(partnerDay: string | null, crmDay: string | null) {
  if (!partnerDay || !crmDay || !isWeekend(partnerDay)) return false;
  const shift = daysBetween(partnerDay, crmDay);
  return shift > 0 && shift <= 2 && new Date(`${crmDay}T00:00:00Z`).getUTCDay() === 1;
}

/** End of parking by the partner: the SVH unloading date, or the commercial warehouse date when that is empty. */
function partnerEnd(partner: PartnerRow): PartnerDate {
  return partner.unloaded.day || partner.unloaded.bad ? partner.unloaded : partner.moved;
}

/**
 * Parking days: from entering the yard to unloading at the SVH. Without an unloading date the truck
 * went straight to the commercial warehouse (moving date); with neither it is still parked → until today.
 */
export function parkingDays(arrived: string | null, unloaded: string | null, moved: string | null, today: string) {
  if (!arrived) return { days: null as number | null, open: false };
  const end = unloaded || moved;
  // An end before the arrival is an error in the dates, not zero days.
  if (end && end < arrived) return { days: null as number | null, open: false };
  return end ? { days: daysBetween(arrived, end), open: false } : { days: Math.max(0, daysBetween(arrived, today)), open: true };
}

export type ReconcileStatus = 'ok' | 'mismatch' | 'not-found' | 'ambiguous' | 'no-invoice';
/** Where the truck was unloaded: at the SVH, or straight at the commercial warehouse (no SVH date). */
export interface UnloadPlace { place: 'svh' | 'warehouse' | null; day: string | null }
export const unloadPlace = (svh: string | null, warehouse: string | null): UnloadPlace =>
  svh ? { place: 'svh', day: svh } : warehouse ? { place: 'warehouse', day: warehouse } : { place: null, day: null };
export interface ReconcileRow {
  partner: PartnerRow;
  crm: { id: string; invoice: string; arrived: string | null; unloaded: string | null; moved: string | null } | null;
  status: ReconcileStatus;
  issues: string[];
  /** Explanations that are not discrepancies (weekend arrival booked on Monday). */
  notes: string[];
  /** The truck entered on a weekend and the CRM has the following Monday. */
  weekendArrival: boolean;
  partnerUnload: UnloadPlace;
  crmUnload: UnloadPlace | null;
  partnerDays: number | null; partnerOpen: boolean;
  crmDays: number | null; crmOpen: boolean;
  /** Partner days minus CRM days: more than 0 = the partner bills more than we recorded. */
  diff: number | null;
}

export interface ReconcilePeriod { from: string; to: string }
export interface ReconcileOptions {
  /** Date differences of up to this many days are accepted as the same day (0 = dates must match). */
  tolerance?: number;
}

/**
 * `period` limits the check to trucks that entered the yard in it (by the partner's arrival date);
 * without it the whole file is checked. `language` is the language of the issue texts.
 */
export function reconcile(allRows: PartnerRow[], entries: TruckTrackingEntry[], stages: TruckStage[], today: string, period?: ReconcilePeriod | null, language: CrmLanguage = 'ru', options: ReconcileOptions = {}) {
  const tolerance = Math.max(0, Math.floor(options.tolerance || 0));
  const text = pickTexts(SVH_ISSUE_TEXTS, language);
  const LABEL = text.field;
  const roles = stageRoles(stages);
  const partnerRows = period ? allRows.filter(row => row.arrived.day && row.arrived.day >= period.from && row.arrived.day <= period.to) : allRows;
  const byKey = new Map<string, TruckTrackingEntry[]>();
  const byBase = new Map<string, TruckTrackingEntry[]>();
  for (const entry of entries) {
    const key = crmInvoiceKey(entry.invoice || '');
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) || []), entry]);
    byBase.set(invoiceBase(key), [...(byBase.get(invoiceBase(key)) || []), entry]);
  }
  // "389.2" is truck 2 of invoice 389: the CRM may keep it as "389.2" or as one "389".
  const candidatesFor = (key: string) => byKey.get(key) || (key.includes('.') ? byKey.get(invoiceBase(key)) : byBase.get(key)) || [];
  const matched = new Set<string>();
  // Rows of the file that share one CRM truck: a repeated invoice, or parts of an invoice the CRM keeps as one.
  const rowsOfEntry = new Map<string, string[]>();
  for (const partner of partnerRows) {
    const found = partner.invoice ? candidatesFor(partner.invoice) : [];
    if (found.length === 1) rowsOfEntry.set(found[0].id, [...(rowsOfEntry.get(found[0].id) || []), partner.no]);
  }
  const rows: ReconcileRow[] = partnerRows.map(partner => {
    const issues: string[] = [];
    // Only two dates matter: entering the yard and the end of parking — unloading at the SVH,
    // or, when the partner left it empty, the day the truck went to the commercial warehouse.
    const end = partnerEnd(partner);
    if (partner.arrived.bad) issues.push(text.badDate(LABEL.arrived, partner.arrived.raw));
    if (end.bad) issues.push(text.badDate(LABEL.unloaded, end.raw));
    if (partner.arrived.day && end.day && end.day < partner.arrived.day) issues.push(text.endBeforeArrival(formatDay(partner.arrived.day), formatDay(end.day)));
    const repairs = ([['arrived', partner.arrived], ['unloaded', end]] as const)
      .filter(([, date]) => date.repaired).map(([field, date]) => text.yearFixed(LABEL[field], date.raw, formatDay(date.day)));
    const counted = parkingDays(partner.arrived.day, end.day, null, today);
    // An unreadable end date must not turn into "parked until today".
    const parking = end.bad ? { days: null, open: false } : counted;
    const base = { partner, partnerDays: parking.days, partnerOpen: parking.open, partnerUnload: unloadPlace(partner.unloaded.day, partner.moved.day), crmUnload: null, notes: repairs, weekendArrival: false };
    if (!partner.invoice) return { ...base, crm: null, status: 'no-invoice', issues, crmDays: null, crmOpen: false, diff: null };
    const candidates = candidatesFor(partner.invoice);
    if (candidates.length !== 1) {
      return { ...base, crm: null, status: candidates.length ? 'ambiguous' : 'not-found',
        issues: [...issues, candidates.length ? text.ambiguous(partner.invoice) : text.notFound(partner.invoice)],
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
    const weekendArrival = weekendBookedMonday(partner.arrived.day, crm.arrived);
    const notes = [...repairs, ...(weekendArrival
      ? [text.weekendArrival(text.weekdays[new Date(`${partner.arrived.day}T00:00:00Z`).getUTCDay()], formatDay(partner.arrived.day), formatDay(crm.arrived))]
      : [])];
    const sharing = rowsOfEntry.get(entry.id) || [];
    if (sharing.length > 1) issues.push(text.sharedTruck(sharing.join(', ')));
    const crmEnd = crm.unloaded || crm.moved;
    const compared = [
      { field: 'arrived' as const, theirs: partner.arrived.day, ours: crm.arrived, bad: partner.arrived.bad, skip: weekendArrival },
      { field: 'unloaded' as const, theirs: end.day, ours: crmEnd, bad: end.bad, skip: false },
    ];
    for (const { field, theirs, ours, bad, skip } of compared) {
      if (skip || bad) continue;
      if (theirs && ours && theirs !== ours) {
        const shift = daysBetween(ours, theirs);
        const line = text.differs(LABEL[field], formatDay(theirs), formatDay(ours), `${shift > 0 ? '+' : ''}${shift}`);
        if (Math.abs(shift) <= tolerance) notes.push(text.withinTolerance(line));
        else issues.push(line);
      } else if (theirs && !ours) issues.push(text.noCrmDate(LABEL[field], formatDay(theirs)));
      else if (!theirs && ours) issues.push(text.noPartnerDate(LABEL[field], formatDay(ours)));
    }
    // A weekend arrival is counted from the partner's date: the truck really stood there.
    const ours = parkingDays(weekendArrival ? partner.arrived.day : crm.arrived, crmEnd, null, today);
    const diff = parking.days !== null && ours.days !== null ? parking.days - ours.days : null;
    return { ...base, crm, crmUnload: unloadPlace(crm.unloaded, crm.moved), status: issues.length ? 'mismatch' : 'ok', issues, notes, weekendArrival, crmDays: ours.days, crmOpen: ours.open, diff };
  });

  // Trucks we recorded in the period that the partner's file does not list at all
  // (checked against the whole file: arrival dates may differ by a day across the period edge).
  const arrivals = partnerRows.map(row => row.arrived.day).filter((day): day is string => Boolean(day)).sort();
  const range = period || (arrivals.length ? { from: arrivals[0], to: arrivals[arrivals.length - 1] } : null);
  const inFile = new Set(allRows.flatMap(row => row.invoice ? [row.invoice, invoiceBase(row.invoice)] : []));
  const missing = range && roles.arrived ? entries.filter(entry => {
    const day = stageDate(entry, roles.arrived!);
    const key = crmInvoiceKey(entry.invoice || '');
    return !matched.has(entry.id) && !(key && (inFile.has(key) || inFile.has(invoiceBase(key)))) && day && day >= range.from && day <= range.to;
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
      /** Weekend arrivals booked on Monday in the CRM (not discrepancies). */
      weekend: rows.filter(row => row.weekendArrival).length,
      /** Trucks the partner bills more days for than the CRM has. */
      overbilled: rows.filter(row => (row.diff || 0) > 0).length,
      /** Dates whose year was a typo and was corrected from the row's other date. */
      repaired: rows.filter(row => row.partner.arrived.repaired || row.partner.moved.repaired || row.partner.unloaded.repaired).length,
      partnerDays: sum(compared.map(row => row.partnerDays)),
      crmDays: sum(compared.map(row => row.crmDays)),
      allPartnerDays: sum(rows.map(row => row.partnerDays)),
    },
  };
}

/** Parking cost in tenge at a daily rate: reconciled trucks (partner / CRM / difference) and the whole selection by the partner. */
export function parkingCost(rows: ReconcileRow[], rate: number) {
  const perDay = Number.isFinite(rate) && rate > 0 ? rate : 0;
  const sum = (pick: (row: ReconcileRow) => number | null, list: ReconcileRow[]) => list.reduce((total, row) => total + (pick(row) || 0), 0) * perDay;
  const compared = rows.filter(row => row.crm);
  return {
    partner: sum(row => row.partnerDays, compared),
    crm: sum(row => row.crmDays, compared),
    diff: sum(row => row.diff, compared),
    partnerAll: sum(row => row.partnerDays, rows),
  };
}
