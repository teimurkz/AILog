import type { StageColor } from '../../../shared/truck-tracking';

// Full class names are spelled out so Tailwind can find them.
export const COLOR_STYLES: Record<StageColor, { pill: string; dot: string; tab: string; column: string; name: string }> = {
  blue: { pill: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200', dot: 'bg-blue-500', tab: 'border-blue-500 text-blue-700', column: 'border-t-blue-500', name: 'Синий' },
  amber: { pill: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200', dot: 'bg-amber-500', tab: 'border-amber-500 text-amber-800', column: 'border-t-amber-500', name: 'Жёлтый' },
  emerald: { pill: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', dot: 'bg-emerald-500', tab: 'border-emerald-500 text-emerald-700', column: 'border-t-emerald-500', name: 'Зелёный' },
  violet: { pill: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', dot: 'bg-violet-500', tab: 'border-violet-500 text-violet-700', column: 'border-t-violet-500', name: 'Фиолетовый' },
  rose: { pill: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200', dot: 'bg-rose-500', tab: 'border-rose-500 text-rose-700', column: 'border-t-rose-500', name: 'Красный' },
  cyan: { pill: 'bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200', dot: 'bg-cyan-500', tab: 'border-cyan-500 text-cyan-800', column: 'border-t-cyan-500', name: 'Бирюзовый' },
  orange: { pill: 'bg-orange-50 text-orange-800 ring-1 ring-orange-200', dot: 'bg-orange-500', tab: 'border-orange-500 text-orange-800', column: 'border-t-orange-500', name: 'Оранжевый' },
  slate: { pill: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200', dot: 'bg-slate-400', tab: 'border-slate-500 text-slate-700', column: 'border-t-slate-400', name: 'Серый' },
};
