import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  ChevronDown,
  ChevronUp,
  Trash2,
  Package,
  Upload,
  Clock,
  FileSpreadsheet
} from 'lucide-react';
import { differenceInDays, parseISO, format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useLanguage } from '../../contexts/LanguageContext';
import { Shipment, ShipmentStatus } from '../../types';
import { cn } from '../../lib/utils';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { ExcelImport } from '../admin/ExcelImport';

interface ShipmentListProps {
  shipments: Shipment[];
  onSelect: (s: Shipment) => void;
  onNew: () => void;
  filterStatus?: ShipmentStatus[];
}

export const ShipmentList = ({ shipments, onSelect, onNew, filterStatus }: ShipmentListProps) => {
  const { t, isRTL } = useLanguage();
  const { isAdmin, isLogistics } = useAuth();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'invoiceAsc' | 'invoiceDesc' | 'departureDate' | 'itemsAsc' | 'itemsDesc'>('newest');
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | 'All'>('All');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isDelivering, setIsDelivering] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBulkDeliverConfirm, setShowBulkDeliverConfirm] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  const filtered = shipments
    .filter(s => {
      const searchTerms = search.toLowerCase();
      const matchesSearch = 
        s.invoice_id.toLowerCase().includes(searchTerms) || 
        (s.driver_name || '').toLowerCase().includes(searchTerms) ||
        (s.driver_phone || '').toLowerCase().includes(searchTerms) ||
        (s.plate_number || '').toLowerCase().includes(searchTerms) ||
        (s.goods || '').toLowerCase().includes(searchTerms) ||
        (s.destination || '').toLowerCase().includes(searchTerms) ||
        (s.items || []).some(item => item.toLowerCase().includes(searchTerms));

      const effectiveFilter = filterStatus ? filterStatus : (statusFilter !== 'All' ? [statusFilter as ShipmentStatus] : undefined);
      const matchesStatus = effectiveFilter ? effectiveFilter.includes(s.status) : s.status !== 'Delivered';
      return matchesSearch && matchesStatus && !s.isArchived;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return parseISO(b.last_updated).getTime() - parseISO(a.last_updated).getTime();
        case 'oldest':
          return parseISO(a.last_updated).getTime() - parseISO(b.last_updated).getTime();
        case 'invoiceAsc':
          return a.invoice_id.localeCompare(b.invoice_id);
        case 'invoiceDesc':
          return b.invoice_id.localeCompare(a.invoice_id);
        case 'departureDate':
          return parseISO(b.departure_date).getTime() - parseISO(a.departure_date).getTime();
        case 'itemsAsc':
          return (a.items || []).join(', ').localeCompare((b.items || []).join(', '));
        case 'itemsDesc':
          return (b.items || []).join(', ').localeCompare((a.items || []).join(', '));
        default:
          return 0;
      }
    });

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(s => s.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulkDeliver = async () => {
    if (!isLogistics) return;
    setIsDelivering(true);
    try {
      for (const id of Array.from(selectedIds) as string[]) {
        await updateDoc(doc(db, 'shipments', id), {
          status: 'Delivered',
          last_updated: new Date().toISOString(),
          actual_arrival_date: new Date().toISOString()
        });
      }
      setSelectedIds(new Set());
      setShowBulkDeliverConfirm(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'shipments');
    } finally {
      setIsDelivering(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!isAdmin) return;
    setIsDeleting(true);
    try {
      for (const id of Array.from(selectedIds) as string[]) {
        await deleteDoc(doc(db, 'shipments', id));
      }
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'shipments');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExport = () => {
    const exportData = filtered.map(s => ({
      'Order Name': s.invoice_id,
      'Неделя': s.week || '',
      'Тип': s.shipment_type || '',
      'Назначение': s.destination || s.route || '',
      'Груз': s.goods || (s.items || []).join(', '),
      'Водитель': s.driver_name || '',
      'Телефон': s.driver_phone || '',
      'Госномер': s.plate_number || '',
      'L DATE (Загрузка)': s.loading_date || (s.departure_date ? format(parseISO(s.departure_date), 'dd.MM.yyyy') : ''),
      'Ex Border Date': s.ex_border_date || '',
      'A To Destination Customs (СВХ)': s.customs_arrival_date || (s.customs_date ? format(parseISO(s.customs_date), 'dd.MM.yyyy') : ''),
      'Unl Date (Выгрузка)': s.unl_date || (s.actual_arrival_date ? format(parseISO(s.actual_arrival_date), 'dd.MM.yyyy') : ''),
      'T.T (Время в пути)': s.transit_time || '',
      'Статус': t(s.status as any)
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shipments");
    XLSX.writeFile(wb, `SilkRoad_Shipments_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className={cn("flex flex-col gap-4")}>
        <div className={cn("flex flex-col md:flex-row items-center justify-between gap-4", isRTL && "md:flex-row-reverse")}>
          <div className="relative w-full md:flex-1">
            <Search className={cn("absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400", isRTL ? "right-4" : "left-4")} />
            <input 
              type="text"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(
                "w-full bg-white border border-slate-200 rounded-2xl py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm",
                isRTL ? "pr-12 pl-4 text-right" : "pl-12 pr-4 text-left"
              )}
            />
          </div>

          <div className={cn("flex flex-wrap items-center gap-3 w-full md:w-auto", isRTL && "flex-row-reverse")}>
            <div className="flex-1 md:flex-none">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className={cn(
                  "w-full px-4 py-2.5 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-sm",
                  isRTL && "text-right"
                )}
              >
                <option value="newest">{t('newest')}</option>
                <option value="oldest">{t('oldest')}</option>
                <option value="invoiceAsc">{t('invoiceAsc')}</option>
                <option value="invoiceDesc">{t('invoiceDesc')}</option>
                <option value="departureDate">{t('departureDateSort')}</option>
                <option value="itemsAsc">{t('itemsAsc')}</option>
                <option value="itemsDesc">{t('itemsDesc')}</option>
              </select>
            </div>

            {!filterStatus && (
              <div className="flex-1 md:flex-none">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className={cn(
                    "w-full px-4 py-2.5 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-sm",
                    isRTL && "text-right"
                  )}
                >
                  <option value="All">{t('all')}</option>
                  <option value="In Transit">{t('In Transit')}</option>
                  <option value="Customs">{t('Customs')}</option>
                  <option value="Delay">{t('Delay')}</option>
                  <option value="Delivered">{t('Delivered')}</option>
                </select>
              </div>
            )}
          </div>
        </div>

        <div className={cn("flex items-center gap-3 w-full justify-end flex-wrap", isRTL && "flex-row-reverse")}>
          <button 
            onClick={handleExport}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
          >
            <FileSpreadsheet className="w-5 h-5" />
            Excel
          </button>
          
          {selectedIds.size > 0 && isLogistics && (
            <>
              <button 
                onClick={() => setShowBulkDeliverConfirm(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-50 text-emerald-600 font-bold rounded-xl hover:bg-emerald-100 transition-colors"
              >
                <CheckCircle2 className="w-5 h-5" />
                {t('delivered')} ({selectedIds.size})
              </button>
              {isAdmin && (
                <button 
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                  {t('delete')} ({selectedIds.size})
                </button>
              )}
            </>
          )}
          {!filterStatus && isLogistics && (
            <>
              <button 
                onClick={() => setShowExcelImport(!showExcelImport)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 font-semibold rounded-xl transition-all shadow-lg",
                  showExcelImport 
                    ? "bg-slate-700 hover:bg-slate-800 text-white shadow-slate-900/10" 
                    : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-950/10"
                )}
              >
                <Upload className="w-5 h-5" />
                {t('importExcel')}
              </button>
              <button 
                onClick={onNew}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/10"
              >
                <Plus className="w-5 h-5" />
                {t('newShipment')}
              </button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showExcelImport && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <ExcelImport />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Desktop View */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className={cn("bg-slate-50 border-b border-slate-100", isRTL && "flex-row-reverse")}>
                <th className="px-6 py-4 w-10">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('orderName')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('loadingDate')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('transitTime')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('customsArrival')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right", isRTL && "text-left")}>{t('shipmentDetails')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => {
                const isExpanded = expandedIds.has(s.id);
                const daysPassed = differenceInDays(new Date(), parseISO(s.departure_date));
                const loadingDateDisplay = s.loading_date || (s.departure_date ? format(parseISO(s.departure_date), 'dd.MM.yyyy') : '-');
                const ttDisplay = s.transit_time ? `${s.transit_time} дн.` : `${daysPassed} дн.`;
                
                const hasCustomsArrival = !!s.customs_arrival_date || s.status === 'Customs' || !!s.customs_date;
                const isDelivered = s.status === 'Delivered' || !!s.unl_date || !!s.actual_arrival_date;

                return (
                  <React.Fragment key={s.id}>
                    <tr 
                      onClick={() => toggleExpand(s.id)}
                      className={cn(
                        "hover:bg-slate-50/80 transition-colors cursor-pointer group", 
                        isRTL && "flex-row-reverse",
                        selectedIds.has(s.id) && "bg-blue-50/30",
                        isExpanded && "bg-blue-50/20"
                      )}
                    >
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox" 
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className={cn("flex items-center gap-3", isRTL && "flex-row-reverse")}>
                          <div className="w-9 h-9 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold">
                            <Package className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{s.invoice_id}</p>
                            {s.shipment_type && <p className="text-[11px] text-slate-400 font-medium">{s.shipment_type}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-700">
                        {loadingDateDisplay}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-700">
                        {ttDisplay}
                      </td>
                      <td className="px-6 py-4">
                        {isDelivered ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            {t('unloaded')} ({s.unl_date || (s.actual_arrival_date ? format(parseISO(s.actual_arrival_date), 'dd.MM') : t('delivered'))})
                          </span>
                        ) : hasCustomsArrival ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                            {t('arrivedCustoms')} ({s.customs_arrival_date || (s.customs_date ? format(parseISO(s.customs_date), 'dd.MM') : t('customs'))})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-100">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            {t('inTransitCustoms')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => toggleExpand(s.id)}
                            className={cn(
                              "px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1",
                              isExpanded ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            )}
                          >
                            {isExpanded ? (
                              <>{t('collapse')} <ChevronUp className="w-4 h-4" /></>
                            ) : (
                              <>{t('expandDetails')} <ChevronDown className="w-4 h-4" /></>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded Row Details */}
                    {isExpanded && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={6} className="px-6 py-4">
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                              <div className="flex items-center gap-3">
                                <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-lg">
                                  Order Name: {s.invoice_id}
                                </span>
                                {s.week && (
                                  <span className="text-xs font-semibold text-slate-500">
                                    {t('week')}: {s.week}
                                  </span>
                                )}
                              </div>
                              <button 
                                onClick={() => onSelect(s)}
                                className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2"
                              >
                                <span>{t('fullCardDocs')}</span>
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('shipmentType')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.shipment_type || '-'}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('destination')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.destination || s.route || '-'}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('goods')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.goods || (s.items && s.items.length > 0 ? s.items.join(', ') : '-')}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('driver')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.driver_name || '-'}</p>
                              </div>

                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('driverPhone')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.driver_phone || '-'}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('plateNumber')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.plate_number || '-'}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('loadingDate')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.loading_date || (s.departure_date ? format(parseISO(s.departure_date), 'dd.MM.yyyy') : '-')}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('exBorderDate')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.ex_border_date || '-'}</p>
                              </div>

                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('customsArrival')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.customs_arrival_date || (s.customs_date ? format(parseISO(s.customs_date), 'dd.MM.yyyy') : '-')}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('unlDate')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.unl_date || (s.actual_arrival_date ? format(parseISO(s.actual_arrival_date), 'dd.MM.yyyy') : '-')}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('transitTime')}</p>
                                <p className="text-xs font-bold text-slate-800 mt-0.5">{s.transit_time ? `${s.transit_time} ${t('days')}` : `${daysPassed} ${t('days')}`}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('currentStatus')}</p>
                                <p className="text-xs font-bold text-blue-600 mt-0.5">{t(s.status as any)}</p>
                              </div>
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile View */}
        <div className="lg:hidden divide-y divide-slate-100">
          {filtered.map((s) => {
            const isExpanded = expandedIds.has(s.id);
            const daysPassed = differenceInDays(new Date(), parseISO(s.departure_date));
            const loadingDateDisplay = s.loading_date || (s.departure_date ? format(parseISO(s.departure_date), 'dd.MM.yyyy') : '-');
            const ttDisplay = s.transit_time ? `${s.transit_time} дн.` : `${daysPassed} дн.`;
            const hasCustomsArrival = !!s.customs_arrival_date || s.status === 'Customs' || !!s.customs_date;
            const isDelivered = s.status === 'Delivered' || !!s.unl_date || !!s.actual_arrival_date;

            return (
              <div key={s.id} className="p-4 space-y-3">
                <div 
                  onClick={() => toggleExpand(s.id)}
                  className="flex items-start justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(s.id)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 font-bold shrink-0">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{s.invoice_id}</p>
                      <p className="text-xs text-slate-500">Загрузка: {loadingDateDisplay} | Путь: {ttDisplay}</p>
                    </div>
                  </div>
                  <button className="p-1.5 text-slate-400 hover:text-blue-600">
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1">
                  {isDelivered ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      Выгружен ({s.unl_date || 'Доставлен'})
                    </span>
                  ) : hasCustomsArrival ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      <CheckCircle2 className="w-3 h-3 text-indigo-600" />
                      На СВХ ({s.customs_arrival_date || 'СВХ'})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100">
                      <Clock className="w-3 h-3 text-amber-600" />
                      В пути
                    </span>
                  )}

                  <button 
                    onClick={() => toggleExpand(s.id)}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    {isExpanded ? 'Свернуть' : 'Провалиться'}
                  </button>
                </div>

                {isExpanded && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="bg-slate-50 p-4 rounded-xl space-y-3 pt-3 border border-slate-100"
                  >
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Водитель</p>
                        <p className="font-semibold text-slate-800">{s.driver_name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Телефон</p>
                        <p className="font-semibold text-slate-800">{s.driver_phone || '-'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Госномер</p>
                        <p className="font-semibold text-slate-800">{s.plate_number || '-'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Груз</p>
                        <p className="font-semibold text-slate-800">{s.goods || '-'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Граница</p>
                        <p className="font-semibold text-slate-800">{s.ex_border_date || '-'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Приход СВХ</p>
                        <p className="font-semibold text-slate-800">{s.customs_arrival_date || '-'}</p>
                      </div>
                    </div>

                    <button 
                      onClick={() => onSelect(s)}
                      className="w-full py-2 bg-slate-900 text-white font-bold text-xs rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-1 mt-2"
                    >
                      <span>Полная карточка & Документы</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bulk Deliver Confirmation Modal */}
      <AnimatePresence>
        {showBulkDeliverConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6"
            >
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-4 mx-auto">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">{t('delivered')}</h3>
              <p className="text-slate-500 text-center text-sm mb-6">
                Mark {selectedIds.size} {t('truckId')} as delivered?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowBulkDeliverConfirm(false)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleBulkDeliver}
                  disabled={isDelivering}
                  className="flex-1 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {isDelivering ? '...' : t('delivered')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk Delete Confirmation Modal */}
      <AnimatePresence>
        {showBulkDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6"
            >
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mb-4 mx-auto">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">{t('delete')}</h3>
              <p className="text-slate-500 text-center text-sm mb-6">
                {t('confirmDelete')} ({selectedIds.size} {t('truckId')})
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowBulkDeleteConfirm(false)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {isDeleting ? '...' : t('delete')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
