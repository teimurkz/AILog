import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  Trash2,
  Package
} from 'lucide-react';
import { differenceInDays, parseISO, format } from 'date-fns';
import { useLanguage } from '../../LanguageContext';
import { Shipment, ShipmentStatus } from '../../types';
import { cn } from '../../lib/utils';
import { doc, updateDoc, deleteDoc, collection, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { isShipmentDelayed } from '../../utils/shipmentUtils';
import { useAuth } from '../../contexts/AuthContext';

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDelivering, setIsDelivering] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBulkDeliverConfirm, setShowBulkDeliverConfirm] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  const filtered = shipments.filter(s => {
    const matchesSearch = s.invoice_id.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus ? filterStatus.includes(s.status) : s.status !== 'Delivered';
    return matchesSearch && matchesStatus && !s.isArchived;
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

  return (
    <div className="space-y-6">
      <div className={cn("flex flex-col sm:flex-row items-center justify-between gap-4", isRTL && "flex-row-reverse")}>
        <div className="relative w-full sm:w-96">
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
        <div className={cn("flex items-center gap-3 w-full sm:w-auto", isRTL && "flex-row-reverse")}>
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
            <button 
              onClick={onNew}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/10"
            >
              <Plus className="w-5 h-5" />
              {t('newShipment')}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
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
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('truckId')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('route')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('status')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('progress')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider", isRTL && "text-right")}>{t('lastUpdate')}</th>
                <th className={cn("px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right", isRTL && "text-left")}>{t('action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((s) => {
                const daysPassed = differenceInDays(new Date(), parseISO(s.departure_date));
                const progress = Math.min(Math.max((daysPassed / s.est_travel_time) * 100, 0), 100);
                const isDelayed = isShipmentDelayed(s);

                return (
                  <tr key={s.id} className={cn(
                    "hover:bg-slate-50/50 transition-colors group", 
                    isRTL && "flex-row-reverse",
                    isDelayed && s.status !== 'Delivered' && "bg-red-50/30 hover:bg-red-50/50",
                    selectedIds.has(s.id) && "bg-blue-50/30"
                  )}>
                    <td className="px-6 py-4">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className={cn("flex items-center gap-3", isRTL && "flex-row-reverse")}>
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
                          <Package className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold text-slate-900">{s.invoice_id}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {s.route}
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        s.status === 'In Transit' ? 'bg-blue-50 text-blue-600' :
                        s.status === 'Customs' ? 'bg-indigo-50 text-indigo-600' :
                        s.status === 'Delay' || isDelayed ? 'bg-red-50 text-red-600' :
                        s.status === 'Delivered' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-600'
                      )}>
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          s.status === 'In Transit' ? 'bg-blue-500' :
                          s.status === 'Customs' ? 'bg-indigo-500' :
                          s.status === 'Delay' || isDelayed ? 'bg-red-500' :
                          s.status === 'Delivered' ? 'bg-emerald-500' : 'bg-slate-500'
                        )} />
                        {isDelayed && s.status !== 'Delivered' ? t('delayed') : t(s.status as any)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="w-32">
                        <div className={cn("flex justify-between text-[10px] font-bold text-slate-400 mb-1", isRTL && "flex-row-reverse")}>
                          <span>{Math.round(progress)}%</span>
                          <span>{daysPassed} {t('daysPassed')}</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-500",
                              isDelayed && s.status !== 'Delivered' ? 'bg-red-500' : 'bg-blue-600'
                            )}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {format(parseISO(s.last_updated), 'MMM d, HH:mm')}
                    </td>
                    <td className={cn("px-6 py-4 text-right", isRTL && "text-left")}>
                      <button 
                        onClick={() => onSelect(s)}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                      >
                        <ChevronRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
