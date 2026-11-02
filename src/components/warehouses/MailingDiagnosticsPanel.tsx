import React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { MailingDiagnostics } from '../../../shared/mailing-diagnostics';
import { pickTexts, type CrmLanguage } from '../../../shared/i18n';
import { MAILING_TEXT } from './mailing-i18n';

// The language is passed in rather than read from the context so the panel renders on its own
// (the scheduler tests render it without a LanguageProvider, in Russian).
export function MailingDiagnosticsPanel({ diagnostics: d, onClose, language = 'ru' }: { diagnostics: MailingDiagnostics; onClose: () => void; language?: CrmLanguage }) {
  const t = pickTexts(MAILING_TEXT, language).diagnostics;
  const fixedTime = !['manual', 'test_interval', 'on_change'].includes(d.scheduleType || '');
  const yesNo = (value: boolean | null) => value === null ? t.noDataMark : value ? t.yes : t.no;
  return (
    <div className="mt-4 p-4 bg-slate-900/90 border border-blue-500/30 rounded-xl text-xs space-y-2 animate-fadeIn text-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/80 pb-2">
        <span className="font-bold text-blue-300 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 shrink-0" />{t.title}</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label={t.close}><X className="w-4 h-4" /></button>
      </div>
      {d.apiUpdateRequired && <p className="text-amber-200">{t.oldApi}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1 text-[11px]">
        <div><b>{t.schedule}</b> {d.enabled === null ? t.noDataMark : d.enabled && d.scheduleType !== 'manual' ? t.on : t.off}</div>
        <div><b>{t.service}</b> {d.schedulerHealthy === null ? t.noDataMark : d.schedulerHealthy ? t.heartbeat : t.noHeartbeat}</div>
        <div><b>{t.serverTime(d.timezone || '')}</b> <bdi dir="ltr">{d.currentZonedTime || d.currentHHmm || t.noData}</bdi></div>
        <div><b>{t.sendTime}</b> {fixedTime ? d.targetSendTime || t.noData : d.scheduleType === 'manual' ? t.byButton : d.scheduleType === 'on_change' ? t.onChange : t.byInterval}</div>
        {fixedTime && <><div><b>{t.timeMatched}</b> {yesNo(d.timeMatched)}</div><div><b>{t.dayMatched}</b> {yesNo(d.dayMatched)}</div></>}
        <div><b>{t.smtp}</b> {d.smtpConfigured === null ? t.noServerData : d.smtpConfigured ? t.smtpFilled : d.smtpError || t.smtpEmpty}</div>
        <div><b>{t.activeRecipients}</b> {d.activeSubscribersCount ?? t.noData}</div>
      </div>
      <p className="text-slate-400">{t.smtpNote}</p>
      <p className="pt-1"><b>{t.autoRun}</b> {d.statusMessage}</p>
    </div>
  );
}
