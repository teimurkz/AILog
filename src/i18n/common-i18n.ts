import { CRM_LANGUAGES, pickTexts, type CrmLanguage, type SectionTexts } from '../../shared/i18n';

// Texts shared by the whole CRM: the command palette and the messages services produce
// (data loading, sign-in, profile). Services keep producing the Russian text; the screen
// that shows a message translates it with `translateMessage`.

const ru = {
  notice: { loading: 'Загружаем данные…', retry: 'Повторить' },
  palette: {
    placeholder: 'Поиск по меню, заказам, водителям (Ctrl + K)...',
    close: 'Закрыть',
    nothingFound: (query: string) => `Ничего не найдено по запросу «${query}»`,
    toggle: 'чтобы открыть / закрыть',
    press: 'Нажмите',
    toExit: 'для выхода',
    category: { navigation: 'Навигация', tools: 'Инструменты', analytics: 'Аналитика', settings: 'Настройки' },
    items: {
      'regional-orders': 'Региональные рейсы (Астана, Шымкент)',
      shipments: 'Складской учёт и статусы авто',
      'truck-tracking': 'Слежка авто (инвойсы, прибытие, СВХ)',
      'auto-mailing': 'Авто-рассылка отчётов Excel',
      'analytics-reports': 'Аналитика и сводные отчёты',
      directories: 'Справочники (водители, клиенты)',
    },
  },
  messages: {
    permissionDenied: 'Нет доступа к данным. Проверьте, что вы вошли под рабочей учётной записью.',
    unauthenticated: 'Сеанс входа завершён. Войдите в CRM повторно.',
    loadFailed: 'Не удалось загрузить данные. Проверьте подключение и повторите попытку.',
    cachedData: 'Показаны последние загруженные данные. Ожидаем подтверждение соединения.',
    profileLoadFailed: 'Не удалось загрузить профиль Firebase. Проверьте подключение и повторите вход.',
    profileSaveFailed: 'Не удалось загрузить профиль Firebase. Данные пользователя не изменены.',
    signInFailed: 'Не удалось войти. Повторите попытку.',
    popupClosed: 'Окно входа Google закрыто до завершения. Нажмите «Sign in with Google» и завершите выбор аккаунта.',
    popupBlocked: 'Браузер заблокировал окно Google. Разрешите всплывающие окна для этого сайта и повторите вход.',
    unauthorizedDomain: 'Этот адрес не разрешён в Firebase Authentication. Добавьте домен страницы в Authentication → Settings → Authorized domains существующего проекта Firebase.',
    network: 'Не удалось связаться с Firebase для входа. Проверьте подключение к интернету и повторите попытку.',
    methodDisabled: 'Этот способ входа отключён в Firebase. Проверьте включённые способы входа в существующем проекте.',
  },
};

const en: typeof ru = {
  notice: { loading: 'Loading data…', retry: 'Retry' },
  palette: {
    placeholder: 'Search menu, orders, drivers (Ctrl + K)...',
    close: 'Close',
    nothingFound: query => `Nothing found for "${query}"`,
    toggle: 'to open / close',
    press: 'Press',
    toExit: 'to exit',
    category: { navigation: 'Navigation', tools: 'Tools', analytics: 'Analytics', settings: 'Settings' },
    items: {
      'regional-orders': 'Regional trips (Astana, Shymkent)',
      shipments: 'Warehouse records and truck statuses',
      'truck-tracking': 'Truck Tracking (invoices, arrival, SVH)',
      'auto-mailing': 'Automatic Excel report mailing',
      'analytics-reports': 'Analytics and summary reports',
      directories: 'Directories (drivers, customers)',
    },
  },
  messages: {
    permissionDenied: 'No access to the data. Check that you are signed in with your work account.',
    unauthenticated: 'Your session has ended. Sign in to the CRM again.',
    loadFailed: 'Could not load the data. Check your connection and try again.',
    cachedData: 'Showing the last loaded data. Waiting for the connection to be confirmed.',
    profileLoadFailed: 'Could not load the Firebase profile. Check your connection and sign in again.',
    profileSaveFailed: 'Could not load the Firebase profile. The user data was not changed.',
    signInFailed: 'Could not sign in. Please try again.',
    popupClosed: 'The Google sign-in window was closed before finishing. Click "Sign in with Google" and choose an account.',
    popupBlocked: 'The browser blocked the Google window. Allow pop-ups for this site and sign in again.',
    unauthorizedDomain: 'This address is not allowed in Firebase Authentication. Add the page domain under Authentication → Settings → Authorized domains of the existing Firebase project.',
    network: 'Could not reach Firebase to sign in. Check your internet connection and try again.',
    methodDisabled: 'This sign-in method is disabled in Firebase. Check the enabled sign-in methods in the existing project.',
  },
};

const fa: typeof ru = {
  notice: { loading: 'در حال بارگذاری داده‌ها…', retry: 'تلاش دوباره' },
  palette: {
    placeholder: 'جستجو در منو، سفارش‌ها، رانندگان (Ctrl + K)...',
    close: 'بستن',
    nothingFound: query => `نتیجه‌ای برای «${query}» یافت نشد`,
    toggle: 'برای باز و بسته کردن',
    press: 'برای خروج',
    toExit: 'را بزنید',
    category: { navigation: 'پیمایش', tools: 'ابزارها', analytics: 'تحلیل', settings: 'تنظیمات' },
    items: {
      'regional-orders': 'سفرهای منطقه‌ای (آستانه، شیمکنت)',
      shipments: 'حسابداری انبار و وضعیت کامیون‌ها',
      'truck-tracking': 'ردیابی کامیون‌ها (فاکتورها، ورود، انبار موقت)',
      'auto-mailing': 'ارسال خودکار گزارش‌های Excel',
      'analytics-reports': 'تحلیل و گزارش‌های خلاصه',
      directories: 'دفترچه‌ها (رانندگان، مشتریان)',
    },
  },
  messages: {
    permissionDenied: 'به داده‌ها دسترسی ندارید. بررسی کنید که با حساب کاری وارد شده باشید.',
    unauthenticated: 'نشست ورود شما پایان یافته است. دوباره وارد CRM شوید.',
    loadFailed: 'بارگذاری داده‌ها ممکن نشد. اتصال را بررسی کنید و دوباره تلاش کنید.',
    cachedData: 'آخرین داده‌های بارگذاری‌شده نمایش داده می‌شود. در انتظار تأیید اتصال.',
    profileLoadFailed: 'بارگذاری پروفایل Firebase ممکن نشد. اتصال را بررسی کنید و دوباره وارد شوید.',
    profileSaveFailed: 'بارگذاری پروفایل Firebase ممکن نشد. اطلاعات کاربر تغییری نکرد.',
    signInFailed: 'ورود ممکن نشد. لطفاً دوباره تلاش کنید.',
    popupClosed: 'پنجره ورود Google پیش از پایان بسته شد. روی «Sign in with Google» بزنید و حساب را انتخاب کنید.',
    popupBlocked: 'مرورگر پنجره Google را مسدود کرد. پنجره‌های بازشو را برای این سایت مجاز کنید و دوباره وارد شوید.',
    unauthorizedDomain: 'این نشانی در Firebase Authentication مجاز نیست. دامنه صفحه را در Authentication → Settings → Authorized domains پروژه فعلی Firebase اضافه کنید.',
    network: 'ارتباط با Firebase برای ورود برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.',
    methodDisabled: 'این روش ورود در Firebase غیرفعال است. روش‌های ورود فعال را در پروژه فعلی بررسی کنید.',
  },
};

export const COMMON_TEXTS: SectionTexts<typeof ru> = { ru, en, fa };
export type MessageId = keyof typeof ru.messages;
/** The Russian text services produce for a message. */
export const MESSAGE = ru.messages;

/** A message produced by a service (in Russian) in the chosen language; unknown texts are shown as they are. */
export function translateMessage(message: string, language: CrmLanguage | string): string {
  const id = (Object.keys(ru.messages) as MessageId[]).find(key => ru.messages[key] === message);
  if (!id || !CRM_LANGUAGES.includes(language as CrmLanguage)) return message;
  return pickTexts(COMMON_TEXTS, language).messages[id];
}
