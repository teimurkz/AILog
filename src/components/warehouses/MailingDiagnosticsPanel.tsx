import React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { MailingDiagnostics } from '../../../shared/mailing-diagnostics';

export function MailingDiagnosticsPanel({ diagnostics: d, onClose }: { diagnostics: MailingDiagnostics; onClose: () => void }) {
  const fixedTime = !['manual', 'test_interval', 'on_change'].includes(d.scheduleType || '');
  const yesNo = (value: boolean | null) => value === null ? '— Нет данных' : value ? '✅ Да' : 'Нет';
  return (
    <div className="mt-4 p-4 bg-slate-900/90 border border-blue-500/30 rounded-xl text-xs space-y-2 animate-fadeIn text-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/80 pb-2">
        <span className="font-bold text-blue-300 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 shrink-0" />Результаты диагностики службы рассылки</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Закрыть диагностику"><X className="w-4 h-4" /></button>
      </div>
      {d.apiUpdateRequired && <p className="text-amber-200">Получен ответ старой версии сервера. Недостающие поля показаны как «Нет данных».</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1 text-[11px]">
        <div><b>Расписание:</b> {d.enabled === null ? '— Нет данных' : d.enabled && d.scheduleType !== 'manual' ? 'Включено' : 'Выключено'}</div>
        <div><b>Работа службы:</b> {d.schedulerHealthy === null ? '— Нет данных' : d.schedulerHealthy ? '🟢 Есть свежий сигнал' : '⚠️ Нет свежего сигнала'}</div>
        <div><b>Серверное время{d.timezone ? ` (${d.timezone})` : ''}:</b> {d.currentZonedTime || d.currentHHmm || 'Нет данных'}</div>
        <div><b>Время рассылки:</b> {fixedTime ? d.targetSendTime || 'Нет данных' : d.scheduleType === 'manual' ? 'По кнопке' : d.scheduleType === 'on_change' ? 'При изменении таблицы' : 'По интервалу'}</div>
        {fixedTime && <><div><b>Совпадение по времени:</b> {yesNo(d.timeMatched)}</div><div><b>День по расписанию:</b> {yesNo(d.dayMatched)}</div></>}
        <div><b>Настройки SMTP:</b> {d.smtpConfigured === null ? '— Нет данных от сервера' : d.smtpConfigured ? 'Заполнены' : d.smtpError || 'Не заполнены'}</div>
        <div><b>Активных получателей:</b> {d.activeSubscribersCount ?? 'Нет данных'}</div>
      </div>
      <p className="text-slate-400">Наличие настроек SMTP не подтверждает соединение. Для проверки используйте кнопку «Проверить подключение SMTP».</p>
      <p className="pt-1"><b>Автоматический запуск:</b> {d.statusMessage}</p>
    </div>
  );
}
