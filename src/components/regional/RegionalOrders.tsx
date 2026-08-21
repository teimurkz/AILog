import React, { useState, useEffect } from 'react';
import { 
  Truck, 
  Plus, 
  Search, 
  MapPin, 
  FileText, 
  Calendar, 
  Package, 
  User, 
  Phone, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Bell, 
  BellRing, 
  Volume2, 
  ExternalLink, 
  Eye, 
  X, 
  LayoutGrid, 
  List, 
  Filter, 
  Check, 
  Edit3, 
  Trash2, 
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  Download,
  Printer,
  Map,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useRegionalOrders, playNotificationSound, triggerBrowserPush } from '../../hooks/useRegionalOrders';
import { RegionalTruckOrder, RegionalOrderStatus, InvoiceItem, DeliveryPoint } from '../../types';
import { NewRegionalOrderModal } from './NewRegionalOrderModal';

const STATUS_CONFIG: Record<RegionalOrderStatus, { label: string; bg: string; text: string; border: string; icon: React.FC<{ className?: string }> }> = {
  new: {
    label: 'Новая заявка',
    bg: 'bg-amber-50 dark:bg-amber-950/50',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800',
    icon: BellRing,
  },
  assigned: {
    label: 'Назначена фура',
    bg: 'bg-blue-50 dark:bg-blue-950/50',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-800',
    icon: Truck,
  },
  loading: {
    label: 'На погрузке',
    bg: 'bg-indigo-50 dark:bg-indigo-950/50',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-200 dark:border-indigo-800',
    icon: Package,
  },
  dispatched: {
    label: 'В пути в регион',
    bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-800',
    icon: Clock,
  },
  delivered: {
    label: 'Доставлено',
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-700',
    icon: CheckCircle2,
  },
  cancelled: {
    label: 'Отменено',
    bg: 'bg-red-50 dark:bg-red-950/50',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
    icon: AlertCircle,
  },
};

export const RegionalOrders: React.FC = () => {
  const { t } = useLanguage();
  const { user, isAdmin, isLogistics } = useAuth();
  const { 
    orders, 
    loading, 
    addOrder, 
    updateOrderStatus, 
    deleteOrder, 
    lastNewOrderAlert, 
    dismissAlert 
  } = useRegionalOrders();

  const canDeleteOrder = (order: RegionalTruckOrder) => {
    return isAdmin || isLogistics || (!!user?.email && order.createdByEmail === user.email);
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [selectedCityFilter, setSelectedCityFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');

  // Push Permission State
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  // Modal for Viewing Attached Invoice Document or Digital Spec
  const [activeInvoicePreview, setActiveInvoicePreview] = useState<{
    title: string;
    orderNumber: string;
    invoiceNumber: string;
    destinationCity: string;
    deliveryAddress?: string;
    recipientPhone?: string;
    deliveryPoints?: DeliveryPoint[];
    invoices?: InvoiceItem[];
    shipmentDate: string;
    truckType: string;
    palletsCount?: string;
    weight?: string;
    cargoDescription?: string;
    managerName: string;
    managerPhone?: string;
    comments?: string;
    assignedTruckPlate?: string;
    assignedDriver?: string;
    fileName?: string;
    fileData?: string;
    fileType?: string;
  } | null>(null);

  // Modal for Assigning Truck / Updating Details
  const [editingOrder, setEditingOrder] = useState<RegionalTruckOrder | null>(null);
  const [assignedTruckPlate, setAssignedTruckPlate] = useState('');
  const [assignedDriver, setAssignedDriver] = useState('');
  const [editStatus, setEditStatus] = useState<RegionalOrderStatus>('new');

  const requestPushPermission = async () => {
    // 1. Always play audio chime feedback
    playNotificationSound();

    // 2. Mark state as active/granted
    setPushPermission('granted');

    // 3. Show clear toast alert
    setNotificationToast('🔔 Пуш-уведомления и звуковое оповещение логистики включены! При создании новых заявок вы услышите сигнал.');
    setTimeout(() => setNotificationToast(null), 6000);

    // 4. Try native browser push permission
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        const res = await Notification.requestPermission();
        if (res === 'granted') {
          triggerBrowserPush(
            '🔔 Пуш-уведомления логистики включены!',
            'Вы будете мгновенно получать уведомления при размещении новых заявок на фуры.'
          );
        }
      }
    } catch (e) {
      console.warn("Native push permission request inside iframe:", e);
    }
  };

  // Filtered Orders Calculation
  const filteredOrders = orders.filter((order) => {
    if (selectedStatusFilter !== 'all' && order.status !== selectedStatusFilter) {
      return false;
    }
    if (selectedCityFilter !== 'all' && order.destinationCity !== selectedCityFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchCity = order.destinationCity.toLowerCase().includes(q);
      const matchInv = order.invoiceNumber.toLowerCase().includes(q);
      const matchManager = order.managerName.toLowerCase().includes(q);
      const matchCargo = (order.cargoDescription || '').toLowerCase().includes(q);
      const matchTruck = (order.assignedTruckPlate || '').toLowerCase().includes(q);
      const matchNum = (order.orderNumber || '').toLowerCase().includes(q);
      return matchCity || matchInv || matchManager || matchCargo || matchTruck || matchNum;
    }
    return true;
  });

  // Unique cities list for filter dropdown
  const uniqueCities = Array.from(new Set(orders.map(o => o.destinationCity))).filter(Boolean);

  // Metrics
  const totalCount = orders.length;
  const newCount = orders.filter(o => o.status === 'new').length;
  const activeCount = orders.filter(o => o.status === 'assigned' || o.status === 'loading').length;
  const dispatchedCount = orders.filter(o => o.status === 'dispatched').length;

  const handleOpenEdit = (order: RegionalTruckOrder) => {
    setEditingOrder(order);
    setEditStatus(order.status);
    setAssignedTruckPlate(order.assignedTruckPlate || '');
    setAssignedDriver(order.assignedDriver || '');
  };

  const handleSaveEdit = async () => {
    if (!editingOrder) return;
    try {
      let finalStatus = editStatus;
      if (editStatus === 'new' && (assignedTruckPlate.trim() || assignedDriver.trim())) {
        finalStatus = 'assigned';
      }
      await updateOrderStatus(editingOrder.id, finalStatus, {
        assignedTruckPlate: assignedTruckPlate.trim(),
        assignedDriver: assignedDriver.trim(),
      });
      setEditingOrder(null);
    } catch (e) {
      console.error("Save edit error:", e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Toast Banner for Push / Sound Confirmation */}
      <AnimatePresence>
        {notificationToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="p-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl shadow-xl flex items-center justify-between border border-emerald-400"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
                <BellRing className="w-5 h-5 text-white" />
              </div>
              <p className="font-bold text-xs sm:text-sm">
                {notificationToast}
              </p>
            </div>
            <button
              onClick={() => setNotificationToast(null)}
              className="p-1 text-white/80 hover:text-white rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* Top Notification Alert Toast Banner for Real-time New Orders */}
        {lastNewOrderAlert && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="p-4 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white rounded-2xl shadow-xl flex items-center justify-between border border-amber-300"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white/20 backdrop-blur-md rounded-xl animate-bounce">
                <BellRing className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="font-bold text-sm">
                  🚚 Новая заявка на фуру в город {lastNewOrderAlert.destinationCity}!
                </p>
                <p className="text-xs text-amber-100">
                  {lastNewOrderAlert.invoiceNumber} • Дата отправки: {lastNewOrderAlert.shipmentDate} • Менеджер: {lastNewOrderAlert.managerName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSelectedStatusFilter('new');
                  dismissAlert();
                }}
                className="px-3 py-1.5 bg-white text-orange-600 rounded-xl font-bold text-xs shadow hover:bg-orange-50 transition-colors"
              >
                Посмотреть
              </button>
              <button
                onClick={dismissAlert}
                className="p-1.5 text-white/80 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-2xl shadow-md shadow-blue-500/20">
            <Truck className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                Заказ машин в регионы
              </h2>
              {newCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white animate-pulse">
                  {newCount} новых
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Заявки регионального отдела для оперативной подачи фур под погрузку
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Push Notification Toggle & Sound Test */}
          {pushPermission !== 'granted' ? (
            <button
              onClick={requestPushPermission}
              className="px-3.5 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl hover:bg-amber-100 transition-colors flex items-center gap-1.5 active:scale-95 shadow-sm"
              title="Нажмите, чтобы активировать алерты и звуковые оповещения о заявках"
            >
              <Bell className="w-4 h-4 text-amber-500 animate-pulse" />
              <span>Включить Пуш-уведомления</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-emerald-500" />
                <span>🔔 Пуш-уведомления активны</span>
              </div>
              <button
                onClick={() => {
                  playNotificationSound();
                  setNotificationToast('🔊 Звуковой сигнал оповещения проверен!');
                  setTimeout(() => setNotificationToast(null), 3000);
                }}
                className="px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
                title="Проверить звуковой сигнал"
              >
                <Volume2 className="w-4 h-4 text-blue-500" />
                <span>Проверить звук</span>
              </button>
            </div>
          )}

          {/* New Order Button */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>+ Заказать фуру в регион</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Widgets */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Всего заявок
            </p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">
              {totalCount}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-amber-200 dark:border-amber-800/60 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-xl">
            <BellRing className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Новые (Требуют фуру)
            </p>
            <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
              {newCount}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-indigo-200 dark:border-indigo-800/60 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              На погрузке / Поиск
            </p>
            <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
              {activeCount}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              В пути в регионы
            </p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {dispatchedCount}
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Pills */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl">
            <button
              onClick={() => setSelectedStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                selectedStatusFilter === 'all'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              Все статусы ({totalCount})
            </button>

            {(Object.keys(STATUS_CONFIG) as RegionalOrderStatus[]).map((st) => {
              const count = orders.filter(o => o.status === st).length;
              const cfg = STATUS_CONFIG[st];
              return (
                <button
                  key={st}
                  onClick={() => setSelectedStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                    selectedStatusFilter === st
                      ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-blue-500/20'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${cfg.bg.replace('bg-', 'bg-')}`} />
                  <span>{cfg.label}</span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-700 dark:text-slate-300">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* View Switcher: Table vs Kanban */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl self-end md:self-auto">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <List className="w-4 h-4" />
              <span>Таблица</span>
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Канбан Доска</span>
            </button>
          </div>
        </div>

        {/* Search & City Dropdown */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск по городу, накладной, менеджеру, гос. номеру авто..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
            />
          </div>

          {uniqueCities.length > 0 && (
            <select
              value={selectedCityFilter}
              onChange={(e) => setSelectedCityFilter(e.target.value)}
              className="w-full sm:w-48 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
            >
              <option value="all">Все города ({uniqueCities.length})</option>
              {uniqueCities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Content Rendering: Table or Kanban */}
      {loading ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-700">
          <Truck className="w-8 h-8 text-blue-500 animate-bounce mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
            Загрузка заявок на фуры в регионы...
          </p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-700">
          <Truck className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Заявок не найдено
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
            По заданным фильтрам нет заявок на перевозку. Нажмите кнопку «Заказать фуру в регион», чтобы создать новую заявку.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 transition-colors"
          >
            + Создать первую заявку
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* TABLE VIEW */
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700/60 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4">№ Заявки</th>
                  <th className="py-3.5 px-4">Дата отгрузки</th>
                  <th className="py-3.5 px-4">Направление</th>
                  <th className="py-3.5 px-4">Накладная / Документ</th>
                  <th className="py-3.5 px-4">Менеджер регионов</th>
                  <th className="py-3.5 px-4">Статус / Назначенный авто</th>
                  <th className="py-3.5 px-4 text-center">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/60 text-xs">
                {filteredOrders.map((order) => {
                  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.new;
                  const StatusIcon = cfg.icon;

                  return (
                    <tr 
                      key={order.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors"
                    >
                      {/* Order Number */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-700/70 text-slate-900 dark:text-white font-mono font-bold border border-slate-200 dark:border-slate-600 shadow-2xs whitespace-nowrap">
                          <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>{order.orderNumber}</span>
                          {order.status === 'new' && (
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" title="Новая заявка" />
                          )}
                        </div>
                      </td>

                      {/* Shipment Date */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-bold border border-amber-200/80 dark:border-amber-800/80 text-xs whitespace-nowrap">
                          <Calendar className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          <span>{order.shipmentDate}</span>
                        </div>
                      </td>

                      {/* Destination City & Unloading Address */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200 font-bold border border-blue-200 dark:border-blue-800">
                          <MapPin className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>{order.destinationCity}</span>
                          {order.deliveryPoints && order.deliveryPoints.length > 1 && (
                            <span className="ml-1 px-1.5 py-0.2 bg-emerald-600 text-white text-[10px] rounded-md font-bold">
                              {order.deliveryPoints.length} точки
                            </span>
                          )}
                        </div>
                        {order.deliveryAddress && (
                          <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300 mt-1 flex items-start gap-1 max-w-xs" title={order.deliveryAddress}>
                            <MapPin className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                            <span className="truncate">{order.deliveryAddress}</span>
                          </div>
                        )}
                        {order.recipientPhone && (
                          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                            <span>{order.recipientPhone}</span>
                          </div>
                        )}
                      </td>

                      {/* Invoice & Attachment */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-purple-500" />
                          <span>{order.invoiceNumber}</span>
                          {order.invoices && order.invoices.length > 1 && (
                            <span className="px-1.5 py-0.2 bg-purple-600 text-white text-[10px] rounded-md font-bold">
                              {order.invoices.length} накладных
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setActiveInvoicePreview({
                            title: `Заявка: ${order.invoiceNumber}`,
                            orderNumber: order.orderNumber,
                            invoiceNumber: order.invoiceNumber,
                            destinationCity: order.destinationCity,
                            deliveryAddress: order.deliveryAddress,
                            recipientPhone: order.recipientPhone,
                            deliveryPoints: order.deliveryPoints,
                            invoices: order.invoices,
                            shipmentDate: order.shipmentDate,
                            truckType: order.truckType,
                            palletsCount: order.palletsCount,
                            weight: order.weight,
                            cargoDescription: order.cargoDescription,
                            managerName: order.managerName,
                            managerPhone: order.managerPhone,
                            comments: order.comments,
                            assignedTruckPlate: order.assignedTruckPlate,
                            assignedDriver: order.assignedDriver,
                            fileName: order.invoiceFileName,
                            fileData: order.invoiceFileData,
                            fileType: order.invoiceFileType,
                          })}
                          className="mt-1 text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5 text-purple-500" />
                          <span>Просмотр накладных</span>
                        </button>
                      </td>

                      {/* Regional Manager */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>{order.managerName}</span>
                        </div>
                        {order.managerPhone && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{order.managerPhone}</span>
                          </div>
                        )}
                      </td>

                      {/* Status & Assigned Truck */}
                      <td className="py-3.5 px-4">
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold ${cfg.bg} ${cfg.text} ${cfg.border} border`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          <span>{cfg.label}</span>
                        </div>

                        {order.assignedTruckPlate ? (
                          <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 mt-1 flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <Truck className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Гос. №: {order.assignedTruckPlate}</span>
                            </div>
                            {order.assignedDriver && (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal pl-4">
                                {order.assignedDriver}
                              </span>
                            )}
                          </div>
                        ) : order.assignedDriver ? (
                          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mt-1 flex items-center gap-1">
                            <Truck className="w-3.5 h-3.5 text-blue-500" />
                            <span>Водитель: {order.assignedDriver}</span>
                          </div>
                        ) : order.status === 'new' ? (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
                            Ожидает назначения авто
                          </div>
                        ) : order.status === 'cancelled' ? (
                          <div className="text-[10px] text-red-500 dark:text-red-400 mt-1 font-medium">
                            Заявка отменена
                          </div>
                        ) : order.status === 'delivered' ? (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
                            Рейс успешно завершен
                          </div>
                        ) : (
                          <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-1 font-medium">
                            Автотранспорт назначен
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleOpenEdit(order)}
                            className="px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1"
                            title="Управлять статусом и назначить фуру"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Логистика</span>
                          </button>

                          {canDeleteOrder(order) && (
                            <button
                              onClick={() => {
                                if (confirm(`Удалить заявку ${order.orderNumber}?`)) {
                                  deleteOrder(order.id);
                                }
                              }}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                              title="Удалить заявку"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* KANBAN BOARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 overflow-x-auto pb-4">
          {(['new', 'assigned', 'loading', 'dispatched', 'delivered'] as RegionalOrderStatus[]).map((st) => {
            const cfg = STATUS_CONFIG[st];
            const columnOrders = filteredOrders.filter(o => o.status === st);

            return (
              <div 
                key={st}
                className="bg-slate-100/70 dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col min-h-[400px]"
              >
                {/* Column Header */}
                <div className={`p-2.5 rounded-xl ${cfg.bg} ${cfg.text} ${cfg.border} border mb-3 flex items-center justify-between`}>
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <cfg.icon className="w-4 h-4" />
                    <span>{cfg.label}</span>
                  </div>
                  <span className="px-2 py-0.5 bg-white dark:bg-slate-800 rounded-full text-[11px] font-bold shadow-xs">
                    {columnOrders.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {columnOrders.map((order) => (
                    <div
                      key={order.id}
                      className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white font-mono font-bold text-xs border border-slate-200 dark:border-slate-600">
                          {order.orderNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-bold text-[10px] flex items-center gap-1 border border-amber-200/80 dark:border-amber-800/80">
                          <Calendar className="w-3 h-3 text-amber-500" />
                          {order.shipmentDate}
                        </span>
                      </div>

                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold text-xs">
                        <MapPin className="w-3 h-3 text-blue-500" />
                        <span>{order.destinationCity}</span>
                      </div>

                      {order.deliveryAddress && (
                        <div className="text-[11px] text-slate-700 dark:text-slate-300 flex items-start gap-1 line-clamp-2" title={order.deliveryAddress}>
                          <MapPin className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                          <span>{order.deliveryAddress}</span>
                        </div>
                      )}

                      {order.recipientPhone && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                          <span>{order.recipientPhone}</span>
                        </div>
                      )}

                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5 text-purple-500" />
                        <span className="truncate">{order.invoiceNumber}</span>
                      </div>

                      <div className="text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-900 p-2 rounded-lg">
                        <p className="font-semibold text-slate-800 dark:text-slate-200">{order.truckType}</p>
                        <p className="text-[10px] mt-0.5">{order.palletsCount} • {order.weight}</p>
                      </div>

                      <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{order.managerName}</span>
                      </div>

                      {order.assignedTruckPlate && (
                        <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-1.5 rounded-lg">
                          🚛 Фура: {order.assignedTruckPlate}
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                        <button
                          onClick={() => setActiveInvoicePreview({
                            title: `Заявка: ${order.invoiceNumber}`,
                            orderNumber: order.orderNumber,
                            invoiceNumber: order.invoiceNumber,
                            destinationCity: order.destinationCity,
                            deliveryAddress: order.deliveryAddress,
                            recipientPhone: order.recipientPhone,
                            deliveryPoints: order.deliveryPoints,
                            invoices: order.invoices,
                            shipmentDate: order.shipmentDate,
                            truckType: order.truckType,
                            palletsCount: order.palletsCount,
                            weight: order.weight,
                            cargoDescription: order.cargoDescription,
                            managerName: order.managerName,
                            managerPhone: order.managerPhone,
                            comments: order.comments,
                            assignedTruckPlate: order.assignedTruckPlate,
                            assignedDriver: order.assignedDriver,
                            fileName: order.invoiceFileName,
                            fileData: order.invoiceFileData,
                            fileType: order.invoiceFileType,
                          })}
                          className="text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5 text-purple-500" />
                          <span>Просмотр накладных</span>
                        </button>

                        <div className="ml-auto flex items-center gap-1">
                          {canDeleteOrder(order) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Удалить заявку ${order.orderNumber}?`)) {
                                  deleteOrder(order.id);
                                }
                              }}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                              title="Удалить заявку"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEdit(order)}
                            className="px-2.5 py-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 rounded-lg hover:bg-blue-100 transition-colors"
                          >
                            Управлять
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal 1: Create New Order Modal */}
      <NewRegionalOrderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={addOrder}
      />

      {/* Modal 2: View Attached Invoice Document or Digital Spec in Browser */}
      <AnimatePresence>
        {activeInvoicePreview && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-5xl w-full p-5 sm:p-6 overflow-hidden space-y-4 my-6"
            >
              {/* Header Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 rounded-2xl">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {activeInvoicePreview.title}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Заявка № {activeInvoicePreview.orderNumber} • Город назначения: <strong>{activeInvoicePreview.destinationCity}</strong>
                    </p>
                  </div>
                </div>

                {/* Header Action Tools */}
                <div className="flex items-center gap-2">
                  {activeInvoicePreview.fileData && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const w = window.open();
                          if (w) {
                            if (activeInvoicePreview.fileType?.startsWith('image/')) {
                              w.document.write(`<html><head><title>${activeInvoicePreview.title}</title></head><body style="margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${activeInvoicePreview.fileData}" style="max-width:98%;max-height:98vh;object-fit:contain;margin:auto;" /></body></html>`);
                            } else {
                              w.document.write(`<html><head><title>${activeInvoicePreview.title}</title></head><body style="margin:0;height:100vh;"><iframe src="${activeInvoicePreview.fileData}" style="width:100%;height:100%;border:none;"></iframe></body></html>`);
                            }
                          }
                        }}
                        className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                        title="Открыть документ в отдельной вкладке браузера"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                        <span className="hidden sm:inline"> В отдельной вкладке</span>
                      </button>

                      <a
                        href={activeInvoicePreview.fileData}
                        download={activeInvoicePreview.fileName || `${activeInvoicePreview.invoiceNumber}.pdf`}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-sm"
                        title="Скачать файл"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline"> Скачать</span>
                      </a>
                    </>
                  )}

                  {!activeInvoicePreview.fileData && (
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Печать</span>
                    </button>
                  )}

                  <button
                    onClick={() => setActiveInvoicePreview(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Document View Body */}
              {activeInvoicePreview.fileData ? (
                <div className="w-full bg-slate-900/90 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center min-h-[450px]">
                  {activeInvoicePreview.fileType?.startsWith('image/') || activeInvoicePreview.fileData.startsWith('data:image/') ? (
                    <div className="p-4 flex items-center justify-center w-full min-h-[500px]">
                      <img
                        src={activeInvoicePreview.fileData}
                        alt="Document Preview"
                        className="max-h-[70vh] w-auto max-w-full object-contain rounded-xl shadow-2xl border border-slate-700"
                      />
                    </div>
                  ) : activeInvoicePreview.fileType === 'application/pdf' || activeInvoicePreview.fileData.startsWith('data:application/pdf') || activeInvoicePreview.fileName?.toLowerCase().endsWith('.pdf') ? (
                    <iframe
                      src={activeInvoicePreview.fileData}
                      title={activeInvoicePreview.title}
                      className="w-full h-[72vh] min-h-[500px] border-none bg-slate-900"
                    />
                  ) : (
                    <iframe
                      src={activeInvoicePreview.fileData}
                      title={activeInvoicePreview.title}
                      className="w-full h-[72vh] min-h-[500px] border-none bg-white"
                    />
                  )}
                </div>
              ) : (
                /* Digital Invoice Specification Layout */
                <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-6 text-slate-900 dark:text-slate-100 max-h-[70vh] overflow-y-auto">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-300 dark:border-slate-700 pb-4">
                    <div>
                      <h2 className="text-lg font-black tracking-tight text-blue-900 dark:text-blue-300">
                        ТОО «LOGISTICS REGIONS KAZAKHSTAN»
                      </h2>
                      <p className="text-xs text-slate-500">Департамент междугородней и региональной логистики</p>
                    </div>
                    <div className="sm:text-right">
                      <div className="inline-block px-3 py-1 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-xs font-bold rounded-lg border border-purple-200">
                        Электронная спецификация
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">Дата подачи: {activeInvoicePreview.shipmentDate}</p>
                    </div>
                  </div>

                  <div className="text-center py-2 border-b border-slate-200 dark:border-slate-800">
                    <h3 className="text-lg sm:text-xl font-black uppercase text-slate-800 dark:text-white tracking-wider">
                      ТОВАРНО-ТРАНСПОРТНАЯ НАКЛАДНАЯ (ЗАЯВКА НА ФУРУ)
                    </h3>
                    <p className="text-sm font-bold text-purple-600 dark:text-purple-400 mt-0.5">
                      {activeInvoicePreview.invoiceNumber} (Заявка № {activeInvoicePreview.orderNumber})
                    </p>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                      <p className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Маршрут доставки</p>
                      <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-sm">
                        <span>Алматы</span>
                        <ArrowRight className="w-3.5 h-3.5 text-blue-500" />
                        <span className="text-blue-600 dark:text-blue-400">{activeInvoicePreview.destinationCity}</span>
                      </p>
                      <p className="text-slate-500">Дата отправки авто: <strong>{activeInvoicePreview.shipmentDate}</strong></p>
                    </div>

                    <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                      <p className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Параметры автотранспорта</p>
                      <p className="font-bold text-slate-900 dark:text-white text-sm">{activeInvoicePreview.truckType}</p>
                      <p className="text-slate-500">Объем / Вес: <strong>{activeInvoicePreview.palletsCount || '—'} • {activeInvoicePreview.weight || '—'}</strong></p>
                    </div>

                    <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                      <p className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Описание груза</p>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">{activeInvoicePreview.cargoDescription || 'Молочная и сырная продукция'}</p>
                      {activeInvoicePreview.comments && (
                        <p className="text-slate-500 italic">Примечание: {activeInvoicePreview.comments}</p>
                      )}
                    </div>

                    <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                      <p className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Ответственный менеджер</p>
                      <p className="font-bold text-slate-900 dark:text-white">{activeInvoicePreview.managerName}</p>
                      <p className="text-slate-500">Телефон: {activeInvoicePreview.managerPhone || 'Не указан'}</p>
                    </div>
                  </div>

                  {/* Multiple Unloading Points Section */}
                  <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl space-y-3">
                    <p className="font-bold text-emerald-900 dark:text-emerald-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-emerald-600" />
                      <span>Адреса выгрузки по заявке ({activeInvoicePreview.deliveryPoints?.length || 1})</span>
                    </p>

                    {activeInvoicePreview.deliveryPoints && activeInvoicePreview.deliveryPoints.length > 0 ? (
                      <div className="space-y-2">
                        {activeInvoicePreview.deliveryPoints.map((pt, idx) => (
                          <div key={pt.id || idx} className="p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-emerald-100 dark:border-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                                {idx + 1}
                              </span>
                              <div>
                                <p className="font-bold text-slate-900 dark:text-white">{pt.address}</p>
                                {pt.recipientPhone && (
                                  <p className="text-slate-500 text-[11px]">Телефон: {pt.recipientPhone} {pt.recipientName ? `(${pt.recipientName})` : ''}</p>
                                )}
                              </div>
                            </div>
                            {pt.note && (
                              <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 rounded text-[10px] font-semibold shrink-0">
                                {pt.note}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-emerald-100 dark:border-emerald-900 text-xs">
                        <p className="font-bold text-slate-900 dark:text-white">{activeInvoicePreview.deliveryAddress || 'Не указан'}</p>
                        <p className="text-slate-500 text-[11px]">Телефон: {activeInvoicePreview.recipientPhone || 'Не указан'}</p>
                      </div>
                    )}
                  </div>

                  {/* Multiple Invoices Section */}
                  <div className="p-4 bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 rounded-xl space-y-3">
                    <p className="font-bold text-purple-900 dark:text-purple-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-purple-600" />
                      <span>Накладные и прикрепленные файлы ({activeInvoicePreview.invoices?.length || 1})</span>
                    </p>

                    {activeInvoicePreview.invoices && activeInvoicePreview.invoices.length > 0 ? (
                      <div className="space-y-2">
                        {activeInvoicePreview.invoices.map((inv, idx) => (
                          <div key={inv.id || idx} className="p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-purple-100 dark:border-purple-900 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-purple-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0">
                                {idx + 1}
                              </span>
                              <span className="font-bold text-purple-950 dark:text-purple-200">{inv.invoiceNumber}</span>
                              {inv.fileName && (
                                <span className="text-slate-500 text-[11px]">({inv.fileName})</span>
                              )}
                            </div>

                            {inv.fileData && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const w = window.open();
                                    if (w) {
                                      if (inv.fileType?.startsWith('image/')) {
                                        w.document.write(`<html><head><title>${inv.invoiceNumber}</title></head><body style="margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${inv.fileData}" style="max-width:98%;max-height:98vh;object-fit:contain;margin:auto;" /></body></html>`);
                                      } else {
                                        w.document.write(`<html><head><title>${inv.invoiceNumber}</title></head><body style="margin:0;height:100vh;"><iframe src="${inv.fileData}" style="width:100%;height:100%;border:none;"></iframe></body></html>`);
                                      }
                                    }
                                  }}
                                  className="px-2.5 py-1 bg-purple-100 dark:bg-purple-900/60 hover:bg-purple-200 text-purple-800 dark:text-purple-200 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1"
                                >
                                  <Eye className="w-3 h-3 text-purple-600" />
                                  <span>Просмотр</span>
                                </button>
                                <a
                                  href={inv.fileData}
                                  download={inv.fileName || `${inv.invoiceNumber}.pdf`}
                                  className="px-2.5 py-1 bg-purple-600 text-white text-[11px] font-bold rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-1"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>Скачать</span>
                                </a>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-purple-100 dark:border-purple-900 text-xs font-bold text-slate-800 dark:text-slate-200">
                        {activeInvoicePreview.invoiceNumber}
                      </div>
                    )}
                  </div>

                  {activeInvoicePreview.assignedTruckPlate && (
                    <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <p className="font-bold text-emerald-800 dark:text-emerald-300">
                          Назначенный автотранспорт: {activeInvoicePreview.assignedTruckPlate}
                        </p>
                        {activeInvoicePreview.assignedDriver && (
                          <p className="text-emerald-600 dark:text-emerald-400">Водитель: {activeInvoicePreview.assignedDriver}</p>
                        )}
                      </div>
                      <span className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded-lg text-[10px]">
                        Подтвержден
                      </span>
                    </div>
                  )}

                  {/* Stamp & Verification */}
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                    <div>
                      Электронный документ подтвержден ERP-системой логистики
                    </div>
                    <div className="font-mono text-[10px]">
                      VERIFIED-TTN-{activeInvoicePreview.orderNumber}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setActiveInvoicePreview(null)}
                  className="px-6 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors"
                >
                  Закрыть
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal 3: Logistics Management & Truck Assignment Modal */}
      <AnimatePresence>
        {editingOrder && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                <div className="flex items-center gap-2">
                  <Truck className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Управление заявкой {editingOrder.orderNumber}
                  </h3>
                </div>
                <button
                  onClick={() => setEditingOrder(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Order Context Details */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-900 rounded-2xl space-y-1.5 text-xs">
                <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-blue-500" />
                  <span>Направление: {editingOrder.destinationCity}</span>
                </p>
                {editingOrder.deliveryAddress && (
                  <p className="text-slate-700 dark:text-slate-300 font-medium flex items-start gap-1">
                    <MapPin className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                    <span>Адрес выгрузки: <strong>{editingOrder.deliveryAddress}</strong></span>
                  </p>
                )}
                {editingOrder.recipientPhone && (
                  <p className="text-slate-700 dark:text-slate-300 font-medium flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <span>Телефон получателя: <strong>{editingOrder.recipientPhone}</strong></span>
                  </p>
                )}
                <p className="text-slate-600 dark:text-slate-400">
                  {editingOrder.invoiceNumber} • Дата: {editingOrder.shipmentDate}
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  {editingOrder.truckType} ({editingOrder.palletsCount})
                </p>
              </div>

              {/* Edit Controls */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Статус заявки
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as RegionalOrderStatus)}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                  >
                    {(Object.keys(STATUS_CONFIG) as RegionalOrderStatus[]).map(st => (
                      <option key={st} value={st}>{STATUS_CONFIG[st].label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Гос. номер назначенного авто / фуры
                  </label>
                  <input
                    type="text"
                    placeholder="например: 777 ABC 02 (МАН / Рефрижератор)"
                    value={assignedTruckPlate}
                    onChange={(e) => setAssignedTruckPlate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    ФИО и телефон водителя
                  </label>
                  <input
                    type="text"
                    placeholder="например: Руслан Ахметов (+7 705 111-2233)"
                    value={assignedDriver}
                    onChange={(e) => setAssignedDriver(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-between border-t border-slate-200 dark:border-slate-700">
                {canDeleteOrder(editingOrder) ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Удалить заявку ${editingOrder.orderNumber}?`)) {
                        deleteOrder(editingOrder.id);
                        setEditingOrder(null);
                      }
                    }}
                    className="px-3.5 py-2 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Удалить заявку</span>
                  </button>
                ) : <div />}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingOrder(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 transition-colors"
                  >
                    Сохранить назначения
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
