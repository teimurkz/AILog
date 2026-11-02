import React from 'react';
import { Check, Eye, Pencil, RotateCcw } from 'lucide-react';
import { CRM_SECTIONS, cleanAccess, roleAccess, type AccessMap, type CrmSection } from '../../../shared/access-policy';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../types';
import { SECTION_MENU } from '../common/sections';
import { useSectionText } from '../../i18n/useSectionText';
import { ADMIN_TEXTS } from './admin-i18n';

const editable = new Set<string>(CRM_SECTIONS.filter(section => section.editable).map(section => section.id));
const sameAccess = (a: AccessMap, b: AccessMap) => CRM_SECTIONS.every(({ id }) => (a[id] || '') === (b[id] || ''));

/** Short summary for the users table: "по роли" or how many sections are open. */
export function accessSummary(user: UserProfile, text = ADMIN_TEXTS.ru.access) {
  const saved = cleanAccess(user.access);
  if (!saved) return text.byRole;
  const open = Object.keys(saved).length;
  return open ? text.custom(open, CRM_SECTIONS.length) : text.allHidden;
}

/** Checkboxes "видит / изменяет" per CRM section for one user. */
export const AccessEditor = ({ user, onSave }: { user: UserProfile; onSave: (access: AccessMap | null) => Promise<unknown> }) => {
  const { t, isRTL } = useLanguage();
  const text = useSectionText(ADMIN_TEXTS).text.access;
  const saved = cleanAccess(user.access);
  const byRole = roleAccess(user.role);
  const [draft, setDraft] = React.useState<AccessMap>(() => saved || byRole);
  const [state, setState] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = !sameAccess(draft, saved || byRole);

  const set = (id: CrmSection, level: 'view' | 'edit' | null) => {
    setState('idle');
    setDraft(old => {
      const next = { ...old };
      if (level) next[id] = level; else delete next[id];
      return next;
    });
  };
  const save = async (access: AccessMap | null) => {
    setState('saving');
    try {
      await onSave(access);
      if (!access) setDraft(byRole);
      setState('saved');
    } catch { setState('error'); }
  };
  const all = (level: 'view' | 'edit' | null) => {
    setState('idle');
    setDraft(level ? Object.fromEntries(CRM_SECTIONS.map(({ id }) => [id, level === 'edit' && editable.has(id) ? 'edit' : 'view'])) : {});
  };
  const button = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50';

  return (
    <div className="space-y-4 bg-slate-50/70 px-4 py-4 sm:px-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="me-auto text-xs text-slate-500">
          {saved ? text.customNote : text.roleNote}
        </p>
        <button type="button" className={cn(button, 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100')} onClick={() => all('edit')}>{text.all}</button>
        <button type="button" className={cn(button, 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100')} onClick={() => all('view')}>{text.viewOnly}</button>
        <button type="button" className={cn(button, 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100')} onClick={() => all(null)}>{text.nothing}</button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {SECTION_MENU.map(section => {
          const level = draft[section.id];
          const Icon = section.icon;
          return (
            <div key={section.id} className={cn('flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5', level ? 'border-blue-200' : 'border-slate-200 opacity-80')}>
              <Icon className={cn('h-4 w-4 shrink-0', level ? 'text-blue-600' : 'text-slate-400')} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{t(section.labelKey as any) || section.fallback}</span>
              <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-600" title={text.seesTitle}>
                <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={Boolean(level)}
                  onChange={event => set(section.id, event.target.checked ? 'view' : null)} />
                <Eye className="h-3.5 w-3.5" />{text.sees}
              </label>
              {editable.has(section.id) && (
                <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-600" title={text.editsTitle}>
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={level === 'edit'}
                    onChange={event => set(section.id, event.target.checked ? 'edit' : level ? 'view' : null)} />
                  <Pencil className="h-3.5 w-3.5" />{text.edits}
                </label>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!dirty || state === 'saving'} onClick={() => save(draft)}
          className={cn(button, 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700')}>
          <Check className="h-3.5 w-3.5" />{state === 'saving' ? text.saving : text.save}
        </button>
        {saved && (
          <button type="button" disabled={state === 'saving'} onClick={() => save(null)}
            className={cn(button, 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100')}>
            <RotateCcw className="h-3.5 w-3.5" />{text.reset}
          </button>
        )}
        {state === 'saved' && <span className="text-xs font-medium text-emerald-700">{text.saved}</span>}
        {state === 'error' && <span className="text-xs font-medium text-red-700">{text.failed}</span>}
      </div>
    </div>
  );
};
