import { firebaseFetch, downloadFirebaseFile } from '../../services/firebase-fetch';
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
import { normalizeMailingDiagnostics, type MailingDiagnostics } from '../../../shared/mailing-diagnostics';
import { MailingDiagnosticsPanel } from './MailingDiagnosticsPanel';
import { MAILING_TEXT } from './mailing-i18n';
import { useSectionText } from '../../i18n/useSectionText';

// Department values are stored in Russian; the dictionary gives their labels.
const DEPARTMENTS = ['Логистика / Склад', 'Закупки', 'Продажи', 'Руководство', 'Внешний клиент / Партнер'];

export const WarehouseAutoMailing: React.FC = () => {
  const { text: t, language, locale } = useSectionText(MAILING_TEXT);
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
  const [diagInfo, setDiagInfo] = useState<MailingDiagnostics | null>(null);
  const [checkingDiag, setCheckingDiag] = useState<boolean>(false);

  const schedulerHealthy = statusInfo?.diagnostics?.schedulerHealthy === true;
  const schedulerError = statusInfo?.diagnostics?.lastError;
  const automaticReady = settings.enabled && settings.scheduleType !== 'manual' && schedulerHealthy && !schedulerError;

  const handleCheckDiagnostics = async () => {
    setCheckingDiag(true);
    setDiagInfo(null);
    try {
      const res = await firebaseFetch('/api/mailing/check-scheduler');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || t.diagnosticsFailed);
      setDiagInfo(normalizeMailingDiagnostics(d));
    } catch (e: any) {
      setSendErrorMsg(e.message || t.diagnosticsFailed);
    } finally {
      setCheckingDiag(false);
    }
  };

  const handleForceAutoMailing = async () => {
    setSending(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);
    try {
      const res = await firebaseFetch('/api/mailing/force-cron-trigger', { method: 'POST', signal: AbortSignal.timeout(240000) });
      const data = await res.json();
      if (res.ok && data.success) {
        setSendSuccessMsg(data.warning || data.message || t.sendDone);
        fetchData();
      } else {
        setSendErrorMsg(data.error || data.message || t.reportSendFailed);
      }
    } catch (e: any) {
      setSendErrorMsg(e.message || t.serverError);
    } finally {
      setSending(false);
    }
  };

  const handleSetQuickTime = async (offsetMinutes: number = 1) => {
    setSending(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);
    try {
      const res = await firebaseFetch('/api/mailing/set-quick-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offsetMinutes })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSendSuccessMsg(data.message || t.quickTimeSet(data.sendTime));
        fetchData();
      } else {
        setSendErrorMsg(data.error || t.quickTimeFailed);
      }
    } catch (e: any) {
      setSendErrorMsg(e.message || t.serverError);
    } finally {
      setSending(false);
    }
  };

  // Load Data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [subsRes, setRes, logsRes, statusRes] = await Promise.all([
        firebaseFetch('/api/mailing/subscribers'),
        firebaseFetch('/api/mailing/settings'),
        firebaseFetch('/api/mailing/logs'),
        firebaseFetch('/api/mailing/status')
      ]);

      if (subsRes.ok) {
        const d = await subsRes.json();
        setSubscribers(d.subscribers || []);
      }
      if (!subsRes.ok || !setRes.ok || !logsRes.ok || !statusRes.ok) { setSendErrorMsg(t.loadFailed); }
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
        const res = await firebaseFetch('/api/mailing/status');
        if (res.ok) {
          const d = await res.json();
          setStatusInfo(d);
        }
        else { setStatusInfo(null); }
      } catch (e) { setStatusInfo(null); }
    }, 10000);

    return () => clearInterval(statusInterval);
  }, []);

  // Save Settings
  const handleSaveSettings = async () => {
    try {
      const res = await firebaseFetch('/api/mailing/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
        setSendSuccessMsg(t.settingsSaved);
        setTimeout(() => setSendSuccessMsg(null), 4000);
      } else {
        const data = await res.json();
        setSendErrorMsg(data.error || t.settingsSaveFailed);
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSendErrorMsg(t.settingsSaveFailed);
    }
  };

  // Test SMTP Connection
  const handleTestSmtpConnection = async () => {
    setTestingSmtp(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);

    try {
      const res = await firebaseFetch('/api/mailing/test-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSendSuccessMsg(data.message || t.smtpOk);
      } else {
        setSendErrorMsg(data.error || t.smtpFailed);
      }
    } catch (err: any) {
      setSendErrorMsg(err.message || t.smtpNetworkFailed);
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

      const res = await firebaseFetch('/api/mailing/subscribers', {
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
      await firebaseFetch('/api/mailing/subscribers', {
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
    if (!confirm(t.confirmDelete)) return;
    try {
      await firebaseFetch(`/api/mailing/subscribers/${id}`, { method: 'DELETE' });
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
      const res = await firebaseFetch('/api/mailing/send', {
        method: 'POST',
        signal: AbortSignal.timeout(240000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSubscriberIds,
          triggerSource: 'manual'
        })
      });

      const result = await res.json();
      if (res.ok && result.success) {
        setSendSuccessMsg(result.warning || result.message || t.sendDone);
        fetchData();
      } else {
        setSendErrorMsg(result.error || result.message || t.mailingSendFailed);
      }
    } catch (err: any) {
      setSendErrorMsg(t.sendUnconfirmed);
    } finally {
      setSending(false);
    }
  };

  // Send Single Test Email
  const handleSendTestEmail = async () => {
    if (!testEmail || !testEmail.includes('@')) {
      alert(t.invalidEmail);
      return;
    }

    setSendingTest(true);
    setSendSuccessMsg(null);
    setSendErrorMsg(null);

    try {
      const res = await firebaseFetch('/api/mailing/send', {
        method: 'POST',
        signal: AbortSignal.timeout(240000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customEmail: testEmail,
          triggerSource: 'test'
        })
      });

      const result = await res.json();
      if (res.ok && result.success) {
        setSendSuccessMsg(result.warning || result.message || t.sendDone);
        setTestEmail('');
        fetchData();
      } else {
        setSendErrorMsg(result.error || result.message || t.testSendFailed);
      }
    } catch (err: any) {
      setSendErrorMsg(t.sendUnconfirmed);
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
    <div className="mailing-page w-full min-w-0 space-y-6">
      {/* Top Banner & Quick Controls */}
      <div className="crm-page-header relative">
        <div className="absolute top-0 right-0 transform -translate-y-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        
        <div className="relative z-10 flex min-w-0 flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="crm-eyebrow inline-flex items-center gap-2 px-3 py-1 bg-white/15 backdrop-blur-md rounded-full text-xs font-semibold text-blue-100">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>{t.eyebrow}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {t.title}
            </h2>
            <p className="text-sm text-blue-100/90 max-w-2xl">
              {t.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void downloadFirebaseFile('/api/mailing/download-excel', 'warehouse_report.xlsx').catch(error => alert(error.message))}
              className="crm-button-secondary px-4 py-2.5 font-medium text-sm rounded-xl transition-all flex items-center gap-2 border"
            >
              <Download className="w-4 h-4 text-emerald-300" />
              <span>{t.downloadExcel}</span>
            </button>

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
              <span>{t.sendNow(activeCount)}</span>
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
          <button onClick={() => setSendSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700" aria-label={t.close}>
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
          <button onClick={() => setSendErrorMsg(null)} className="text-rose-500 hover:text-rose-700" aria-label={t.close}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Master Scheduler Live Status & Toggle Banner */}
      <div className={`crm-service-status p-5 rounded-2xl border shadow-sm transition-all ${
        automaticReady
          ? 'bg-emerald-600 text-white border-emerald-500/40'
          : 'bg-amber-600 text-white border-amber-500/40'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner shrink-0 ${
              automaticReady ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}>
              <Clock className={`w-6 h-6 ${automaticReady ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${automaticReady ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                <h2 className="text-base sm:text-lg font-bold">
                  {!settings.enabled || settings.scheduleType === 'manual' ? t.statusOff : !schedulerHealthy ? t.statusUnconfirmed : schedulerError ? t.statusLastCheckFailed : t.statusOk}
                </h2>
              </div>
              {settings.enabled && !schedulerHealthy && <p className="text-xs text-amber-200 mt-1">{t.noHeartbeat}</p>}
              {schedulerError && <p className="text-xs text-amber-200 mt-1">{schedulerError}</p>}
              <div className="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <b>{t.scheduleLabel}</b> {settings.scheduleType === 'daily' && t.scheduleDaily(settings.sendTime)}
                  {settings.scheduleType === 'workdays' && t.scheduleWorkdays(settings.sendTime)}
                  {settings.scheduleType === 'weekly' && t.scheduleWeekly(settings.sendTime)}
                  {settings.scheduleType === 'test_interval' && t.scheduleTestInterval(settings.intervalMinutes || 1)}
                  {settings.scheduleType === 'on_change' && t.scheduleOnChange}
                  {settings.scheduleType === 'manual' && t.scheduleManual}
                </span>
                <span>•</span>
                <span><b>{t.timezoneLabel}</b> <bdi dir="ltr">{settings.timezone || 'Asia/Almaty'}</bdi></span>
                {statusInfo?.currentZonedTime && (
                  <>
                    <span>•</span>
                    <span><b>{t.serverTimeLabel}</b> <bdi dir="ltr">{statusInfo.currentZonedTime}</bdi></span>
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
              <span>{t.checkService}</span>
            </button>

            <button
              type="button"
              onClick={handleForceAutoMailing}
              disabled={sending}
              className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-xs font-bold rounded-xl border border-purple-400/30 transition-all flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 text-purple-300" />
              <span>{t.sendBySettings}</span>
            </button>

            <div className="flex items-center gap-3 bg-slate-900/90 p-2 px-3 rounded-xl border border-slate-700/80 ms-auto">
              <span className="text-xs font-bold text-slate-200">
                {settings.enabled ? t.mailingOn : t.mailingOff}
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await firebaseFetch('/api/mailing/settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ enabled: !settings.enabled })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || t.settingSaveFailed);
                    setSettings(data.settings);
                  } catch (error: any) { setSendErrorMsg(error.message); }
                }}
                role="switch"
                aria-checked={settings.enabled}
                aria-label={t.toggleMailing}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  settings.enabled ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.enabled ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-1 rtl:-translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {diagInfo && <MailingDiagnosticsPanel diagnostics={diagInfo} onClose={() => setDiagInfo(null)} language={language} />}

        {/* Diagnostic alert if SMTP password missing */}
        {(!settings.smtpConfigured && !settings.smtpPass && !statusInfo?.hasSmtpPass) && (
          <div className="mt-4 p-3 bg-rose-950/80 border border-rose-500/40 rounded-xl text-xs text-rose-200 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              <b>{t.smtpWarningLead}</b> {t.smtpWarning(settings.smtpUser || 'ti07kz@gmail.com')}
            </span>
          </div>
        )}
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t.recipients}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              {activeCount} <span className="text-xs font-normal text-slate-400">{t.ofTotal(subscribers.length)}</span>
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t.sendSchedule}
            </p>
            <p className="text-base font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
              {settings.scheduleType === 'daily' && t.scheduleDaily(settings.sendTime)}
              {settings.scheduleType === 'workdays' && t.scheduleWorkdaysShort(settings.sendTime)}
              {settings.scheduleType === 'weekly' && t.scheduleWeekly(settings.sendTime)}
              {settings.scheduleType === 'test_interval' && t.scheduleTestInterval(settings.intervalMinutes || 1)}
              {settings.scheduleType === 'on_change' && t.scheduleOnChangeShort}
              {settings.scheduleType === 'manual' && t.scheduleManualShort}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t.fileFormat}
            </p>
            <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              Excel (.xlsx)
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              {t.warehouseSheet}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl shrink-0">
            <Send className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t.logEntries}
            </p>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-0.5">
              {logs.length}
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid: Left = Subscribers Management, Right = Settings & Test Send */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column: Recipient List & Search */}
        <div className="min-w-0 xl:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-200 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span>{t.recipientsTitle}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {t.recipientsHint}
              </p>
            </div>

            <button
              onClick={() => handleOpenModal()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-colors flex items-center gap-2 shadow-sm"
            >
              <UserPlus className="w-4 h-4" />
              <span>{t.addPerson}</span>
            </button>
          </div>

          {/* Filters Bar */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800 flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-52">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full ps-9 pe-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">{t.allDepartments}</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>{t.departments[dept!] || dept}</option>
              ))}
            </select>
          </div>

          {/* Subscribers Table */}
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50 min-w-0 flex-1">
            {loading ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <span>{t.loadingRecipients}</span>
              </div>
            ) : filteredSubscribers.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Users className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="font-semibold text-slate-600 dark:text-slate-300 text-sm">{t.noRecipients}</p>
                <p className="text-xs text-slate-400">{t.noRecipientsHint}</p>
              </div>
            ) : (
              filteredSubscribers.map((sub) => (
                <div 
                  key={sub.id} 
                  className={`p-4 flex flex-wrap items-center justify-between gap-4 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-700/30 ${
                    !sub.isActive ? 'opacity-55' : ''
                  }`}
                >
                  <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                    <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm ${
                      sub.isActive ? 'bg-blue-600' : 'bg-slate-400'
                    }`}>
                      {sub.name ? sub.name.charAt(0).toUpperCase() : sub.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {sub.name || t.noName}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md">
                          {t.departments[sub.department || 'Логистика'] || sub.department}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        <Mail className="w-3.5 h-3.5 text-blue-500" />
                        <bdi dir="ltr">{sub.email}</bdi>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-end hidden sm:block">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        sub.isActive 
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' 
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        {sub.isActive ? <Check className="w-3 h-3" /> : null}
                        {sub.isActive ? t.active : t.paused}
                      </span>
                      {sub.lastSentAt && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {t.lastSent(new Date(sub.lastSentAt).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleSendNow([sub.id])}
                        title={t.sendToPerson}
                        aria-label={t.sendToPerson}
                        className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors"
                      >
                        <Send className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleToggleActive(sub)}
                        title={sub.isActive ? t.pause : t.activate}
                        aria-label={sub.isActive ? t.pause : t.activate}
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
                        title={t.edit}
                        aria-label={t.edit}
                        className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleDeleteSubscriber(sub.id)}
                        title={t.delete}
                        aria-label={t.delete}
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
                <span>{t.smtpTitle(settings.smtpUser || 'ti07kz@gmail.com')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowSmtpSettings(!showSmtpSettings)}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label={t.toggleSmtp}
                aria-expanded={showSmtpSettings}
              >
                {showSmtpSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {showSmtpSettings && (
              <div className="space-y-3 animate-fadeIn">
                <div className="p-3 bg-emerald-50/80 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-900 dark:text-emerald-200 space-y-2">
                  <p className="font-bold flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{t.googleAuthTitle(settings.smtpUser || 'ti07kz@gmail.com')}</span>
                  </p>
                  <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                    {t.googleAuthIntro}
                  </p>
                  <ol className="list-decimal list-inside text-[11px] space-y-1 font-medium text-emerald-900 dark:text-emerald-200 ps-1">
                    <li>{t.googleStep1} <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900">myaccount.google.com/apppasswords</a></li>
                    <li>{t.googleStep2}</li>
                    <li>{t.googleStep3}</li>
                  </ol>
                </div>

                {/* Presets */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    {t.presets}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => applySmtpPreset('gmail')}
                      className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 text-rose-700 dark:text-rose-300 font-bold text-[11px] rounded-lg border border-rose-200 dark:border-rose-800 transition-colors flex items-center gap-1"
                    >
                      <Globe className="w-3 h-3 text-rose-600" />
                      {t.presetGmail}
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
                      {t.smtpHost}
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
                      {t.port}
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
                    {t.smtpUser}
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
                    <span>{t.smtpPass}</span>
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-normal"
                    >
                      {t.getPassword}
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
                    {t.smtpFrom}
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
                    <b>{t.secureLead}</b> {t.secureInfo}
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
                    <span>{t.testSmtp}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    className="w-full py-2 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
                  >
                    {t.saveSmtp}
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* Schedule Settings Panel */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/60 pb-3">
              <Settings className="w-5 h-5 text-indigo-600" />
              <span>{t.scheduleTitle}</span>
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.scheduleMode}
                </label>
                <select
                  value={settings.scheduleType}
                  onChange={(e) => setSettings({ ...settings, scheduleType: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                >
                  <option value="daily">{t.modeDaily}</option>
                  <option value="workdays">{t.modeWorkdays}</option>
                  <option value="weekly">{t.modeWeekly}</option>
                  <option value="test_interval">{t.modeTestInterval}</option>
                  <option value="on_change">{t.modeOnChange}</option>
                  <option value="manual">{t.modeManual}</option>
                </select>
              </div>

              {settings.scheduleType === 'test_interval' && (
                <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-200 space-y-2">
                  <label className="block font-bold flex items-center gap-1.5 text-purple-900 dark:text-purple-300">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <span>{t.testIntervalLabel}</span>
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
                        {t.everyMinutes(m)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Timezone Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span>{t.timezoneForSchedule}</span>
                  <Globe className="w-3.5 h-3.5 text-blue-500" />
                </label>
                <select
                  value={settings.timezone || 'Asia/Almaty'}
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {Object.entries(t.timezones).map(([zone, label]) => (
                    <option key={zone} value={zone}>{label}</option>
                  ))}
                </select>
              </div>

              {(settings.scheduleType === 'daily' || settings.scheduleType === 'workdays' || settings.scheduleType === 'weekly') && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.sendTime}
                  </label>
                  <div className="flex flex-wrap gap-2 items-center">
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
                    <span>{t.quickTime}</span>
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.emailSubject}
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
                  {t.emailBody}
                </label>
                <textarea
                  rows={3}
                  value={settings.emailBody}
                  onChange={(e) => setSettings({ ...settings, emailBody: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium resize-none"
                />
                <p className="text-[11px] text-slate-400 mt-1">{t.emailContentHint}</p>
              </div>

              <button
                onClick={handleSaveSettings}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{t.saveSchedule}</span>
              </button>
            </div>
          </div>

          {/* Test Email Box */}
          <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-2 text-blue-300">
              <Mail className="w-4 h-4" />
              <span>{t.testTitle}</span>
            </h3>
            <p className="text-xs text-slate-300">
              {t.testHint}
            </p>

            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                placeholder="myemail@company.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="min-w-0 flex-1 basis-40 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={handleSendTestEmail}
                disabled={sendingTest || !testEmail}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                {sendingTest ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{t.test}</span>
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* History Log Section */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/60 pb-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <History className="w-5 h-5 text-purple-600" />
            <span>{t.logTitle}</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">
            {t.logTotal(logs.length)}
          </span>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            {t.logEmpty}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {logs.slice(0, 10).map((log) => (
              <div key={log.id} className="py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3">
                  <div className={`shrink-0 p-2 rounded-xl ${
                    log.status === 'success' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40' : 'bg-rose-50 text-rose-600 dark:bg-rose-950/40'
                  }`}>
                    {log.status === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {log.fileName}
                      </span>
                      <span className="text-slate-400">({log.fileSize || 'Excel'})</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {t.logRecipients(log.recipientsCount)} <bdi dir="ltr">{log.recipientEmails.slice(0, 3).join(', ')}{log.recipientEmails.length > 3 ? '...' : ''}</bdi>
                    </p>
                    {log.errorMessage && (
                      <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">
                        ⚠️ {t.logError} {log.errorMessage}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-end">
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    {new Date(log.timestamp).toLocaleString(locale)}
                  </span>
                  <p className="text-[10px] text-slate-400 capitalize mt-0.5">
                    {t.logSource} {log.triggerSource === 'manual' ? t.sourceManual : log.triggerSource === 'test' ? t.sourceTest : t.sourceAuto}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Subscriber Modal */}
      {isModalOpen && (
        <div className="crm-dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="crm-dialog bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                <span>{editingSub ? t.dialogEdit : t.dialogAdd}</span>
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label={t.close}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSubscriber} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.fieldName}
                </label>
                <input
                  type="text"
                  required
                  placeholder={t.fieldNamePlaceholder}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.fieldEmail}
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
                  {t.fieldDepartment}
                </label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{t.departments[dept]}</option>)}
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
                  {t.fieldActive}
                </label>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
                >
                  {editingSub ? t.saveChanges : t.addRecipient}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
