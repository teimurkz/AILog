import * as XLSX from 'xlsx';
import { formatRegionalReportDate, type RegionalOrdersReport, type RegionalReportFilters } from '../../shared/regional-orders-report';

export function regionalReportWorkbook(report: RegionalOrdersReport, filters: RegionalReportFilters) {
  const period = filters.from && filters.to ? `${formatRegionalReportDate(filters.from)} — ${formatRegionalReportDate(filters.to)}` :
    filters.from ? `С ${formatRegionalReportDate(filters.from)}` : filters.to ? `По ${formatRegionalReportDate(filters.to)}` : 'За всё время';
  const summary = XLSX.utils.aoa_to_sheet([
    ['Отчёт по отправленным машинам в регионы'],
    ['Период', period],
    ['Город назначения', filters.destination || 'Все города'],
    ['Статус', filters.status === 'dispatched' ? 'В пути' : filters.status === 'delivered' ? 'Доставлено' : 'В пути и доставлено'],
    ['Количество машин (рейсов)', report.total],
    ['В пути', report.dispatched], ['Доставлено', report.delivered],
    ['Рейсов с датой отгрузки из заявки вместо фактической даты', report.shipmentDates],
    ['Рейсов без даты в отчёте', report.undated],
    ['Без даты, исключены из выбранного периода', report.undatedExcluded],
    ['Правило подсчёта', 'Одна заявка — один рейс. Даты отправки: Asia/Almaty.'],
    [],
    ['Направление', 'Машин (рейсов)', 'В пути', 'Доставлено', 'Первая отправка', 'Последняя отправка'],
    ...report.directions.map(group => [group.route, group.count, group.dispatched, group.delivered,
      group.firstDate ? formatRegionalReportDate(group.firstDate) : '', group.lastDate ? formatRegionalReportDate(group.lastDate) : '']),
    ['ИТОГО', report.total, report.dispatched, report.delivered],
  ]);
  summary['!cols'] = [{ wch: 62 }, { wch: 27 }, { wch: 15 }, { wch: 17 }, { wch: 22 }, { wch: 22 }];
  const details = XLSX.utils.aoa_to_sheet([
    ['Дата отправки', 'Источник даты', '№ заявки', 'Направление', 'Госномер', 'Водитель', 'Статус', 'Накладная', 'Менеджер', 'ID заявки'],
    ...report.rows.map(row => [row.date ? formatRegionalReportDate(row.date) : '',
      row.dateSource === 'actual' ? 'Фактическая отправка' : row.dateSource === 'shipment' ? 'Дата отгрузки из заявки' : 'Не указана',
      row.orderNumber, row.route, row.plate, row.driver, row.status === 'dispatched' ? 'В пути' : 'Доставлено', row.invoice, row.manager, row.id]),
  ]);
  details['!cols'] = [20, 28, 20, 45, 25, 42, 18, 32, 32, 30].map(wch => ({ wch }));
  details['!autofilter'] = { ref: `A1:J${report.rows.length + 1}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summary, 'Сводка по направлениям');
  XLSX.utils.book_append_sheet(workbook, details, 'Отправленные машины');
  return workbook;
}

export function downloadRegionalReport(report: RegionalOrdersReport, filters: RegionalReportFilters) {
  XLSX.writeFile(regionalReportWorkbook(report, filters), `Regional_Trucks_${filters.from || 'all'}_${filters.to || 'all'}.xlsx`);
}
