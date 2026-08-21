import os from "os";
import path from "path";

export const LOGS_FILE_PATH = path.join(os.tmpdir(), 'warehouse_change_logs.json');
export const SNAPSHOT_FILE_PATH = path.join(os.tmpdir(), 'warehouse_snapshot_latest.json');

export const SUBSCRIBERS_FILE_PATH = path.join(process.cwd(), 'mailing_subscribers.json');
export const SETTINGS_FILE_PATH = path.join(process.cwd(), 'mailing_settings.json');
export const MAILING_LOGS_FILE_PATH = path.join(process.cwd(), 'mailing_logs.json');

export const DEFAULT_SPREADSHEET_ID = '1FRwicnGLMSD2jurukoLPEa5kGmycpwAHnBvObJX7kCQ';

export const DEFAULT_SUBSCRIBERS = [
  {
    id: 'sub-user-default',
    name: 'Основной получатель (Руководитель)',
    email: 'ti07kz@gmail.com',
    department: 'Руководство / Склад',
    isActive: true,
    selectedWarehouses: ['all'],
    formatPreference: 'xlsx',
    createdAt: new Date().toISOString()
  }
];

export const DEFAULT_MAILING_SETTINGS = {
  enabled: true,
  scheduleType: 'daily',
  sendTime: '09:00',
  timezone: 'Asia/Almaty',
  scheduleDays: [1, 2, 3, 4, 5],
  emailSubject: '📊 Ежедневный отчет: Остатки товаров на складах',
  emailBody: 'Добрый день!\n\nНаправляем актуальный свежий файл Excel с остатками товаров и движением паллет по всем складам компании.\n\nС уважением,\nАвтоматическая система складского учета',
  attachFormat: 'xlsx',
  includeAnalyticsSummary: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: 'ti07kz@gmail.com',
  smtpPass: '',
  smtpFrom: '"Складской Учет (Silk Road)" <ti07kz@gmail.com>',
  smtpConfigured: false
};
