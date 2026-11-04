/**
 * ТТН (форма 1-Т) for regional truck orders: the document model, totals, sums and mass in words,
 * and reading the goods lines from the attached waybills (накладная на отпуск запасов, форма З-2).
 */

export interface TtnItem {
  code: string;
  name: string;
  unit: string;
  quantity: number | null;
  price: number | null;
  sum: number | null;
  /** Waybill the line came from: the "С грузом следуют документы" column. */
  documents: string;
  packaging: string;
  places: number | null;
  grossKg: number | null;
}

export interface TtnDocument {
  number: string;
  /** YYYY-MM-DD */
  date: string;
  vehicle: string;
  trailer: string;
  waybillSheet: string;
  carrier: string;
  driver: string;
  transportKind: string;
  customer: string;
  shipper: string;
  consignee: string;
  loadingPoint: string;
  unloadingPoint: string;
  releasedBy: string;
  poaNumber: string;
  poaDate: string;
  poaIssuedBy: string;
  /** Used when no line has its own gross mass. */
  grossKg: number | null;
  items: TtnItem[];
}

/** We ship every TTN ourselves: the shipper is always our company with its legal address. */
export const TTN_SHIPPER = 'Товарищество с ограниченной ответственностью "MehKaz"(МехКаз),040800, Республика Казахстан, г.Конаев, Проспект Д.А.Кунаева, дом № 18г';

/** The fields that stay the same from one TTN to the next: they are remembered and offered again. */
export const TTN_REMEMBERED_FIELDS = ['carrier', 'customer', 'loadingPoint', 'releasedBy', 'transportKind'] as const;
export type TtnRemembered = Partial<Pick<TtnDocument, typeof TTN_REMEMBERED_FIELDS[number]>>;

export const emptyTtnItem = (): TtnItem => ({
  code: '', name: '', unit: '', quantity: null, price: null, sum: null, documents: '', packaging: '', places: null, grossKg: null,
});

/** Reads numbers as 1C and Excel write them: "12 314 400,00", "2,800.000", "4398". */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let text = value.replace(/[\s  ]/g, '');
  if (!/^-?[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // The later separator is the decimal one.
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = (text.match(/,/g) || []).length > 1 ? text.replace(/,/g, '') : text.replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1) {
    // "1.234.567" — dots as thousands separators.
    text = text.replace(/\./g, '');
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export function ttnTotals(document: Pick<TtnDocument, 'items' | 'grossKg'>) {
  const sum = (pick: (item: TtnItem) => number | null) =>
    document.items.reduce((total, item) => total + (pick(item) ?? 0), 0);
  const itemsMass = document.items.some(item => item.grossKg !== null);
  return {
    quantity: round(sum(item => item.quantity), 3),
    sum: round(sum(item => item.sum), 2),
    places: round(sum(item => item.places), 3),
    grossKg: itemsMass ? round(sum(item => item.grossKg), 3) : document.grossKg,
  };
}

const ONES = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_FEMININE = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
const SCALES: Array<{ forms: [string, string, string]; feminine: boolean }> = [
  { forms: ['', '', ''], feminine: false },
  { forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
];

/** Russian plural form: 1 тысяча, 2 тысячи, 5 тысяч. */
export function pluralRu(count: number, forms: [string, string, string]) {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (ones === 1) return forms[0];
  if (ones >= 2 && ones <= 4) return forms[1];
  return forms[2];
}

function triadWords(value: number, feminine: boolean) {
  const words = [HUNDREDS[Math.floor(value / 100)]];
  const rest = value % 100;
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else words.push(TENS[Math.floor(rest / 10)], (feminine ? ONES_FEMININE : ONES)[rest % 10]);
  return words.filter(Boolean);
}

/** Whole number in Russian words, lower case: 21 → "двадцать один". */
export function integerInWords(value: number, feminine = false): string {
  let rest = Math.floor(Math.abs(value));
  if (rest === 0) return 'ноль';
  const parts: string[] = [];
  for (let scale = 0; rest > 0 && scale < SCALES.length; scale++) {
    const triad = rest % 1000;
    rest = Math.floor(rest / 1000);
    if (!triad) continue;
    const { forms, feminine: scaleFeminine } = SCALES[scale];
    const words = triadWords(triad, scale === 0 ? feminine : scaleFeminine);
    if (scale > 0) words.push(pluralRu(triad, forms));
    parts.unshift(words.join(' '));
  }
  return parts.join(' ');
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Двадцать четыре миллиона восемьсот семьдесят одна тысяча двести теңге 00 тиын", as 1C prints it. */
export function amountInWords(amount: number) {
  const tiyn = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(tiyn / 100);
  return `${capitalize(integerInWords(whole))} теңге ${String(tiyn % 100).padStart(2, '0')} тиын`;
}

/** "Девятнадцать тысяч пятьсот кг." */
export function massInWords(kg: number) {
  const whole = Math.floor(kg);
  const grams = Math.round((kg - whole) * 1000);
  return `${capitalize(integerInWords(whole))} кг.${grams ? ` ${integerInWords(grams)} г.` : ''}`;
}

/* ---------- Reading goods from a waybill ---------- */

/** A piece of text on a line: a PDF text run or a spreadsheet cell, with its left and right edge. */
export interface GridCell { x: number; right: number; text: string }
export type GridLine = GridCell[];

export interface PdfTextItem { str: string; x: number; y: number; width: number }

/**
 * Rebuilds lines from PDF text runs: runs at the same height make one line, read left to right,
 * and runs that touch are joined ("12 314" + "400,00" printed as two runs).
 */
export function linesFromPdfItems(items: PdfTextItem[], lineTolerance = 2.5): GridLine[] {
  const lines: Array<{ y: number; items: PdfTextItem[] }> = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const line = lines.find(candidate => Math.abs(candidate.y - item.y) <= lineTolerance);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  // PDF y grows upwards: the top line has the largest y.
  lines.sort((a, b) => b.y - a.y);
  return lines.map(line => {
    const cells: GridLine = [];
    for (const item of [...line.items].sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1];
      if (last && item.x - last.right < 1.5) {
        last.text += (item.x - last.right > 0.5 ? ' ' : '') + item.str;
        last.right = Math.max(last.right, item.x + item.width);
      } else {
        cells.push({ x: item.x, right: item.x + item.width, text: item.str });
      }
    }
    return cells.map(cell => ({ ...cell, text: cell.text.replace(/\s+/g, ' ').trim() })).filter(cell => cell.text);
  });
}

/** Spreadsheet rows as lines: a cell spans its column, or the whole merge it starts. */
export function linesFromSheetRows(rows: unknown[][], merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = []): GridLine[] {
  const spans = new Map(merges.map(merge => [`${merge.s.r}:${merge.s.c}`, merge.e.c + 1]));
  return rows.map((row, r) => Array.from(row || []).flatMap((value, c) => {
    const text = value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();
    return text ? [{ x: c, right: spans.get(`${r}:${c}`) ?? c + 1, text }] : [];
  }));
}

type Column = 'number' | 'code' | 'name' | 'unit' | 'quantity' | 'price' | 'sum';

const HEADER_PATTERNS: Array<[Column, RegExp]> = [
  ['number', /^№$|^№\s*п|по\s*порядку|^п\/п/i],
  ['name', /наименование|^товар/i],
  ['code', /номенкл|^код|артикул/i],
  ['unit', /единиц|ед\.?\s*изм/i],
  ['quantity', /отпущено|количество|кол-?\s*во/i],
  ['price', /цена/i],
  ['sum', /сумма\s*с\s*ндс|^сумма(?!\s*ндс)/i],
];

const TOTAL_LINE = /^(итого|всего)/i;
const UNIT = /^(шт|штук[аи]?|кг|г|т|тн|л|мл|м|м2|м3|упак|уп|кор|короб|пач|бут|бан|меш|компл|пар|рул|ящ|блок|паллет|пал)\.?$/i;

const center = (cell: GridCell) => (cell.x + cell.right) / 2;

/** Header row: the line with "Наименование", plus where each known column sits. */
function findHeader(lines: GridLine[]) {
  const start = lines.findIndex(line => line.some(cell => /наименование/i.test(cell.text)));
  if (start < 0) return null;
  const columns = new Map<Column, number>();
  // Headers of З-2 wrap over a few lines: "Количество" / "подлежит отпуску" / "отпущено".
  for (const line of lines.slice(Math.max(0, start - 2), start + 4)) {
    for (const cell of line) {
      for (const [column, pattern] of HEADER_PATTERNS) {
        if (!pattern.test(cell.text)) continue;
        // "отпущено" is the released quantity: it wins over the plain "Количество" heading.
        if (column === 'quantity' && columns.has('quantity') && !/отпущено/i.test(cell.text)) continue;
        if (column === 'sum' && columns.has('sum') && !/с\s*ндс/i.test(cell.text)) continue;
        columns.set(column, center(cell));
      }
    }
  }
  return { start, columns };
}

/** The column a cell sits under, by the nearest header. */
function columnOf(cell: GridCell, columns: Map<Column, number>): Column | null {
  let best: Column | null = null;
  let distance = Infinity;
  for (const [column, x] of columns) {
    const gap = Math.abs(center(cell) - x);
    if (gap < distance) { best = column; distance = gap; }
  }
  return best;
}

const isText = (text: string) => /[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]{2,}/.test(text);

/** Quantity × price = sum, as on every goods line: finds those three among the line's numbers. */
function quantityPriceSum(numbers: number[]) {
  for (let i = 0; i + 2 < numbers.length; i++) {
    const [quantity, price, sum] = numbers.slice(i, i + 3);
    if (quantity > 0 && price > 0 && Math.abs(quantity * price - sum) <= Math.max(1, sum * 0.005)) return { quantity, price, sum, at: i };
  }
  return null;
}

/**
 * Goods lines of a waybill. Works on PDF text and on spreadsheet cells alike: the header row tells
 * which text is the name, code and unit; quantity, price and sum are the three numbers where
 * quantity × price = sum, so extra columns (VAT, "подлежит отпуску") do not confuse it.
 */
export function waybillGoods(lines: GridLine[], documentLabel = ''): TtnItem[] {
  const header = findHeader(lines);
  const columns = header?.columns ?? new Map<Column, number>();
  const items: TtnItem[] = [];
  let open = false;

  for (const line of lines.slice(header ? header.start + 1 : 0)) {
    if (!line.length) continue;
    if (line.some(cell => TOTAL_LINE.test(cell.text))) break;
    const numbers = line.map(cell => ({ cell, value: toNumber(cell.text) })).filter(entry => entry.value !== null) as Array<{ cell: GridCell; value: number }>;
    const words = line.filter(cell => toNumber(cell.text) === null);
    const triple = quantityPriceSum(numbers.map(entry => entry.value));
    const name = words.filter(cell => isText(cell.text) && !UNIT.test(cell.text)
      && (!columns.size || ['name', 'number', null].includes(columnOf(cell, columns))))
      .map(cell => cell.text).join(' ');

    if (!triple) {
      // A wrapped name continues on the next line with no numbers.
      if (open && name && !numbers.length) items[items.length - 1].name += ' ' + name;
      else open = false;
      continue;
    }
    if (!name) { open = false; continue; }

    const used = new Set(numbers.slice(triple.at, triple.at + 3).map(entry => entry.cell));
    const unit = words.find(cell => UNIT.test(cell.text))?.text ?? '';
    const codeCell = line.find(cell => !used.has(cell) && cell.text !== unit && columns.size > 0 && columnOf(cell, columns) === 'code')
      ?? numbers.find(entry => !used.has(entry.cell) && /^\d{5,}$/.test(entry.cell.text.replace(/\s/g, '')))?.cell;
    items.push({
      ...emptyTtnItem(),
      code: codeCell?.text.replace(/\s/g, '') ?? '',
      name,
      unit,
      quantity: triple.quantity,
      price: triple.price,
      sum: round(triple.sum, 2),
      documents: documentLabel,
      packaging: unit,
    });
    open = true;
  }
  return items;
}

export interface WaybillDetails {
  shipper: string;
  consignee: string;
  releasedBy: string;
}

const ORGANIZATION_LABEL = /^организация\s*\(|^предприниматель\)/i;

/**
 * Header of a З-2 waybill: the sender and the receiver organizations, printed in two columns under
 * "…- отправитель" / "…- получатель", and the position above "Отпуск разрешил".
 */
export function waybillDetails(lines: GridLine[]): WaybillDetails {
  const details: WaybillDetails = { shipper: '', consignee: '', releasedBy: '' };
  const labelAt = lines.findIndex(line => line.some(cell => /отправитель|получатель/i.test(cell.text)));
  if (labelAt >= 0) {
    const labelLine = lines[labelAt];
    const column = (pattern: RegExp) => labelLine.find(cell => pattern.test(cell.text));
    // The goods table starts with its "Номер" / "Наименование" header.
    const tableAt = lines.findIndex((line, at) => at > labelAt && line.some(cell => /^номер$|наименование/i.test(cell.text)));
    const end = tableAt > labelAt ? tableAt : labelAt + 6;
    const collect = (label: GridCell | undefined) => {
      if (!label) return '';
      // The name sits under its label.
      return lines.slice(labelAt + 1, end)
        .flatMap(line => line.filter(cell => center(cell) >= label.x - 15 && center(cell) <= label.right + 15 && !ORGANIZATION_LABEL.test(cell.text)))
        .filter(cell => isText(cell.text) && !/^(номер|по|ответственный|транспортная)/i.test(cell.text))
        .map(cell => cell.text).join(' ');
    };
    details.shipper = collect(column(/отправитель/i));
    details.consignee = collect(column(/получатель/i));
  }
  const releasedAt = lines.findIndex(line => line.some(cell => /^отпуск разрешил/i.test(cell.text)));
  if (releasedAt > 0) {
    const position = lines[releasedAt - 1].find(cell => isText(cell.text) && !/прописью|сумм|теңге|тенге/i.test(cell.text));
    if (position && lines[releasedAt - 1].length <= 2) details.releasedBy = position.text;
  }
  return details;
}

/* ---------- Consignees directory ---------- */

/** A receiving company with the requisites 1C takes from its own directory: the waybill only names it. */
export interface TtnConsignee {
  id: string;
  name: string;
  bin?: string;
  address?: string;
  /** Where the goods are unloaded, when it differs from the legal address. */
  unloadingPoint?: string;
  createdAt?: string;
}

/** The consignee as printed on the TTN: "name, БИН …, address". */
export function consigneeLine(consignee: Pick<TtnConsignee, 'name' | 'bin' | 'address'>) {
  return [consignee.name.trim(), consignee.bin?.trim() ? `БИН ${consignee.bin.trim()}` : '', consignee.address?.trim() || '']
    .filter(Boolean).join(', ');
}

/** Company names compared without legal form, quotes and spacing: "ТОО «Альфа Трейд-7»" = "Товарищество … Альфа Трейд-7". */
export function companyKey(name: string) {
  return name.toLowerCase()
    .replace(/товарищество\s+с\s+ограниченной\s+ответственностью/g, ' ')
    // Legal forms as whole words only: "ип" inside "типография" stays.
    .replace(/(^|[^a-zа-яё])(тоо|ип|ао|llp)(?=[^a-zа-яё]|$)/g, '$1 ')
    .replace(/[^0-9a-zа-яёәғқңөұүһі]+/g, '');
}

/** The directory entry for a company named on a waybill, if there is one. */
export function findConsignee(directory: TtnConsignee[], name: string) {
  const key = companyKey(name);
  if (key.length < 3) return undefined;
  return directory.find(entry => companyKey(entry.name) === key)
    ?? directory.find(entry => {
      const entryKey = companyKey(entry.name);
      return entryKey.length >= 3 && (key.includes(entryKey) || entryKey.includes(key));
    });
}
