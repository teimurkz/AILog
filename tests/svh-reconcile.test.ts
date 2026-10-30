import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STAGES } from '../shared/truck-tracking';
import { parkingDays, parsePartnerSheet, partnerDate, partnerInvoice, reconcile } from '../shared/svh-reconcile';

const today = '2026-10-30';
const serial = (day: string) => Math.round((Date.parse(day) - Date.UTC(1899, 11, 30)) / 86400000);
const header = ['№№  п/п', 'ДАТА ПОДАЧИ НА ТУПИК СВХ', 'Рег. номер', 'Декларация', 'инвойс ', 'Страна', 'Получатель', '№ Т/С', 'Наименование товара',
  'Мест', 'Брутто', 'Нетто', 'Преадресация', 'ДХТ', 'ДАТА РАСТАМОЖКИ', 'Дата перемещения на ком склад ', 'Дата выгрузки на СВХ'];
const row = (no: number, arrived: unknown, invoice: string, moved: unknown, unloaded: unknown) => {
  const cells: unknown[] = Array(17).fill(null);
  cells[0] = no; cells[1] = arrived; cells[4] = invoice; cells[7] = '97AA1/97AA2'; cells[8] = 'Молоко 1л 3%'; cells[15] = moved; cells[16] = unloaded;
  return cells;
};

test('partner dates: Excel dates, US text, typos and implausible years', () => {
  assert.equal(partnerDate(serial('2026-09-21'), today).day, '2026-09-21');
  assert.equal(partnerDate('9/28/26', today).day, '2026-09-28');
  assert.equal(partnerDate('28.09.2026', today).day, '2026-09-28');
  assert.equal(partnerDate('29//10/2026', today).day, '2026-10-29');
  assert.equal(partnerDate('22.092026', today).day, '2026-09-22');
  assert.deepEqual(partnerDate('вопрос????', today), { day: null, raw: 'вопрос????', bad: true });
  assert.equal(partnerDate('10/19/20', today).bad, true);
  assert.deepEqual(partnerDate(null, today), { day: null, raw: '', bad: false });
});

test('invoice number is taken after the dash', () => {
  assert.equal(partnerInvoice('20260903-351'), '351');
  assert.equal(partnerInvoice('320261004-469'), '469');
  assert.equal(partnerInvoice('471'), '471');
  assert.equal(partnerInvoice(''), null); assert.equal(partnerInvoice('29214434'), null);
});

test('parking runs from arrival to unloading, else to moving, else until today', () => {
  assert.deepEqual(parkingDays('2026-10-10', '2026-10-20', null, today), { days: 10, open: false });
  assert.deepEqual(parkingDays('2026-10-10', null, '2026-10-15', today), { days: 5, open: false });
  assert.deepEqual(parkingDays('2026-10-25', null, null, today), { days: 5, open: true });
});

test('sheet parsing skips month rows and reconciles with "Слежка авто"', () => {
  const sheet = [
    header,
    row(1, '9/21/26', '20260903-351', '10/3/26', '9/28/26'),
    [null, null, null, null, 'ОКТЯБРЬ 2026г'],
    row(2, serial('2026-10-03'), '20260914-398', null, serial('2026-10-08')),
    row(3, '10/12/26', '20260924-436', 'вопрос????', '10/19/20'),
    row(4, '10/13/26', '20260922-999', null, null),
    row(5, '10/14/26', '', null, null),
  ];
  const partner = parsePartnerSheet(sheet, today);
  assert.deepEqual(partner.map(item => item.no), ['1', '2', '3', '4', '5']);

  const entries = [
    { id: 'a', invoice: '351', productName: 'Cream', status: 'moved', stageDates: { arrived: '2026-09-21', unloaded: '2026-09-28', moved: '2026-10-03' } },
    { id: 'b', invoice: 'Mehkaz 398', productName: 'Milk', status: 'unloaded', stageDates: { arrived: '2026-10-04', unloaded: '2026-10-08' } },
    { id: 'c', invoice: '436', productName: 'Cheese', status: 'arrived', stageDates: { arrived: '2026-10-12' } },
    { id: 'd', invoice: '500', productName: 'Butter', status: 'arrived', stageDates: { arrived: '2026-10-05' } },
  ];
  const { rows, missing, summary } = reconcile(partner, entries, DEFAULT_STAGES, today);
  assert.deepEqual(rows.map(item => item.status), ['ok', 'mismatch', 'mismatch', 'not-found', 'no-invoice']);
  assert.equal(rows[0].partnerDays, 7); assert.equal(rows[0].diff, 0);
  // Partner says arrival 03.10, we recorded 04.10: one day more to pay.
  assert.match(rows[1].issues[0], /Заезд: у партнёра 03\.10\.2026, в CRM 04\.10\.2026 \(-1 дн\.\)/);
  assert.equal(rows[1].partnerDays, 5); assert.equal(rows[1].crmDays, 4); assert.equal(rows[1].diff, 1);
  assert.ok(rows[2].issues.some(issue => issue.includes('непонятная дата «вопрос????»')));
  assert.equal(rows[2].partnerDays, null); // unreadable end dates: no guessed parking days
  assert.match(rows[3].issues[0], /Инвойса 999 нет/);
  assert.deepEqual(missing.map(item => item.invoice), ['500']);
  assert.equal(summary.ok, 1); assert.equal(summary.mismatch, 2); assert.equal(summary.notFound, 1); assert.equal(summary.noInvoice, 1);
});
