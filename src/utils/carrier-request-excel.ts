import * as XLSX from 'xlsx';
import type { CarrierRequest } from '../../shared/carrier-request';
import { formatRegionalDay, regionalLocale, regionalTexts } from '../components/regional/regional-i18n';

/** Two sheets for a transport company: trucks needed per route and truck type, then every order. */
export function carrierRequestWorkbook(request: CarrierRequest, language: string, now = new Date()) {
  const texts = regionalTexts(language);
  const c = texts.carrier;
  const locale = regionalLocale(language);
  const day = (value: string) => formatRegionalDay(value, locale);

  const directions = XLSX.utils.aoa_to_sheet([
    [c.title],
    [c.created, now.toLocaleString(locale)],
    [c.ordersCount, request.rows.length],
    [c.note],
    [],
    [c.direction, c.truckType, c.trucks, c.firstLoading, c.orderNumbers],
    ...request.directions.map(group => [group.route, group.truckType, group.trucks, group.firstDate ? day(group.firstDate) : '', group.orderNumbers.join(', ')]),
    [c.total, '', request.rows.length],
  ]);
  directions['!cols'] = [44, 30, 10, 20, 40].map(wch => ({ wch }));

  const orders = XLSX.utils.aoa_to_sheet([
    [c.orderNo, c.loadingDate, c.from, c.to, c.unloading, c.truckType, c.pallets, c.weight, c.cargo, c.comment],
    ...request.rows.map(row => [row.orderNumber, row.loadingDate ? day(row.loadingDate) : texts.common.notSpecifiedDate,
      row.origin, row.destination, row.unloading.join('\n'), row.truckType, row.pallets, row.weight, row.cargo, row.comment]),
  ]);
  orders['!cols'] = [14, 14, 18, 18, 50, 28, 10, 12, 36, 40].map(wch => ({ wch }));
  orders['!autofilter'] = { ref: `A1:J${request.rows.length + 1}` };

  const workbook = XLSX.utils.book_new();
  // Persian sheets read right to left in Excel.
  if (language === 'fa') workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, directions, c.directionsSheet);
  XLSX.utils.book_append_sheet(workbook, orders, c.ordersSheet);
  return workbook;
}

export function downloadCarrierRequest(request: CarrierRequest, language: string) {
  XLSX.writeFile(carrierRequestWorkbook(request, language), `Zayavki_perevozchiku_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
