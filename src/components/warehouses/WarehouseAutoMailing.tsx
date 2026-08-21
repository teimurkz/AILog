import React, { useState, useEffect } from 'react';
import { 
  Mail, 
  Send, 
  UserPlus, 
  Users, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Trash2, 
  Edit3, 
  Settings, 
  FileSpreadsheet, 
  RefreshCw, 
  Search, 
  Sparkles, 
  X, 
  Building2, 
  Check, 
  History,
  ShieldCheck,
  Zap,
  Server,
  Key,
  Globe,
  Lock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { MailingSubscriber, MailingSettings, MailingLog } from '../../types';

export const WarehouseAutoMailing: React.FC = () => {
  const [subscribers, setSubscribers] = useState<MailingSubscriber[]>([]);
  const [settings, setSettings] = useState<MailingSettings>({
    enabled: true,
    scheduleType: 'daily',
    sendTime: '09:00',
    emailSubject: '📊 Ежедневный отчет: Остатки товаров на складах',
    emailBody: 'Добрый день!\n\nНаправляем актуальный свежий файл Excel с остатками товаров и движением паллет по всем складам компании.\n\nС уважением,\nАвтоматическая система складского учета',
    attachFormat: 'xlsx',
    includeAnalyticsSummary: true,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: ''
  });
  const [logs, setLogs] = useState<MailingLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [sendSuccessMsg, setSendSuccessMsg] = useState<string | null>(null);
  const [sendErrorMsg, setSendErrorMsg] = useState<string | null>(null);

  // SMTP Testing State
  const [testingSmtp, setTestingSmtp] = useState<boolean>(false);
  const [showSmtpSettings, setShowSmtpSettings] = useState<boolean>(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  // Modal State for Add / Edit Subscriber
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingSub, setEditingSub] = useState<MailingSubscriber | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    department: 'Логистика / Склад',
    isActive: true,
    comments: ''
  });

  // Test Email state
  const [testEmail, setTestEmail] = useState<string>('t.farajov@mehkaz.kz');
  const [sendingTest, setSendingTest] = useState<boolean>(false);

  // Live Scheduler Status
  const [statusInfo, setStatusInfo] = useState<any>(null);
  const [diagInfo, setDiagInfo] = useState<any>(null);
  const [checkingDiag, setCheckingDiag] = useState<boolean>(false);

  const handleCheckDiagnostics = async () => {
    setCheckingDiag(true);
    try {
      const res = await fetch('/api/mailing/check-scheduler');
      if (res.ok) {
        const d = await res.json();
        setDiagInfo(d);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCheckingDiag(false);
    }
  };

  const handleForceAutoMailing = async () => {
    setSending(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);
    try {
      const res = await fetch('/api/mailing/force-cron-trigger', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setSendSuccessMsg('Симуляция автоматической рассылки выполнена успешно!');
        fetchData();
      } else {
        setSendErrorMsg(data.error || data.message || 'Ошибка симуляции авто-рассылки');
      }
    } catch (e: any) {
      setSendErrorMsg(e.message || 'Ошибка сервера');
    } finally {
      setSending(false);
    }
  };

  const handleSetQuickTime = async (offsetMinutes: number = 1) => {
    setSending(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);
    try {
      const res = await fetch('/api/mailing/set-quick-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offsetMinutes })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSendSuccessMsg(data.message || `Время рассылки установлено на ${data.sendTime}!`);
        fetchData();
      } else {
        setSendErrorMsg(data.error || 'Ошибка установки быстрого времени');
      }
    } catch (e: any) {
      setSendErrorMsg(e.message || 'Ошибка сервера');
    } finally {
      setSending(false);
    }
  };

  // Load Data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [subsRes, setRes, logsRes, statusRes] = await Promise.all([
        fetch('/api/mailing/subscribers'),
        fetch('/api/mailing/settings'),
        fetch('/api/mailing/logs'),
        fetch('/api/mailing/status')
      ]);

      if (subsRes.ok) {
        const d = await subsRes.json();
        setSubscribers(d.subscribers || []);
      }
      if (setRes.ok) {
        const d = await setRes.json();
        if (d.settings) setSettings(d.settings);
      }
      if (logsRes.ok) {
        const d = await logsRes.json();
        setLogs(d.logs || []);
      }
      if (statusRes.ok) {
        const d = await statusRes.json();
        setStatusInfo(d);
      }
    } catch (err) {
      console.error('Failed to load mailing data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Poll live status every 10s
    const statusInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/mailing/status');
        if (res.ok) {
          const d = await res.json();
          setStatusInfo(d);
        }
      } catch (e) {}
    }, 10000);

    return () => clearInterval(statusInterval);
  }, []);

  // Save Settings
  const handleSaveSettings = async () => {
    try {
      const res = await fetch('/api/mailing/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
        setSendSuccessMsg('Настройки рассылки и SMTP успешно сохранены!');
        setTimeout(() => setSendSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSendErrorMsg('Не удалось сохранить настройки');
    }
  };

  // Test SMTP Connection
  const handleTestSmtpConnection = async () => {
    setTestingSmtp(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);

    try {
      const res = await fetch('/api/mailing/test-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSendSuccessMsg(data.message || 'Подключение к SMTP серверу успешно!');
      } else {
        setSendErrorMsg(data.error || 'Ошибка проверки SMTP подключения');
      }
    } catch (err: any) {
      setSendErrorMsg(err.message || 'Ошибка связи с сервером при проверке SMTP');
    } finally {
      setTestingSmtp(false);
    }
  };

  // Apply SMTP Presets
  const applySmtpPreset = (preset: 'outlook' | 'yandex' | 'gmail' | 'mailru' | 'mehkaz') => {
    if (preset === 'outlook') {
      setSettings(prev => ({
        ...prev,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpSecure: false
      }));
    } else if (preset === 'mehkaz') {
      setSettings(prev => ({
        ...prev,
        smtpHost: 'smtp.office365.com', // or mail.mehkaz.kz
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: prev.smtpUser || 't.farajov@mehkaz.kz'
      }));
    } else if (preset === 'yandex') {
      setSettings(prev => ({
        ...prev,
        smtpHost: 'smtp.yandex.ru',
        smtpPort: 465,
        smtpSecure: true
      }));
    } else if (preset === 'gmail') {
      setSettings(prev => ({
        ...prev,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        smtpSecure: false
      }));
    } else if (preset === 'mailru') {
      setSettings(prev => ({
        ...prev,
        smtpHost: 'smtp.mail.ru',
        smtpPort: 465,
        smtpSecure: true
      }));
    }
  };

  // Open Modal for Add/Edit
  const handleOpenModal = (sub?: MailingSubscriber) => {
    if (sub) {
      setEditingSub(sub);
      setFormData({
        name: sub.name,
        email: sub.email,
        department: sub.department || 'Логистика / Склад',
        isActive: sub.isActive,
        comments: sub.comments || ''
      });
    } else {
      setEditingSub(null);
      setFormData({
        name: '',
        email: '',
        department: 'Логистика / Склад',
        isActive: true,
        comments: ''
      });
    }
    setIsModalOpen(true);
  };

  // Save Subscriber (Add/Update)
  const handleSaveSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email) return;

    try {
      const payload = editingSub 
        ? { ...formData, id: editingSub.id }
        : formData;

      const res = await fetch('/api/mailing/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setIsModalOpen(false);
        fetchData();
      }
    } catch (err) {
      console.error('Failed to save subscriber:', err);
    }
  };

  // Toggle Active State
  const handleToggleActive = async (sub: MailingSubscriber) => {
    try {
      await fetch('/api/mailing/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sub, isActive: !sub.isActive })
      });
      fetchData();
    } catch (err) {
      console.error('Failed to toggle subscriber state:', err);
    }
  };

  // Delete Subscriber
  const handleDeleteSubscriber = async (id: string) => {
    if (!confirm('Удалить этого получателя из списка рассылки?')) return;
    try {
      await fetch(`/api/mailing/subscribers/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error('Failed to delete subscriber:', err);
    }
  };

  // Instant Send to All Active
  const handleSendNow = async (targetSubscriberIds?: string[]) => {
    setSending(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);

    try {
      const res = await fetch('/api/mailing/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSubscriberIds,
          triggerSource: 'manual'
        })
      });

      const result = await res.json();
      if (res.ok && result.success) {
        setSendSuccessMsg(result.message || 'Рассылка Excel файла успешно отправлена!');
        fetchData();
      } else {
        setSendErrorMsg(result.error || result.message || 'Ошибка отправки рассылки');
      }
    } catch (err: any) {
      setSendErrorMsg(err.message || 'Не удалось выполнить рассылку');
    } finally {
      setSending(false);
    }
  };

  // Send Single Test Email
  const handleSendTestEmail = async () => {
    if (!testEmail || !testEmail.includes('@')) {
      alert('Введите корректный email адрес!');
      return;
    }

    setSendingTest(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);

    try {
      const res = await fetch('/api/mailing/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customEmail: testEmail,
          triggerSource: 'test'
        })
      });

      const result = await res.json();
      if (res.ok && result.success) {
        setSendSuccessMsg(`Тестовое письмо с Excel файлом отправлено на ${testEmail}!`);
        setTestEmail('');
        fetchData();
      } else {
        setSendErrorMsg(result.error || result.message || 'Ошибка тестовой отправки');
      }
    } catch (err: any) {
      setSendErrorMsg(err.message || 'Не удалось отправить тестовое письмо');
    } finally {
      setSendingTest(false);
    }
  };

  const activeCount = subscribers.filter(s => s.isActive).length;

  const filteredSubscribers = subscribers.filter(sub => {
    const q = searchQuery.toLowerCase();
    const matchesQuery = sub.name.toLowerCase().includes(q) || sub.email.toLowerCase().includes(q) || (sub.department || '').toLowerCase().includes(q);
    const matchesDept = departmentFilter === 'all' || sub.department === departmentFilter;
    return matchesQuery && matchesDept;
  });

  const departments = Array.from(new Set(subscribers.map(s => s.department).filter(Boolean)));

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Controls */}
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 transform translate-x-8 -translate-y-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/15 backdrop-blur-md rounded-full text-xs font-semibold text-blue-100">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Авто-рассылка остатков Google Таблицы (Excel)</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Ежедневный отчет по складам
            </h2>
            <p className="text-sm text-blue-100/90 max-w-2xl">
              Автоматически берет онлайн Google Таблицу складов, форматирует её со сводкой и итогами паллет и отправляет коллегам каждый день в 09:00.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/mailing/download-excel"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 backdrop-blur-md border border-white/20 shadow-sm"
            >
              <Download className="w-4 h-4 text-emerald-300" />
              <span>Скачать свежий Excel</span>
            </a>

            <button
              onClick={() => handleSendNow()}
              disabled={sending || activeCount === 0}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 shadow-md shadow-emerald-900/30 disabled:opacity-50"
            >
              {sending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>Отправить рассылку сейчас ({activeCount})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Success / Error Banners */}
      {sendSuccessMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-emerald-800 dark:text-emerald-300 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="text-sm font-semibold">{sendSuccessMsg}</span>
          </div>
          <button onClick={() => setSendSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {sendErrorMsg && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-rose-800 dark:text-rose-300 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="text-sm font-semibold">{sendErrorMsg}</span>
          </div>
          <button onClick={() => setSendErrorMsg(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Master Scheduler Live Status & Toggle Banner */}
      <div className={`p-5 rounded-2xl border shadow-sm transition-all ${
        settings.enabled 
          ? 'bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 text-white border-emerald-500/40' 
          : 'bg-gradient-to-r from-amber-950 via-slate-900 to-slate-900 text-white border-amber-500/40'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner shrink-0 ${
              settings.enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}>
              <Clock className={`w-6 h-6 ${settings.enabled ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${settings.enabled ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                <h2 className="text-base sm:text-lg font-bold">
                  {settings.enabled ? '🤖 Автоматическая отправка по расписанию ВКЛЮЧЕНА' : '⏸️ Автоматическая отправка ПРИОСТАНОВЛЕНА'}
                </h2>
              </div>
              <div className="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <b>График:</b> {settings.scheduleType === 'daily' && `Ежедневно в ${settings.sendTime}`}
                  {settings.scheduleType === 'workdays' && `По рабочим дням в ${settings.sendTime}`}
                  {settings.scheduleType === 'weekly' && `Раз в неделю в ${settings.sendTime}`}
                  {settings.scheduleType === 'on_change' && `При каждом изменении в Гугл Таблице`}
                  {settings.scheduleType === 'manual' && `Только вручную`}
                </span>
                <span>•</span>
                <span><b>Часовой пояс:</b> {settings.timezone || 'Asia/Almaty'}</span>
                {statusInfo?.currentZonedTime && (
                  <>
                    <span>•</span>
                    <span><b>Серверное время:</b> {statusInfo.currentZonedTime}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Master Toggle Switch & Diagnostics Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCheckDiagnostics}
              disabled={checkingDiag}
              className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 text-xs font-bold rounded-xl border border-blue-400/30 transition-all flex items-center gap-1.5"
            >
              {checkingDiag ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />}
              <span>Диагностика службы</span>
            </button>

            <button
              type="button"
              onClick={handleForceAutoMailing}
              disabled={sending}
              className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-xs font-bold rounded-xl border border-purple-400/30 transition-all flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 text-purple-300" />
              <span>Тест авто-запуска</span>
            </button>

            <div className="flex items-center gap-3 bg-slate-900/90 p-2 px-3 rounded-xl border border-slate-700/80 ml-auto">
              <span className="text-xs font-bold text-slate-200">
                {settings.enabled ? 'Активна' : 'Выключена'}
              </span>
              <button
                type="button"
                onClick={() => {
                  const newEnabled = !settings.enabled;
                  const updated = { ...settings, enabled: newEnabled };
                  setSettings(updated);
                  fetch('/api/mailing/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updated)
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  settings.enabled ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Diagnostic Detailed Info Panel */}
        {diagInfo && (
          <div className="mt-4 p-4 bg-slate-900/90 border border-blue-500/30 rounded-xl text-xs space-y-2 animate-fadeIn text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
              <span className="font-bold text-blue-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Результаты диагностики службы рассылки</span>
              </span>
              <button onClick={() => setDiagInfo(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div><b>Статус службы:</b> {diagInfo.enabled ? '🟢 Включена' : '🔴 Выключена'}</div>
              <div><b>Серверное время ({diagInfo.timezone}):</b> {diagInfo.currentHHmm} ({diagInfo.currentZonedTime})</div>
              <div><b>Целевое время рассылки:</b> {diagInfo.targetSendTime}</div>
              <div><b>Совпадение по времени:</b> {diagInfo.timeMatched ? '✅ Да' : '⏳ Нет (ожидание)'}</div>
              <div><b>Совпадение по дню недели:</b> {diagInfo.dayMatched ? '✅ Да' : '❌ Нет'}</div>
              <div><b>SMTP Сервер:</b> {diagInfo.smtpConfigured ? '🟢 Готов (Настроен)' : '🔴 Ошибка: ' + (diagInfo.smtpError || 'Не настроен')}</div>
              <div><b>Активных получателей:</b> {diagInfo.activeSubscribersCount} чел.</div>
              <div><b>Готов к автоматическому запуску:</b> {diagInfo.shouldRunNow ? '⚡ ДА (сейчас время рассылки)' : '💤 Ожидает наступления времени'}</div>
            </div>
          </div>
        )}

        {/* Diagnostic alert if SMTP password missing */}
        {(!settings.smtpPass && !process.env.SMTP_PASS) && (
          <div className="mt-4 p-3 bg-rose-950/80 border border-rose-500/40 rounded-xl text-xs text-rose-200 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              <b>Внимание:</b> Введите 16-значный <b>Пароль Приложения Google</b> в настройках SMTP ниже для вашей почты <b>ti07kz@gmail.com</b> и нажмите "Сохранить", чтобы автоматическая рассылка работала без ошибок!
            </span>
          </div>
        )}
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Получатели
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              {activeCount} <span className="text-xs font-normal text-slate-400">/ всего {subscribers.length}</span>
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              График отправки
            </p>
            <p className="text-base font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
              {settings.scheduleType === 'daily' && `Ежедневно в ${settings.sendTime}`}
              {settings.scheduleType === 'workdays' && `Пн-Пт в ${settings.sendTime}`}
              {settings.scheduleType === 'weekly' && `Раз в неделю в ${settings.sendTime}`}
              {settings.scheduleType === 'on_change' && `При изменении остатков`}
              {settings.scheduleType === 'manual' && `По кнопке (Ручной)`}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Формат файла
            </p>
            <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              Excel (.xlsx)
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              Google Таблица складов
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl shrink-0">
            <Send className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Всего отправок
            </p>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-0.5">
              {logs.length}
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid: Left = Subscribers Management, Right = Settings & Test Send */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Recipient List & Search */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-200 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span>Список получателей таблицы склада</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Люди, которые получают актуальный файл Excel по электронной почте
              </p>
            </div>

            <button
              onClick={() => handleOpenModal()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-colors flex items-center gap-2 shadow-sm"
            >
              <UserPlus className="w-4 h-4" />
              <span>Добавить человека</span>
            </button>
          </div>

          {/* Filters Bar */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Поиск по имени, email или отделу..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все отделы</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </div>

          {/* Subscribers Table */}
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50 overflow-x-auto flex-1">
            {loading ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <span>Загрузка списка получателей...</span>
              </div>
            ) : filteredSubscribers.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Users className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="font-semibold text-slate-600 dark:text-slate-300 text-sm">Получатели не найдены</p>
                <p className="text-xs text-slate-400">Нажмите "Добавить человека", чтобы внести первого получателя в рассылку</p>
              </div>
            ) : (
              filteredSubscribers.map((sub) => (
                <div 
                  key={sub.id} 
                  className={`p-4 flex flex-wrap items-center justify-between gap-4 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-700/30 ${
                    !sub.isActive ? 'opacity-55' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm ${
                      sub.isActive ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-slate-400'
                    }`}>
                      {sub.name ? sub.name.charAt(0).toUpperCase() : sub.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {sub.name || 'Без имени'}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md">
                          {sub.department || 'Логистика'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        <Mail className="w-3.5 h-3.5 text-blue-500" />
                        <span>{sub.email}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        sub.isActive 
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' 
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        {sub.isActive ? <Check className="w-3 h-3" /> : null}
                        {sub.isActive ? 'Активен' : 'Приостановлен'}
                      </span>
                      {sub.lastSentAt && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Отправлено: {new Date(sub.lastSentAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleSendNow([sub.id])}
                        title="Отправить Excel этому человеку"
                        className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors"
                      >
                        <Send className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleToggleActive(sub)}
                        title={sub.isActive ? "Приостановить рассылку" : "Активировать"}
                        className={`p-1.5 rounded-lg transition-colors ${
                          sub.isActive 
                            ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40' 
                            : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        <Zap className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleOpenModal(sub)}
                        title="Редактировать"
                        className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleDeleteSubscriber(sub.id)}
                        title="Удалить"
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: SMTP Server & Schedule Settings */}
        <div className="space-y-6">
          
          {/* SMTP Configuration Box */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Server className="w-5 h-5 text-blue-600" />
                <span>Отправка через Gmail (ti07kz@gmail.com)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowSmtpSettings(!showSmtpSettings)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                {showSmtpSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {showSmtpSettings && (
              <div className="space-y-3 animate-fadeIn">
                <div className="p-3 bg-emerald-50/80 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-900 dark:text-emerald-200 space-y-2">
                  <p className="font-bold flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Авторизация Google почты (ti07kz@gmail.com)</span>
                  </p>
                  <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                    Для отправки писем с вашего аккаунта Google нужен <strong>Пароль Приложения (App Password)</strong>. Получить его за 30 секунд:
                  </p>
                  <ol className="list-decimal list-inside text-[11px] space-y-1 font-medium text-emerald-900 dark:text-emerald-200 pl-1">
                    <li>Перейдите на страницу Google: <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900">myaccount.google.com/apppasswords</a></li>
                    <li>Введите название приложения (например, <i>"Складской Учет"</i>) и нажмите <strong>Создать</strong>.</li>
                    <li>Вставьте сгенерированный 16-значный пароль в поле ниже и нажмите <strong>Проверить подключение</strong>.</li>
                  </ol>
                </div>

                {/* Presets */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Быстрые шаблоны серверов:
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => applySmtpPreset('gmail')}
                      className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 text-rose-700 dark:text-rose-300 font-bold text-[11px] rounded-lg border border-rose-200 dark:border-rose-800 transition-colors flex items-center gap-1"
                    >
                      <Globe className="w-3 h-3 text-rose-600" />
                      Google Gmail (Рекомендуется)
                    </button>
                    <button
                      type="button"
                      onClick={() => applySmtpPreset('mehkaz')}
                      className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 font-bold text-[11px] rounded-lg border border-indigo-200 dark:border-indigo-800 transition-colors"
                    >
                      mehkaz.kz (Outlook)
                    </button>
                    <button
                      type="button"
                      onClick={() => applySmtpPreset('yandex')}
                      className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 text-amber-800 dark:text-amber-300 font-bold text-[11px] rounded-lg border border-amber-200 dark:border-amber-800 transition-colors"
                    >
                      Yandex
                    </button>
                  </div>
                </div>

                {/* Host & Port */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      SMTP Хост:
                    </label>
                    <input
                      type="text"
                      placeholder="smtp.gmail.com"
                      value={settings.smtpHost || 'smtp.gmail.com'}
                      onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                      className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Порт:
                    </label>
                    <input
                      type="number"
                      placeholder="465"
                      value={settings.smtpPort || 465}
                      onChange={(e) => setSettings({ ...settings, smtpPort: parseInt(e.target.value) || 465 })}
                      className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Login User */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Ваша почта Gmail (Логин):
                  </label>
                  <input
                    type="email"
                    placeholder="ti07kz@gmail.com"
                    value={settings.smtpUser || 'ti07kz@gmail.com'}
                    onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                    <span>Пароль Приложения Google (16 символов):</span>
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-normal"
                    >
                      Получить пароль →
                    </a>
                  </label>
                  <input
                    type="password"
                    placeholder="xxxx xxxx xxxx xxxx"
                    value={settings.smtpPass || ''}
                    onChange={(e) => setSettings({ ...settings, smtpPass: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Sender From Header */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Имя отправителя в письме (From):
                  </label>
                  <input
                    type="text"
                    placeholder='"Складской Учет (Silk Road)" <ti07kz@gmail.com>'
                    value={settings.smtpFrom || '"Складской Учет (Silk Road)" <ti07kz@gmail.com>'}
                    onChange={(e) => setSettings({ ...settings, smtpFrom: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Protection Info */}
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <b>Отказоустойчивый режим (IPv4 + STARTTLS/SSL):</b> Сервер автоматически предотвращает обрывы сокетов («Unexpected socket close») и мгновенно переключается между портами 587 и 465 при сбоях сети.
                  </span>
                </div>

                {/* Action Buttons for SMTP */}
                <div className="pt-1 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleTestSmtpConnection}
                    disabled={testingSmtp || !settings.smtpHost || !settings.smtpUser}
                    className="w-full py-2 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-blue-700 dark:text-blue-300 font-bold text-xs rounded-xl transition-colors border border-blue-200 dark:border-blue-800 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {testingSmtp ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                    )}
                    <span>Проверить подключение SMTP</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    className="w-full py-2 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
                  >
                    Сохранить параметры SMTP
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* Schedule Settings Panel */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/60 pb-3">
              <Settings className="w-5 h-5 text-indigo-600" />
              <span>Расписание & Текст письма</span>
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Режим автоматической отправки:
                </label>
                <select
                  value={settings.scheduleType}
                  onChange={(e) => setSettings({ ...settings, scheduleType: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                >
                  <option value="daily">Ежедневно (в фиксированное время)</option>
                  <option value="workdays">По рабочим дням (Пн-Пт в выбранное время)</option>
                  <option value="weekly">Раз в неделю (по Понедельникам)</option>
                  <option value="test_interval">🧪 Тестовый режим (Каждые N минут для быстрой проверки)</option>
                  <option value="on_change">⚡ Авто-триггер при изменении в Гугл Таблице</option>
                  <option value="manual">Только по вашей кнопке (Ручной запуск)</option>
                </select>
              </div>

              {settings.scheduleType === 'test_interval' && (
                <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-200 space-y-2">
                  <label className="block font-bold flex items-center gap-1.5 text-purple-900 dark:text-purple-300">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <span>Интервал регулярной отправки для тестов:</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 5, 10, 15].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSettings({ ...settings, intervalMinutes: m })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          (settings.intervalMinutes || 1) === m
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-800 text-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700 hover:bg-purple-100'
                        }`}
                      >
                        Каждые {m} мин
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Timezone Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span>Часовой пояс для графика:</span>
                  <Globe className="w-3.5 h-3.5 text-blue-500" />
                </label>
                <select
                  value={settings.timezone || 'Asia/Almaty'}
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  <option value="Asia/Almaty">🇰🇿 Казахстан (Алматы / Астана UTC+5)</option>
                  <option value="Asia/Tashkent">🇺🇿 Узбекистан (Ташкент UTC+5)</option>
                  <option value="Asia/Bishkek">🇰🇬 Кыргызстан (Бишкек UTC+6)</option>
                  <option value="Europe/Moscow">🇷🇺 Москва / Минск (UTC+3)</option>
                  <option value="UTC">🌐 Всемирное время (UTC+0)</option>
                </select>
              </div>

              {(settings.scheduleType === 'daily' || settings.scheduleType === 'workdays' || settings.scheduleType === 'weekly') && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Время отправки писем:
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="time"
                      value={settings.sendTime || '09:00'}
                      onChange={(e) => setSettings({ ...settings, sendTime: e.target.value })}
                      className="px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                    <div className="flex flex-wrap gap-1 flex-1">
                      {['08:00', '09:00', '10:00', '14:00', '18:00'].map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setSettings({ ...settings, sendTime: t })}
                          className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            settings.sendTime === t
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSetQuickTime(1)}
                    disabled={sending}
                    className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>⚡ Установить [Текущее время + 1 мин] для быстрой проверки</span>
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Тема электронного письма:
                </label>
                <input
                  type="text"
                  value={settings.emailSubject}
                  onChange={(e) => setSettings({ ...settings, emailSubject: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Текст сопровождения письма:
                </label>
                <textarea
                  rows={3}
                  value={settings.emailBody}
                  onChange={(e) => setSettings({ ...settings, emailBody: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium resize-none"
                />
              </div>

              <button
                onClick={handleSaveSettings}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Сохранить параметры расписания</span>
              </button>
            </div>
          </div>

          {/* Test Email Box */}
          <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-2 text-blue-300">
              <Mail className="w-4 h-4" />
              <span>Тестовая отправка на любой адрес</span>
            </h3>
            <p className="text-xs text-slate-300">
              Введите ваш e-mail, чтобы моментально получить тестовое письмо с выгруженным файлом Excel:
            </p>

            <div className="flex gap-2">
              <input
                type="email"
                placeholder="myemail@company.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={handleSendTestEmail}
                disabled={sendingTest || !testEmail}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                {sendingTest ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Тест</span>
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* History Log Section */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 pb-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <History className="w-5 h-5 text-purple-600" />
            <span>Журнал проведенных отправок</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">
            Всего записей: {logs.length}
          </span>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            История отправок пуста. Нажмите "Отправить рассылку сейчас", чтобы совершить первую отправку.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {logs.slice(0, 10).map((log) => (
              <div key={log.id} className="py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${
                    log.status === 'success' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40' : 'bg-rose-50 text-rose-600 dark:bg-rose-950/40'
                  }`}>
                    {log.status === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {log.fileName}
                      </span>
                      <span className="text-slate-400">({log.fileSize || 'Excel'})</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Получатели ({log.recipientsCount}): {log.recipientEmails.slice(0, 3).join(', ')}{log.recipientEmails.length > 3 ? '...' : ''}
                    </p>
                    {log.errorMessage && (
                      <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">
                        ⚠️ Причина ошибки: {log.errorMessage}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    {new Date(log.timestamp).toLocaleString('ru-RU')}
                  </span>
                  <p className="text-[10px] text-slate-400 capitalize mt-0.5">
                    Источник: {log.triggerSource === 'manual' ? 'Ручной запуск' : log.triggerSource === 'test' ? 'Тестовая отправка' : 'Автоматически'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Subscriber Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                <span>{editingSub ? 'Редактировать получателя' : 'Добавить получателя рассылки'}</span>
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSubscriber} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ФИО или Имя получателя:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Например: Алина (Менеджер закупа)"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  E-mail адрес получателя:
                </label>
                <input
                  type="email"
                  required
                  placeholder="manager@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Отдел / Роль:
                </label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  <option value="Логистика / Склад">Логистика / Склад</option>
                  <option value="Закупки">Отдел Закупок</option>
                  <option value="Продажи">Отдел Продаж</option>
                  <option value="Руководство">Руководство</option>
                  <option value="Внешний клиент / Партнер">Внешний клиент / Партнер</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="sub-active-chk"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                />
                <label htmlFor="sub-active-chk" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  Получатель активен (включать в авто-рассылку)
                </label>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
                >
                  {editingSub ? 'Сохранить изменения' : 'Добавить получателя'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
