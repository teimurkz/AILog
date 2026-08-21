export type ShipmentStatus = 'In Transit' | 'Customs' | 'Delivered' | 'Delay';
export type RouteType = 'Tehran - Almaty' | 'Amol - Almaty';

export interface Shipment {
  id: string;
  invoice_id: string; // Order Name, e.g., "Mehkaz 4.1"
  week?: string | number;
  shipment_type?: string; // e.g. "Transship-Land", "Direct-Land"
  destination?: string; // e.g. "Almaty - Kazakhstan"
  goods?: string; // e.g. "Tetrapack Milk (+2)"
  driver_name?: string; // Водитель
  driver_phone?: string; // Телефон водителя
  plate_number?: string; // Номер машины / авто
  truck_driver?: string;
  loading_date?: string; // L DATE (Дата загрузки)
  ex_border_date?: string; // Ex Border Date (Дата выхода с границы)
  customs_arrival_date?: string; // A To Destination Customs (Приход на конечный СВХ)
  unl_date?: string; // Unl Date (Дата выгрузки)
  transit_time?: string | number; // T.T (Время в пути, дни)
  route: RouteType;
  departure_date: string; // ISO string for Firestore Timestamp conversion
  est_travel_time: number; // Days
  arrival_deadline: string; // Computed: departure_date + est_travel_time
  actual_arrival_date?: string;
  customs_date?: string;
  status: ShipmentStatus;
  status_message?: string;
  documents_url: string[]; // Links to Firebase Storage
  last_updated: string;
  createdBy: string;
  items: string[];
  isArchived?: boolean;
}

export type TruckStatus = 'Available' | 'On Route' | 'Maintenance';

export interface Truck {
  id: string;
  plateNumber: string;
  model: string;
  status: TruckStatus;
}

export interface ShipmentLog {
  id: string;
  shipmentId: string;
  timestamp: string;
  location: string;
  message: string;
  updatedBy: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'logistics' | 'viewer' | 'regional_manager';
}

export type RegionalOrderStatus = 'new' | 'assigned' | 'loading' | 'dispatched' | 'delivered' | 'cancelled';

export interface InvoiceItem {
  id: string;
  invoiceNumber: string; // e.g. "Накладная №88412"
  fileName?: string;
  fileData?: string;
  fileType?: string;
  fileSize?: string;
}

export interface DeliveryPoint {
  id: string;
  address: string; // Адрес выгрузки
  recipientPhone?: string; // Телефон получателя
  recipientName?: string; // Имя контактного лица
  note?: string; // Примечание/Количество паллет
}

export interface RegionalTruckOrder {
  id: string;
  orderNumber: string; // e.g. "ORD-1042"
  destinationCity: string; // e.g. "Астана", "Шымкент", "Караганда"
  originCity?: string; // e.g. "Алматы"
  deliveryAddress?: string; // Основной/общий адрес выгрузки
  recipientPhone?: string; // Номер получателя
  deliveryPoints?: DeliveryPoint[]; // Список нескольких точек выгрузки
  invoiceNumber: string; // e.g. "Накладная №88412"
  invoiceFileName?: string;
  invoiceFileData?: string;
  invoiceFileType?: string;
  invoices?: InvoiceItem[]; // Список нескольких накладных/документов
  shipmentDate: string; // YYYY-MM-DD or readable
  truckType: string; // e.g. "Фура 20т (Рефрижератор)"
  palletsCount?: string;
  weight?: string;
  cargoDescription?: string;
  managerName: string;
  managerPhone?: string;
  comments?: string;
  status: RegionalOrderStatus;
  assignedTruckPlate?: string;
  assignedDriver?: string;
  createdAt: string;
  createdByEmail?: string;
  createdByName?: string;
  updatedAt?: string;
}

export interface SavedDeliveryContact {
  id: string;
  title: string;          // e.g. "Астана — склад 'Шоссе Алаш 12/1'"
  city: string;           // Destination city
  deliveryAddress: string;// Unloading address
  recipientPhone: string; // Recipient phone
  recipientName?: string; // Recipient name / contact person
  createdAt?: string;
}

export interface SavedTruck {
  id: string;
  plateNumber: string;    // e.g. "777 ABC 02"
  driverName: string;     // e.g. "Иванов И.И."
  driverPhone: string;    // e.g. "+7 701 123 4567"
  truckType?: string;     // e.g. "Фура 20т (Тент)"
  createdAt?: string;
}

export interface WarehouseItem {
  id: string;
  number: string;
  invNumber: string;
  product: string;
  palletCount: string;
  dates: string;
  svh: string;
  isArchiveItem?: boolean;
  isTrucksReportItem?: boolean;
  entryDate?: string;
  exitDate?: string;
  rawRow: (string | number | null)[];
}

export interface Warehouse {
  id: string;
  name: string;
  sheetName: string;
  isArchive?: boolean;
  isTrucksReport?: boolean;
  reportDate?: string;
  cols: string[];
  items: WarehouseItem[];
  totalPalletsNumeric: number;
  itemCount: number;
}

export interface WarehouseResponse {
  spreadsheetId: string;
  spreadsheetUrl: string;
  updatedAt: string;
  warehouses: Warehouse[];
  logs?: WarehouseChangeLog[];
  newLogsCount?: number;
}

export type WarehouseChangeType = 'added' | 'removed' | 'quantity_changed' | 'svh_changed' | 'manual' | 'archive';

export interface WarehouseChangeLog {
  id: string;
  timestamp: string; // ISO string
  warehouseId: string;
  warehouseName: string;
  product: string;
  invNumber: string;
  changeType: WarehouseChangeType;
  title: string;
  description: string;
  oldValue?: string | number;
  newValue?: string | number;
  palletDelta?: number;
  author?: string;
  source?: 'Google Sheets' | 'Excel' | 'Manual' | 'System';
  rawRow?: (string | number | null)[];
}

export interface KustoExpiryItem {
  id: string;
  group: string;                 // Группа (e.g. MEHKAZ)
  article: string;               // Артикул
  name: string;                  // Наименование
  rsv: string | number;          // РСВ / РСБ
  unit: string;                  // Ед. изм.
  batch: string;                 // Партия
  productionDate: string;        // Дата произв.
  expiryDate: string;            // Срок годности
  minDaysLimit: number;          // Мин дней до С.Г.
  daysToExpiry: number;          // Дней до С.Г.
  commercializationDeadline: string; // Срок коммерциализации
  daysToDeadline: number;        // Дней до окончания
  stockType: string;             // Тип стока (N, A, B, E)
  totalStock: number;            // Всего в стоке (шт)
  reservedStock: number;         // Зарезервировано в заказах (шт)
  freeStock: number;             // Свободный сток (шт)
}

export interface MailingSubscriber {
  id: string;
  name: string;                   // ФИО / Должность (e.g. "Иван Иванов")
  email: string;                  // Email получателя
  department?: string;            // Отдел (Логистика, Продажи, Руководство, Закупы)
  isActive: boolean;              // Активен ли получатель
  selectedWarehouses?: string[];  // Массив ID складов или ['all']
  formatPreference?: 'xlsx' | 'pdf' | 'summary';
  comments?: string;
  createdAt: string;
  lastSentAt?: string;
}

export type MailingScheduleType = 'daily' | 'workdays' | 'weekly' | 'on_change' | 'manual' | 'test_interval' | 'custom';

export interface MailingSettings {
  enabled: boolean;
  scheduleType: MailingScheduleType;
  sendTime: string;              // HH:mm, e.g. "09:00"
  intervalMinutes?: number;      // e.g. 1, 2, 5, 10 for test_interval mode
  timezone?: string;             // e.g. "Asia/Almaty"
  scheduleDays?: number[];       // e.g. [1,2,3,4,5] for custom days
  weeklyDay?: number;            // 1 = Mon ... 7 = Sun
  emailSubject: string;          // Тема письма
  emailBody: string;             // Текст письма
  attachFormat: 'xlsx' | 'pdf' | 'both';
  includeAnalyticsSummary: boolean;
  smtpConfigured?: boolean;
  smtpHost?: string;             // e.g. "smtp.office365.com", "smtp.gmail.com"
  smtpPort?: number | string;     // e.g. 587 or 465
  smtpSecure?: boolean;          // true for 465, false for 587
  smtpUser?: string;             // e.g. "t.farajov@mehkaz.kz"
  smtpPass?: string;             // Password or App Password
  smtpFrom?: string;             // Sender display name/email
}

export interface MailingLog {
  id: string;
  timestamp: string;
  recipientsCount: number;
  recipientEmails: string[];
  status: 'success' | 'failed' | 'partial';
  fileName: string;
  fileSize?: string;
  triggerSource: 'manual' | 'schedule' | 'on_change' | 'test';
  errorMessage?: string;
}
