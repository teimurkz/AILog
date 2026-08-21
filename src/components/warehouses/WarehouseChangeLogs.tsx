import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  Filter,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  TrendingDown,
  TrendingUp,
  FileEdit,
  Building2,
  Package,
  Layers,
  History,
  User,
  X,
  FileText
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { WarehouseChangeLog, WarehouseChangeType } from '../../types';

interface WarehouseChangeLogsProps {
  logs: WarehouseChangeLog[];
  warehouses: { id: string; name: string }[];
  onRefresh: () => void;
  refreshing: boolean;
  onAddManualLog: (log: Partial<WarehouseChangeLog>) => Promise<void>;
  spreadsheetUrl?: string;
}

export const WarehouseChangeLogs: React.FC<WarehouseChangeLogsProps> = ({
  logs,
  warehouses,
  onRefresh,
  refreshing,
  onAddManualLog,
  spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/1FRwicnGLMSD2jurukoLPEa5kGmycpwAHnBvObJX7kCQ/edit#gid=2106761407'
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  const [selectedAuthor, setSelectedAuthor] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Extract unique authors for filter dropdown
  const uniqueAuthors = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(l => {
      if (l.author && l.author.trim()) set.add(l.author.trim());
    });
    return Array.from(set);
  }, [logs]);

  // Manual Log Form State
  const [manualForm, setManualForm] = useState({
    warehouseId: warehouses[0]?.id || 'bekmakhanova',
    warehouseName: warehouses[0]?.name || 'Бекмаханова',
    product: '',
    invNumber: '',
    changeType: 'manual' as WarehouseChangeType,
    title: '',
    description: '',
    palletDelta: 0,
    author: 'Оператор склада'
  });

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    let list = [...logs];

    // Warehouse filter
    if (selectedWarehouse !== 'all') {
      list = list.filter(l => l.warehouseId === selectedWarehouse);
    }

    // Change type filter
    if (selectedType !== 'all') {
      list = list.filter(l => l.changeType === selectedType);
    }

    // Author / Manager filter
    if (selectedAuthor !== 'all') {
      list = list.filter(l => l.author === selectedAuthor);
    }

    // Time period filter
    if (selectedPeriod !== 'all') {
      const now = new Date().getTime();
      let cutoff = 0;
      if (selectedPeriod === 'today') {
        cutoff = new Date().setHours(0, 0, 0, 0);
      } else if (selectedPeriod === '7days') {
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
      } else if (selectedPeriod === '30days') {
        cutoff = now - 30 * 24 * 60 * 60 * 1000;
      }
      list = list.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(l =>
        (l.product || '').toLowerCase().includes(q) ||
        (l.invNumber || '').toLowerCase().includes(q) ||
        (l.title || '').toLowerCase().includes(q) ||
        (l.description || '').toLowerCase().includes(q) ||
        (l.warehouseName || '').toLowerCase().includes(q) ||
        (l.author || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [logs, selectedWarehouse, selectedType, selectedAuthor, selectedPeriod, searchQuery]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let addedCount = 0;
    let removedCount = 0;
    let quantityCount = 0;
    let totalPalletDelta = 0;

    filteredLogs.forEach(l => {
      if (l.changeType === 'added') addedCount++;
      if (l.changeType === 'removed') removedCount++;
      if (l.changeType === 'quantity_changed') quantityCount++;
      if (typeof l.palletDelta === 'number') {
        totalPalletDelta += l.palletDelta;
      }
    });

    return {
      totalLogs: filteredLogs.length,
      addedCount,
      removedCount,
      quantityCount,
      totalPalletDelta: Math.round(totalPalletDelta * 10) / 10
    };
  }, [filteredLogs]);

  // Export Logs to Excel (.xlsx)
  const handleExportExcel = () => {
    if (filteredLogs.length === 0) return;

    const exportData = filteredLogs.map((l, index) => ({
      '№': index + 1,
      'Дата и время': new Date(l.timestamp).toLocaleString('ru-RU'),
      'Кто изменил (ФИО / Автор)': l.author || 'Система',
      'Склад': l.warehouseName || '—',
      'Товар / Наименование': l.product || '—',
      'Инвойс / ИНВ №': l.invNumber || '—',
      'Тип изменения': getChangeTypeLabel(l.changeType),
      'Событие': l.title,
      'Подробности': l.description,
      'Было': l.oldValue ?? '—',
      'Стало': l.newValue ?? '—',
      'Изменение паллет (+/-)': l.palletDelta ?? 0,
      'Источник': l.source || 'Google Sheets'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // Set column widths
    worksheet['!cols'] = [
      { wch: 5 },  // №
      { wch: 20 }, // Дата и время
      { wch: 25 }, // Кто изменил
      { wch: 18 }, // Склад
      { wch: 30 }, // Товар
      { wch: 16 }, // Инвойс
      { wch: 22 }, // Тип
      { wch: 32 }, // Событие
      { wch: 45 }, // Подробности
      { wch: 12 }, // Было
      { wch: 12 }, // Стало
      { wch: 18 }, // Паллеты
      { wch: 18 }, // Источник
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Лог изменений Google Sheets');

    const fileName = `warehouse_google_sheets_log_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  // Export Logs to CSV
  const handleExportCSV = () => {
    if (filteredLogs.length === 0) return;

    const headers = ['№', 'Дата', 'Склад', 'Товар', 'Инвойс', 'Тип', 'Заголовок', 'Описание', 'Было', 'Стало', 'Дельта паллет', 'Автор'];
    const rows = filteredLogs.map((l, idx) => [
      idx + 1,
      `"${new Date(l.timestamp).toLocaleString('ru-RU')}"`,
      `"${l.warehouseName || ''}"`,
      `"${(l.product || '').replace(/"/g, '""')}"`,
      `"${l.invNumber || ''}"`,
      `"${getChangeTypeLabel(l.changeType)}"`,
      `"${(l.title || '').replace(/"/g, '""')}"`,
      `"${(l.description || '').replace(/"/g, '""')}"`,
      `"${l.oldValue ?? ''}"`,
      `"${l.newValue ?? ''}"`,
      l.palletDelta ?? 0,
      `"${l.author || ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `warehouse_log_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmitManualLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.title.trim()) return;

    setIsSubmitting(true);
    try {
      const selectedWh = warehouses.find(w => w.id === manualForm.warehouseId);
      await onAddManualLog({
        ...manualForm,
        warehouseName: selectedWh ? selectedWh.name : manualForm.warehouseName,
        source: 'Manual'
      });
      setShowAddModal(false);
      setManualForm({
        warehouseId: warehouses[0]?.id || 'bekmakhanova',
        warehouseName: warehouses[0]?.name || 'Бекмаханова',
        product: '',
        invNumber: '',
        changeType: 'manual',
        title: '',
        description: '',
        palletDelta: 0,
        author: 'Оператор склада'
      });
    } catch (err) {
      console.error('Failed to submit log:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Header Banner */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700/60">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-4 space-x-reverse">
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <History className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Лог изменений Excel / Google Таблицы
                </h2>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                  Авто-фиксация снимков
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                История приходов, списаний, корректировок паллет и изменений мест хранения по всем складам
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/80 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50 border border-slate-200 dark:border-slate-600"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-600' : ''}`} />
              <span>Сверить с Google Sheets</span>
            </button>

            <button
              onClick={handleExportExcel}
              disabled={filteredLogs.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-xl transition-colors border border-emerald-200 dark:border-emerald-800 disabled:opacity-50"
              title="Скачать лог в формате Excel .xlsx"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Экспорт в Excel (.xlsx)</span>
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm hover:shadow"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить запись</span>
            </button>

            <a
              href={spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
            >
              <ExternalLink className="w-4 h-4 opacity-70" />
              <span className="hidden sm:inline">Открыть Таблицу</span>
            </a>
          </div>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center space-x-4 space-x-reverse">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
            <History className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Записей в логе
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              {metrics.totalLogs}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center space-x-4 space-x-reverse">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Новых приходов
            </p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
              +{metrics.addedCount}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center space-x-4 space-x-reverse">
          <div className="p-3 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-xl">
            <TrendingDown className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Списаний / Убытий
            </p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-0.5">
              -{metrics.removedCount}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center space-x-4 space-x-reverse">
          <div className={`p-3 rounded-xl ${metrics.totalPalletDelta >= 0 ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'}`}>
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Баланс паллет (Дельта)
            </p>
            <p className={`text-2xl font-bold mt-0.5 ${metrics.totalPalletDelta >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-purple-600 dark:text-purple-400'}`}>
              {metrics.totalPalletDelta > 0 ? `+${metrics.totalPalletDelta}` : metrics.totalPalletDelta} палл.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700/60 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по товару, инвойсу, складу или описанию..."
              className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Warehouse Filter */}
            <select
              value={selectedWarehouse}
              onChange={e => setSelectedWarehouse(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="all">Все склады</option>
              {warehouses.map(wh => (
                <option key={wh.id} value={wh.id}>{wh.name}</option>
              ))}
            </select>

            {/* Change Type Filter */}
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="all">Все типы изменений</option>
              <option value="added">🟢 Добавлено / Приход</option>
              <option value="removed">🔴 Удалено / Списание</option>
              <option value="quantity_changed">🟡 Изменение количества</option>
              <option value="svh_changed">ℹ️ Изменение СВХ</option>
              <option value="manual">📝 Ручная запись</option>
            </select>

            {/* Author / Responsible Person Filter */}
            <select
              value={selectedAuthor}
              onChange={e => setSelectedAuthor(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="all">Все авторы / Кто менял</option>
              {uniqueAuthors.map(author => (
                <option key={author} value={author}>👤 {author}</option>
              ))}
            </select>

            {/* Time Period Filter */}
            <select
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="all">Всё время</option>
              <option value="today">За сегодня</option>
              <option value="7days">За 7 дней</option>
              <option value="30days">За 30 дней</option>
            </select>
          </div>
        </div>
      </div>

      {/* Log Feed Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700/60 overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="p-3 bg-slate-100 dark:bg-slate-700/50 text-slate-400 rounded-full w-fit mx-auto">
              <History className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
              Записи в логе не найдены
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Нажмите кнопку "Сверить с Google Sheets", чтобы проанализировать последние изменения в таблице, или добавьте запись вручную.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-900/80 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3.5">Дата / Время</th>
                  <th className="px-4 py-3.5">Кто изменил (Имя / Автор)</th>
                  <th className="px-4 py-3.5">Тип события</th>
                  <th className="px-4 py-3.5">Склад</th>
                  <th className="px-4 py-3.5">Товар / ИНВ №</th>
                  <th className="px-4 py-3.5">Подробности изменения</th>
                  <th className="px-4 py-3.5 text-center">Дельта</th>
                  <th className="px-4 py-3.5 text-right">Источник</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/60">
                {filteredLogs.map(log => {
                  const badgeInfo = getChangeTypeBadge(log.changeType);
                  const isAutoSync = log.author?.toLowerCase().includes('google') || log.source === 'Google Sheets';
                  
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                      {/* Timestamp */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {formatDate(log.timestamp)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {formatTime(log.timestamp)}
                        </div>
                      </td>

                      {/* Who Changed / Author Name */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg flex items-center justify-center shrink-0 ${
                            isAutoSync 
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' 
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                          }`}>
                            <User className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="font-semibold text-xs text-slate-900 dark:text-white">
                              {log.author || 'Система'}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {isAutoSync ? 'Авто-синхронизация' : 'Пользователь / Оператор'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Event Type */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${badgeInfo.bg} ${badgeInfo.text}`}>
                          {badgeInfo.icon}
                          {badgeInfo.label}
                        </span>
                      </td>

                      {/* Warehouse */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs font-medium text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          <span>{log.warehouseName}</span>
                        </div>
                      </td>

                      {/* Product & Invoice */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-medium text-slate-900 dark:text-white max-w-[220px] truncate" title={log.product}>
                          {log.product || '—'}
                        </div>
                        {log.invNumber && (
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            № {log.invNumber}
                          </div>
                        )}
                      </td>

                      {/* Details & Diff */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {log.title}
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 mt-0.5 text-[12px] leading-relaxed max-w-xl">
                          {log.description}
                        </p>
                        {(log.oldValue !== undefined || log.newValue !== undefined) && (
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                            {log.oldValue !== undefined && (
                              <span className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded line-through text-slate-400">
                                {log.oldValue}
                              </span>
                            )}
                            {log.oldValue !== undefined && log.newValue !== undefined && <span>➔</span>}
                            {log.newValue !== undefined && (
                              <span className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-medium">
                                {log.newValue}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Pallet Delta */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-center text-xs font-bold">
                        {typeof log.palletDelta === 'number' && log.palletDelta !== 0 ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            log.palletDelta > 0 
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' 
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300'
                          }`}>
                            {log.palletDelta > 0 ? `+${log.palletDelta}` : log.palletDelta}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Source & Author */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-right text-xs">
                        <div className="font-medium text-slate-700 dark:text-slate-300">
                          {log.author || 'Система'}
                        </div>
                        <span className="inline-block mt-0.5 text-[10px] uppercase tracking-wider font-mono text-slate-400">
                          {log.source || 'Google Sheets'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Manual Log Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 rounded-lg">
                  <FileEdit className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Зафиксировать изменение склада
                </h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitManualLog} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Склад
                </label>
                <select
                  value={manualForm.warehouseId}
                  onChange={e => {
                    const id = e.target.value;
                    const wh = warehouses.find(w => w.id === id);
                    setManualForm(prev => ({
                      ...prev,
                      warehouseId: id,
                      warehouseName: wh ? wh.name : prev.warehouseName
                    }));
                  }}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Наименование товара
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Масло сливочное 82.5%"
                    value={manualForm.product}
                    onChange={e => setManualForm(prev => ({ ...prev, product: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Инвойс / ИНВ №
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 46969"
                    value={manualForm.invNumber}
                    onChange={e => setManualForm(prev => ({ ...prev, invNumber: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Тип операции
                  </label>
                  <select
                    value={manualForm.changeType}
                    onChange={e => setManualForm(prev => ({ ...prev, changeType: e.target.value as WarehouseChangeType }))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  >
                    <option value="added">🟢 Приход товара</option>
                    <option value="removed">🔴 Списание / Отгрузка</option>
                    <option value="quantity_changed">🟡 Корректировка остатка</option>
                    <option value="svh_changed">ℹ️ Перемещение / СВХ</option>
                    <option value="manual">📝 Ручная заметка</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Изменение паллет (+/-)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    placeholder="e.g. -5 или 10"
                    value={manualForm.palletDelta}
                    onChange={e => setManualForm(prev => ({ ...prev, palletDelta: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Заголовок события
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Выезд 5 паллет по заявке №102"
                  value={manualForm.title}
                  onChange={e => setManualForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Подробный комментарий / Причина
                </label>
                <textarea
                  rows={2}
                  placeholder="Укажите подробности изменения или номер накладной..."
                  value={manualForm.description}
                  onChange={e => setManualForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ФИО / Кто внес изменения (Автор)
                </label>
                <div className="space-y-2">
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Иван Петров (Менеджер)"
                      value={manualForm.author}
                      onChange={e => setManualForm(prev => ({ ...prev, author: e.target.value }))}
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                    />
                  </div>
                  {/* Quick Author Pills */}
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span className="text-slate-400">Быстрый выбор:</span>
                    {['Оператор склада', 'Менеджер Бекмаханова', 'Диспетчер складов', 'Логист'].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setManualForm(prev => ({ ...prev, author: preset }))}
                        className={`px-2 py-0.5 rounded-md border transition-colors ${
                          manualForm.author === preset 
                            ? 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/60 dark:border-emerald-700 dark:text-emerald-200 font-medium' 
                            : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200 dark:bg-slate-700/60 dark:border-slate-600 dark:text-slate-300'
                        }`}
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Сохранение...' : 'Зафиксировать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// Helpers
function getChangeTypeLabel(type: WarehouseChangeType): string {
  switch (type) {
    case 'added': return 'Добавлено / Приход';
    case 'removed': return 'Удалено / Списание';
    case 'quantity_changed': return 'Изменение кол-ва';
    case 'svh_changed': return 'Изменение СВХ';
    case 'manual': return 'Ручная запись';
    default: return 'Изменение';
  }
}

function getChangeTypeBadge(type: WarehouseChangeType) {
  switch (type) {
    case 'added':
      return {
        label: 'Приход',
        bg: 'bg-emerald-100 dark:bg-emerald-900/40',
        text: 'text-emerald-800 dark:text-emerald-300',
        icon: <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
      };
    case 'removed':
      return {
        label: 'Списание',
        bg: 'bg-rose-100 dark:bg-rose-900/40',
        text: 'text-rose-800 dark:text-rose-300',
        icon: <ArrowDownRight className="w-3.5 h-3.5 text-rose-600" />
      };
    case 'quantity_changed':
      return {
        label: 'Количество',
        bg: 'bg-amber-100 dark:bg-amber-900/40',
        text: 'text-amber-800 dark:text-amber-300',
        icon: <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
      };
    case 'svh_changed':
      return {
        label: 'СВХ / Адрес',
        bg: 'bg-sky-100 dark:bg-sky-900/40',
        text: 'text-sky-800 dark:text-sky-300',
        icon: <Building2 className="w-3.5 h-3.5 text-sky-600" />
      };
    default:
      return {
        label: 'Заметка',
        bg: 'bg-purple-100 dark:bg-purple-900/40',
        text: 'text-purple-800 dark:text-purple-300',
        icon: <FileEdit className="w-3.5 h-3.5 text-purple-600" />
      };
  }
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return isoStr;
  }
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
