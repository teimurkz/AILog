import * as XLSX from 'xlsx';
import type { RegionalOrdersReport, RegionalReportFilters } from '../../shared/regional-orders-report';
import { formatRegionalDay, localizeReportRoute, regionalLocale, regionalTexts } from '../components/regional/regional-i18n';

export function regionalReportWorkbook(report: RegionalOrdersReport, filters: RegionalReportFilters, language: string) {
  const texts = regionalTexts(language);
  const { report: r, excel: x } = texts;
  const day = (date: string) => formatRegionalDay(date, regionalLocale(language));
  const status = (value: 'dispatched' | 'delivered') => value === 'dispatched' ? r.dispatched : r.delivered;
  const period = filters.from && filters.to ? `${day(filters.from)} — ${day(filters.to)}` :
    filters.from ? x.periodFrom(day(filters.from)) : filters.to ? x.periodTo(day(filters.to)) : r.allTime;
  const summary = XLSX.utils.aoa_to_sheet([
    [x.title],
    [x.period, period],
    [r.destination, filters.destination || r.allCities],
    [r.status, filters.status === 'dispatched' || filters.status === 'delivered' ? status(filters.status) : r.statusAll],
    [x.trucksCount, report.total],
    [r.dispatched, report.dispatched], [r.delivered, report.delivered],
    [x.shipmentDates, report.shipmentDates],
    [x.undated, report.undated],
    [x.undatedExcluded, report.undatedExcluded],
    [x.rule, x.ruleText],
    [],
    [r.direction, r.trucks, r.dispatched, r.delivered, r.firstDispatch, r.lastDispatch],
    ...report.directions.map(group => [localizeReportRoute(group.route, texts), group.count, group.dispatched, group.delivered,
      group.firstDate ? day(group.firstDate) : '', group.lastDate ? day(group.lastDate) : '']),
    [x.total, report.total, report.dispatched, report.delivered],
  ]);
  summary['!cols'] = [{ wch: 62 }, { wch: 27 }, { wch: 15 }, { wch: 17 }, { wch: 22 }, { wch: 22 }];
  const details = XLSX.utils.aoa_to_sheet([
    [r.dispatchDate, x.dateSource, r.orderNo, r.direction, r.plate, r.driver, r.status, x.invoice, x.manager, x.orderId],
    ...report.rows.map(row => [row.date ? day(row.date) : '',
      row.dateSource === 'actual' ? x.sourceActual : row.dateSource === 'shipment' ? x.sourceShipment : texts.common.notSpecifiedDate,
      row.orderNumber, localizeReportRoute(row.route, texts), row.plate, row.driver, status(row.status), row.invoice, row.manager, row.id]),
  ]);
  details['!cols'] = [20, 28, 20, 45, 25, 42, 18, 32, 32, 30].map(wch => ({ wch }));
  details['!autofilter'] = { ref: `A1:J${report.rows.length + 1}` };
  const workbook = XLSX.utils.book_new();
  // Persian sheets read right to left in Excel.
  if (language === 'fa') workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, summary, x.summarySheet);
  XLSX.utils.book_append_sheet(workbook, details, x.detailsSheet);
  return workbook;
}

export function downloadRegionalReport(report: RegionalOrdersReport, filters: RegionalReportFilters, language: string) {
  XLSX.writeFile(regionalReportWorkbook(report, filters, language), `Regional_Trucks_${filters.from || 'all'}_${filters.to || 'all'}.xlsx`);
}
