import type { SectionTexts } from './i18n';

// Issue texts of the SVH parking reconciliation (shared/svh-reconcile.ts) in the CRM's three languages.
// Dates come in already formatted (dd.mm.yyyy); `shift` is signed days ("+2", "-1").

const ru = {
  field: { arrived: 'Заезд', unloaded: 'Выгрузка', moved: 'Перемещение' },
  badDate: (field: string, raw: string) => `${field}: у партнёра непонятная дата «${raw}»`,
  ambiguous: (invoice: string) => `В «Слежке авто» несколько фур с номером ${invoice}`,
  notFound: (invoice: string) => `Инвойса ${invoice} нет в «Слежке авто»`,
  partnerWarehouse: (moved: string, unloaded: string) => `Выгрузка: у партнёра сразу на ком. склад ${moved}, в CRM выгружена на СВХ ${unloaded}`,
  crmWarehouse: (unloaded: string, moved: string) => `Выгрузка: у партнёра на СВХ ${unloaded}, в CRM сразу на ком. склад ${moved}`,
  differs: (field: string, theirs: string, ours: string, shift: string) => `${field}: у партнёра ${theirs}, в CRM ${ours} (${shift} дн.)`,
  noCrmDate: (field: string, theirs: string) => `${field}: в CRM нет даты (у партнёра ${theirs})`,
  noPartnerDate: (field: string, ours: string) => `${field}: у партнёра нет даты (в CRM ${ours})`,
  weekdays: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  weekendArrival: (weekday: string, theirs: string, ours: string) => `Заезд в выходной (${weekday} ${theirs}), в CRM записан понедельник ${ours}: прав партнёр, стоянка считается с ${theirs}`,
};

const en: typeof ru = {
  field: { arrived: 'Arrival', unloaded: 'Unloading', moved: 'Transfer' },
  badDate: (field, raw) => `${field}: the partner's date "${raw}" is unreadable`,
  ambiguous: invoice => `Truck Tracking has several trucks with number ${invoice}`,
  notFound: invoice => `Invoice ${invoice} is not in Truck Tracking`,
  partnerWarehouse: (moved, unloaded) => `Unloading: partner says straight to the commercial warehouse on ${moved}, CRM says unloaded at the SVH on ${unloaded}`,
  crmWarehouse: (unloaded, moved) => `Unloading: partner says unloaded at the SVH on ${unloaded}, CRM says straight to the commercial warehouse on ${moved}`,
  differs: (field, theirs, ours, shift) => `${field}: partner ${theirs}, CRM ${ours} (${shift} days)`,
  noCrmDate: (field, theirs) => `${field}: no date in the CRM (partner: ${theirs})`,
  noPartnerDate: (field, ours) => `${field}: no date from the partner (CRM: ${ours})`,
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekendArrival: (weekday, theirs, ours) => `Arrived on the weekend (${weekday} ${theirs}), CRM has the Monday ${ours}: the partner is right, parking counts from ${theirs}`,
};

const fa: typeof ru = {
  field: { arrived: 'ورود', unloaded: 'تخلیه', moved: 'انتقال' },
  badDate: (field, raw) => `${field}: تاریخ طرف قرارداد «${raw}» نامفهوم است`,
  ambiguous: invoice => `در «ردیابی کامیون‌ها» چند کامیون با شماره ${invoice} وجود دارد`,
  notFound: invoice => `فاکتور ${invoice} در «ردیابی کامیون‌ها» نیست`,
  partnerWarehouse: (moved, unloaded) => `تخلیه: طبق طرف قرارداد مستقیم به انبار تجاری در ${moved}، طبق CRM تخلیه در انبار موقت در ${unloaded}`,
  crmWarehouse: (unloaded, moved) => `تخلیه: طبق طرف قرارداد در انبار موقت در ${unloaded}، طبق CRM مستقیم به انبار تجاری در ${moved}`,
  differs: (field, theirs, ours, shift) => `${field}: طرف قرارداد ${theirs}، CRM ${ours} (${shift} روز)`,
  noCrmDate: (field, theirs) => `${field}: در CRM تاریخی ثبت نشده (طرف قرارداد: ${theirs})`,
  noPartnerDate: (field, ours) => `${field}: طرف قرارداد تاریخی ندارد (CRM: ${ours})`,
  weekdays: ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'],
  weekendArrival: (weekday, theirs, ours) => `ورود در روز تعطیل (${weekday} ${theirs})، در CRM دوشنبه ${ours} ثبت شده: حق با طرف قرارداد است، توقف از ${theirs} محاسبه می‌شود`,
};

export const SVH_ISSUE_TEXTS: SectionTexts<typeof ru> = { ru, en, fa };
