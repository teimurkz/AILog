import React, { useState } from 'react';
import { 
  X, 
  Truck, 
  MapPin, 
  FileText, 
  Calendar, 
  Package, 
  User, 
  Phone, 
  Upload, 
  Check, 
  File, 
  Image as ImageIcon,
  AlertCircle,
  Bell,
  Bookmark,
  Save,
  Trash2,
  Building2,
  Plus,
  Layers,
  Map,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { playNotificationSound } from '../../hooks/useRegionalOrders';
import { useSavedDeliveryContacts } from '../../hooks/useSavedDeliveryContacts';
import { InvoiceItem, DeliveryPoint } from '../../types';

interface NewRegionalOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (orderData: {
    destinationCity: string;
    originCity: string;
    deliveryAddress?: string;
    recipientPhone?: string;
    deliveryPoints?: DeliveryPoint[];
    invoiceNumber: string;
    invoiceFileName?: string;
    invoiceFileData?: string;
    invoiceFileType?: string;
    invoices?: InvoiceItem[];
    shipmentDate: string;
    truckType: string;
    palletsCount?: string;
    weight?: string;
    cargoDescription?: string;
    managerName: string;
    managerPhone?: string;
    comments?: string;
    createdByEmail?: string;
    createdByName?: string;
  }) => Promise<void>;
}

const POPULAR_CITIES = [
  'Астана',
  'Шымкент',
  'Караганда',
  'Актобе',
  'Тараз',
  'Павлодар',
  'Усть-Каменогорск',
  'Семей',
  'Атырау',
  'Костанай',
  'Кызылорда',
  'Актау',
  'Бишкек',
  'Ташкент',
];

export const NewRegionalOrderModal: React.FC<NewRegionalOrderModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const { authUser, profile } = useAuth();
  const { savedContacts, addSavedContact, deleteSavedContact } = useSavedDeliveryContacts();

  // Destination City
  const [destinationCity, setDestinationCity] = useState('Астана');
  const [customCity, setCustomCity] = useState('');
  const [isCustomCitySelected, setIsCustomCitySelected] = useState(false);
  
  // MULTIPLE Delivery Points (Адреса выгрузки)
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>([
    { id: 'dp-1', address: '', recipientPhone: '+7 701 ', recipientName: '', note: '' }
  ]);
  const [saveDeliveryContact, setSaveDeliveryContact] = useState(false);
  const [showDirectoryManager, setShowDirectoryManager] = useState(false);

  // MULTIPLE Invoices (Накладные)
  const [invoiceList, setInvoiceList] = useState<InvoiceItem[]>([
    { id: 'inv-1', invoiceNumber: '', fileName: '', fileData: '', fileType: '', fileSize: '' }
  ]);

  const [shipmentDate, setShipmentDate] = useState(() => {
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    return tmr.toISOString().split('T')[0];
  });
  const [cargoDescription, setCargoDescription] = useState('Молочная продукция / сыр / масло');
  const [managerName, setManagerName] = useState(profile?.displayName || authUser?.displayName || 'Менеджер регионов');
  const [managerPhone, setManagerPhone] = useState('+7 701 ');
  const [comments, setComments] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  // --- Handlers for Delivery Points ---
  const handleAddDeliveryPoint = () => {
    setDeliveryPoints(prev => [
      ...prev,
      { id: `dp-${Date.now()}-${prev.length + 1}`, address: '', recipientPhone: '+7 701 ', recipientName: '', note: '' }
    ]);
  };

  const handleRemoveDeliveryPoint = (index: number) => {
    if (deliveryPoints.length > 1) {
      setDeliveryPoints(prev => prev.filter((_, i) => i !== index));
    } else {
      setDeliveryPoints([{ id: 'dp-1', address: '', recipientPhone: '+7 701 ', recipientName: '', note: '' }]);
    }
  };

  const handleDeliveryPointChange = (index: number, field: keyof DeliveryPoint, value: string) => {
    setDeliveryPoints(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const handleApplySavedContact = (index: number, contactId: string) => {
    if (!contactId) return;
    const contact = savedContacts.find(c => c.id === contactId);
    if (contact) {
      setDeliveryPoints(prev => prev.map((item, i) => {
        if (i === index) {
          if (POPULAR_CITIES.includes(contact.city)) {
            setDestinationCity(contact.city);
            setIsCustomCitySelected(false);
          } else if (contact.city) {
            setCustomCity(contact.city);
            setIsCustomCitySelected(true);
          }
          return {
            ...item,
            address: contact.deliveryAddress,
            recipientPhone: contact.recipientPhone,
            recipientName: contact.recipientName || '',
          };
        }
        return item;
      }));
    }
  };

  // --- Handlers for Invoices ---
  const handleAddInvoice = () => {
    setInvoiceList(prev => [
      ...prev,
      { id: `inv-${Date.now()}-${prev.length + 1}`, invoiceNumber: '', fileName: '', fileData: '', fileType: '', fileSize: '' }
    ]);
  };

  const handleRemoveInvoice = (index: number) => {
    if (invoiceList.length > 1) {
      setInvoiceList(prev => prev.filter((_, i) => i !== index));
    } else {
      setInvoiceList([{ id: 'inv-1', invoiceNumber: '', fileName: '', fileData: '', fileType: '', fileSize: '' }]);
    }
  };

  const handleInvoiceNumberChange = (index: number, value: string) => {
    setInvoiceList(prev => prev.map((item, i) => i === index ? { ...item, invoiceNumber: value } : item));
  };

  const handleInvoiceFileUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      setErrorMsg('Размер файла превышает 8МБ. Пожалуйста, прикрепите документ меньшего размера.');
      return;
    }
    setErrorMsg('');

    const fileSizeKb = Math.round(file.size / 1024);
    const sizeStr = fileSizeKb > 1024 ? `${(fileSizeKb / 1024).toFixed(1)} МБ` : `${fileSizeKb} КБ`;

    const updateInvoiceData = (fileName: string, type: string, dataUrl: string) => {
      setInvoiceList(prev => prev.map((item, i) => {
        if (i === index) {
          return { ...item, fileName, fileType: type, fileSize: sizeStr, fileData: dataUrl };
        }
        return item;
      }));
    };

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const rawDataUrl = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_DIM = 1200;
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
            updateInvoiceData(file.name, 'image/jpeg', compressedDataUrl);
          } else {
            updateInvoiceData(file.name, file.type, rawDataUrl);
          }
        };
        img.onerror = () => updateInvoiceData(file.name, file.type, rawDataUrl);
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        let dataUrl = event.target?.result as string;
        if (dataUrl.length > 550000) {
          dataUrl = ''; // Retain metadata only if too large
        }
        updateInvoiceData(file.name, file.type, dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveInvoiceFile = (index: number) => {
    setInvoiceList(prev => prev.map((item, i) => {
      if (i === index) {
        return { ...item, fileName: '', fileData: '', fileType: '', fileSize: '' };
      }
      return item;
    }));
  };

  // --- Form Submission ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCity = isCustomCitySelected ? customCity.trim() : destinationCity;

    if (!finalCity) {
      setErrorMsg('Пожалуйста, укажите город/направление доставки.');
      return;
    }

    const validInvoices = invoiceList.filter(inv => inv.invoiceNumber.trim() !== '');
    if (validInvoices.length === 0) {
      setErrorMsg('Пожалуйста, добавьте хотя бы одну накладную (укажите номер).');
      return;
    }

    const validPoints = deliveryPoints.filter(p => p.address.trim() !== '');
    if (validPoints.length === 0) {
      setErrorMsg('Пожалуйста, укажите хотя бы один адрес выгрузки.');
      return;
    }

    if (!shipmentDate) {
      setErrorMsg('Укажите дату, на которую требуется подача машины.');
      return;
    }
    if (!managerName.trim()) {
      setErrorMsg('Укажите ФИО ответственного менеджера.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      // Save delivery points to directory if requested
      if (saveDeliveryContact) {
        for (const pt of validPoints) {
          if (pt.address.trim()) {
            await addSavedContact({
              title: `${finalCity} — ${pt.address.trim().slice(0, 35)} (${pt.recipientPhone.trim()})`,
              city: finalCity,
              deliveryAddress: pt.address.trim(),
              recipientPhone: pt.recipientPhone.trim(),
              recipientName: pt.recipientName?.trim(),
            });
          }
        }
      }

      // Summary fields for legacy compatibility
      const primaryInvoiceNumber = validInvoices.length === 1
        ? validInvoices[0].invoiceNumber.trim()
        : `Накладные: ${validInvoices.map(i => i.invoiceNumber.trim()).join(', ')} (${validInvoices.length} шт)`;

      const primaryAddress = validPoints.length === 1
        ? validPoints[0].address.trim()
        : validPoints.map((p, idx) => `Точка ${idx + 1}: ${p.address.trim()}`).join(' | ');

      const primaryPhones = Array.from(new Set(validPoints.map(p => p.recipientPhone.trim()).filter(Boolean))).join(', ');

      const firstWithFile = validInvoices.find(inv => inv.fileData || inv.fileName);

      await onSubmit({
        destinationCity: finalCity,
        originCity: 'Алматы',
        deliveryAddress: primaryAddress,
        recipientPhone: primaryPhones,
        deliveryPoints: validPoints.map(p => ({
          id: p.id,
          address: p.address.trim(),
          recipientPhone: p.recipientPhone.trim(),
          recipientName: p.recipientName?.trim(),
          note: p.note?.trim(),
        })),
        invoiceNumber: primaryInvoiceNumber,
        invoiceFileName: firstWithFile?.fileName || '',
        invoiceFileData: firstWithFile?.fileData || '',
        invoiceFileType: firstWithFile?.fileType || '',
        invoices: validInvoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber.trim(),
          fileName: inv.fileName || '',
          fileData: inv.fileData || '',
          fileType: inv.fileType || '',
          fileSize: inv.fileSize || '',
        })),
        shipmentDate,
        truckType: 'Автотранспорт',
        palletsCount: '',
        weight: '',
        cargoDescription: cargoDescription.trim() || '',
        managerName: managerName.trim(),
        managerPhone: managerPhone.trim() || '',
        comments: comments.trim() || '',
        createdByEmail: authUser?.email || '',
        createdByName: profile?.displayName || authUser?.displayName || managerName || '',
      });

      playNotificationSound();
      onClose();
    } catch (err: any) {
      console.error("Submit regional order error:", err);
      setErrorMsg(err.message || 'Ошибка при создании заявки на фуру.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-3xl overflow-hidden my-6"
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-5 sm:p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/20 backdrop-blur-md rounded-2xl">
              <Truck className="w-7 h-7 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Заявка на фуру в регион
              </h2>
              <p className="text-xs text-blue-100 mt-0.5">
                Заполнение заявки логистам: поддержка нескольких накладных и адресов выгрузки
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          {errorMsg && (
            <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl flex items-center gap-3 text-red-700 dark:text-red-300 text-xs font-medium">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Direction / Destination City */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-blue-500" />
              <span>Направление (Город доставки) *</span>
            </label>
            
            <div className="flex flex-wrap gap-1.5">
              {POPULAR_CITIES.map((city) => (
                <button
                  type="button"
                  key={city}
                  onClick={() => {
                    setDestinationCity(city);
                    setIsCustomCitySelected(false);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1 ${
                    !isCustomCitySelected && destinationCity === city
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20 ring-2 ring-blue-600/30'
                      : 'bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {!isCustomCitySelected && destinationCity === city && <Check className="w-3.5 h-3.5 text-white" />}
                  <span>{city}</span>
                </button>
              ))}

              <button
                type="button"
                onClick={() => setIsCustomCitySelected(true)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
                  isCustomCitySelected
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                + Другой город
              </button>
            </div>

            {isCustomCitySelected && (
              <input
                type="text"
                placeholder="Введите наименование города / населенного пункта..."
                value={customCity}
                onChange={(e) => setCustomCity(e.target.value)}
                className="w-full mt-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-blue-500 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                autoFocus
              />
            )}
          </div>

          {/* Section 2: MULTIPLE UNLOADING ADDRESSES / POINTS */}
          <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-200 dark:border-emerald-800/80 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/60 rounded-lg text-emerald-700 dark:text-emerald-300">
                  <Map className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-emerald-900 dark:text-emerald-200 uppercase tracking-wider">
                    Адреса выгрузки ({deliveryPoints.length})
                  </h3>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Добавляйте точки выгрузки (1, 2, 3, 4, 5 и т.д.) для маршрута водителя
                  </p>
                </div>
              </div>

              {savedContacts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDirectoryManager(!showDirectoryManager)}
                  className="text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:underline flex items-center gap-1"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Справочник ({savedContacts.length})</span>
                </button>
              )}
            </div>

            {/* Directory List Drawer */}
            {showDirectoryManager && savedContacts.length > 0 && (
              <div className="p-3 bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-700 rounded-xl space-y-2 max-h-40 overflow-y-auto">
                <p className="text-[11px] font-bold text-emerald-900 dark:text-emerald-300">
                  Сохраненные адреса выгрузки (нажмите "Выбрать" для заполнения нужной точки ниже):
                </p>
                {savedContacts.map(contact => (
                  <div key={contact.id} className="p-2 bg-slate-50 dark:bg-slate-900 rounded-lg flex items-center justify-between text-xs gap-2">
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{contact.city}: </span>
                      <span className="text-slate-600 dark:text-slate-300">{contact.deliveryAddress}</span>
                      <span className="text-slate-400 ml-1">({contact.recipientPhone})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteSavedContact(contact.id)}
                      className="p-1 text-slate-400 hover:text-red-600"
                      title="Удалить из справочника"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* List of Delivery Points */}
            <div className="space-y-3">
              {deliveryPoints.map((point, index) => (
                <div key={point.id || index} className="p-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3 shadow-sm relative group">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center">
                        {index + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Точка выгрузки #{index + 1}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Saved contacts quick dropdown */}
                      {savedContacts.length > 0 && (
                        <select
                          onChange={(e) => handleApplySavedContact(index, e.target.value)}
                          className="px-2 py-1 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none"
                          defaultValue=""
                        >
                          <option value="" disabled>-- Подставить из справочника --</option>
                          {savedContacts.map(c => (
                            <option key={c.id} value={c.id}>{c.city} — {c.deliveryAddress.slice(0, 25)}...</option>
                          ))}
                        </select>
                      )}

                      {deliveryPoints.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveDeliveryPoint(index)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors"
                          title="Удалить эту точку выгрузки"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Адрес выгрузки (склад / магазин / точка №{index + 1}) *
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          required
                          placeholder={index === 0 ? "например: шоссе Алаш 12/1, склад №4" : `например: Точка #${index + 1} - рынок Алтын Орда, бутик 15`}
                          value={point.address}
                          onChange={(e) => handleDeliveryPointChange(index, 'address', e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:text-white"
                        />
                        <MapPin className="w-4 h-4 text-red-500 absolute left-2.5 top-2.5" />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Телефон и имя получателя
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="+7 701 123-45-67 (Алихан / Приемщик)"
                          value={point.recipientPhone}
                          onChange={(e) => handleDeliveryPointChange(index, 'recipientPhone', e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:text-white"
                        />
                        <Phone className="w-4 h-4 text-emerald-500 absolute left-2.5 top-2.5" />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Примечание по этой точке (паллеты, время)
                      </label>
                      <input
                        type="text"
                        placeholder="например: Выгрузка 8 паллет, до 12:00"
                        value={point.note || ''}
                        onChange={(e) => handleDeliveryPointChange(index, 'note', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Point Button & Directory Save Checkbox */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={handleAddDeliveryPoint}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>+ Добавить еще адрес выгрузки (2, 3, 4 точка...)</span>
              </button>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveDeliveryContact}
                  onChange={(e) => setSaveDeliveryContact(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 dark:bg-slate-800"
                />
                <span className="flex items-center gap-1">
                  <Save className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Сохранить адреса в справочник</span>
                </span>
              </label>
            </div>
          </div>

          {/* Section 3: MULTIPLE INVOICES / WAYBILLS */}
          <div className="p-4 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-purple-200 dark:border-purple-800/80 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-purple-100 dark:bg-purple-900/60 rounded-lg text-purple-700 dark:text-purple-300">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-purple-900 dark:text-purple-200 uppercase tracking-wider">
                    Накладные и заказы ({invoiceList.length})
                  </h3>
                  <p className="text-[11px] text-purple-700 dark:text-purple-400">
                    Добавляйте несколько накладных (2, 3, 4, 5 шт) и прикрепляйте файлы к каждой из них
                  </p>
                </div>
              </div>
            </div>

            {/* List of Invoice Fields */}
            <div className="space-y-3">
              {invoiceList.map((inv, index) => (
                <div key={inv.id || index} className="p-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3 shadow-sm relative group">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-purple-600 text-white font-black text-xs flex items-center justify-center">
                        {index + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Накладная / Заказ #{index + 1}
                      </span>
                    </div>

                    {invoiceList.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveInvoice(index)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors"
                        title="Удалить эту накладную"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Номер накладной / заказа *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder={index === 0 ? "например: Накладная №88412" : `например: Накладная №884${13 + index}`}
                        value={inv.invoiceNumber}
                        onChange={(e) => handleInvoiceNumberChange(index, e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold focus:ring-2 focus:ring-purple-500 focus:outline-none dark:text-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Прикрепленный файл к накладной
                      </label>
                      {inv.fileName ? (
                        <div className="p-2 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 rounded-xl flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            {inv.fileType?.startsWith('image/') ? (
                              <ImageIcon className="w-4 h-4 text-purple-600 shrink-0" />
                            ) : (
                              <File className="w-4 h-4 text-purple-600 shrink-0" />
                            )}
                            <span className="text-xs font-bold text-purple-900 dark:text-purple-200 truncate">
                              {inv.fileName}
                            </span>
                            {inv.fileSize && (
                              <span className="text-[10px] text-purple-600 shrink-0">({inv.fileSize})</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveInvoiceFile(index)}
                            className="p-1 text-purple-400 hover:text-red-500 rounded transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className="border border-dashed border-slate-300 dark:border-slate-700 hover:border-purple-500 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-2 flex items-center justify-center gap-2 cursor-pointer transition-colors text-xs font-medium text-slate-600 dark:text-slate-400">
                          <Upload className="w-4 h-4 text-purple-500" />
                          <span>Прикрепить фото / PDF</span>
                          <input
                            type="file"
                            accept="image/*,application/pdf,.xlsx,.xls,.doc,.docx"
                            onChange={(e) => handleInvoiceFileUpload(index, e)}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Invoice Button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleAddInvoice}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>+ Добавить еще накладную (2, 3, 4, 5-я накладная...)</span>
              </button>
            </div>
          </div>

          {/* Section 4: Date, Cargo, Manager & Comments */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-emerald-500" />
                <span>Дата отправки авто *</span>
              </label>
              <input
                type="date"
                required
                value={shipmentDate}
                onChange={(e) => setShipmentDate(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Package className="w-4 h-4 text-indigo-500" />
                <span>Наименование / категория груза</span>
              </label>
              <input
                type="text"
                placeholder="например: Сливочное масло, твердый сыр, десерты"
                value={cargoDescription}
                onChange={(e) => setCargoDescription(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-4 h-4 text-purple-500" />
                <span>Ответственный менеджер *</span>
              </label>
              <input
                type="text"
                required
                placeholder="ФИО сотрудника регионального отдела"
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Phone className="w-4 h-4 text-emerald-500" />
                <span>Телефон менеджера</span>
              </label>
              <input
                type="text"
                placeholder="+7 701 000-0000"
                value={managerPhone}
                onChange={(e) => setManagerPhone(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Особые примечания для логистов (склад погрузки, температурный режим)
            </label>
            <textarea
              rows={2}
              placeholder="например: Погрузка со склада Жолдостар к 09:00, нужен температурный режим +4°C"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white resize-none"
            />
          </div>

          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl flex items-center gap-3 text-amber-800 dark:text-amber-300 text-xs">
            <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 animate-bounce" />
            <span>
              После размещения заявки, отделу логистики автоматически придет <strong>пуш-уведомление</strong> и звуковой сигнал с подробной информацией о накладных и точках выгрузки!
            </span>
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl shadow-lg shadow-blue-500/25 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Truck className="w-4 h-4" />
              <span>{isSubmitting ? 'Размещение...' : '🚀 Разместить заявку на фуру'}</span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
