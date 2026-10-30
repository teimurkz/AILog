import {
  LayoutDashboard, Package, Archive, Warehouse, CalendarClock, Send, BookOpen, Mail, BarChart3, ScanEye,
} from 'lucide-react';
import type { CrmSection } from '../../../shared/access-policy';

/** Menu order, icons and labels of the CRM sections (the access policy lists the same ids). */
export const SECTION_MENU: { id: CrmSection; icon: typeof Package; labelKey: string; fallback: string }[] = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'dashboard', fallback: 'Обзор' },
  { id: 'shipments', icon: Package, labelKey: 'shipments', fallback: 'Отправления' },
  { id: 'truck-tracking', icon: ScanEye, labelKey: 'truckTracking', fallback: 'Слежка авто' },
  { id: 'regional-orders', icon: Send, labelKey: 'regionalOrders', fallback: 'Региональные рейсы' },
  { id: 'directories', icon: BookOpen, labelKey: 'directories', fallback: 'Справочники' },
  { id: 'warehouses', icon: Warehouse, labelKey: 'warehouses', fallback: 'Склады' },
  { id: 'auto-mailing', icon: Mail, labelKey: 'autoMailing', fallback: 'Авто-рассылка Excel' },
  { id: 'analytics-reports', icon: BarChart3, labelKey: 'analyticsReports', fallback: 'Аналитика и отчёты' },
  { id: 'kusto-stock-expiry', icon: CalendarClock, labelKey: 'kustoStockExpiry', fallback: 'Остатки по срокам Кусто' },
  { id: 'archive', icon: Archive, labelKey: 'archive', fallback: 'Архив' },
];
