import React, { useState } from 'react';
import { 
  BookOpen, 
  MapPin, 
  Truck as TruckIcon, 
  Building2, 
  Plus, 
  Search, 
  Trash2, 
  Phone, 
  User, 
  Copy, 
  Check,
  Navigation
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSavedDeliveryContacts } from '../../hooks/useSavedDeliveryContacts';
import { useSavedTrucks } from '../../hooks/useSavedTrucks';
import { DataLoadNotice } from '../common/DataLoadNotice';
import { useSectionText } from '../../i18n/useSectionText';
import { DIRECTORIES_TEXTS } from './directories-i18n';
import { ConsigneesDirectory } from './ConsigneesDirectory';

export const DirectoriesManager: React.FC = () => {
  const { text, locale } = useSectionText(DIRECTORIES_TEXTS);
  // City names and trailer types are stored in Russian; only their labels follow the language.
  const cityName = (name: string) => (text.cities as Record<string, string>)[name] ?? name;
  const truckTypeName = (type: string) => (text.truckTypes as Record<string, string>)[type] ?? type;
  const [activeTab, setActiveTab] = useState<'contacts' | 'trucks' | 'cities' | 'consignees'>('contacts');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { savedContacts, addSavedContact, deleteSavedContact, loading: contactsLoading, error: contactsError, retry: retryContacts } = useSavedDeliveryContacts();
  const { savedTrucks, addSavedTruck, deleteSavedTruck, loading: trucksLoading, error: trucksError, retry: retryTrucks } = useSavedTrucks();

  // Contact form state
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [city, setCity] = useState('Астана');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('+7 701 ');
  const [recipientName, setRecipientName] = useState('');

  // Truck form state
  const [isAddTruckOpen, setIsAddTruckOpen] = useState(false);
  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('+7 701 ');
  const [truckType, setTruckType] = useState('Фура 20т (Тент)');

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryAddress.trim() || !recipientPhone.trim()) return;

    await addSavedContact({
      title: `${city} — ${deliveryAddress}`,
      city,
      deliveryAddress: deliveryAddress.trim(),
      recipientPhone: recipientPhone.trim(),
      recipientName: recipientName.trim(),
    });

    setDeliveryAddress('');
    setRecipientPhone('+7 701 ');
    setRecipientName('');
    setIsAddContactOpen(false);
  };

  const handleCreateTruck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plateNumber.trim()) return;

    await addSavedTruck({
      plateNumber: plateNumber.trim(),
      driverName: driverName.trim(),
      driverPhone: driverPhone.trim(),
      truckType,
    });

    setPlateNumber('');
    setDriverName('');
    setDriverPhone('+7 701 ');
    setIsAddTruckOpen(false);
  };

  const filteredContacts = savedContacts.filter(c => 
    c.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.deliveryAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.recipientPhone.includes(searchQuery) ||
    (c.recipientName && c.recipientName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredTrucks = savedTrucks.filter(t => 
    t.plateNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.driverName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.driverPhone.includes(searchQuery) ||
    (t.truckType && t.truckType.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const defaultCities: { name: string; region: keyof typeof text.regions; code: string }[] = [
    { name: 'Алматы', region: 'hub', code: 'ALA' },
    { name: 'Астана', region: 'north', code: 'TSE' },
    { name: 'Шымкент', region: 'south', code: 'CIT' },
    { name: 'Караганда', region: 'center', code: 'KGF' },
    { name: 'Актобе', region: 'west', code: 'AKX' },
    { name: 'Павлодар', region: 'northEast', code: 'PWQ' },
    { name: 'Усть-Каменогорск', region: 'east', code: 'UKK' },
    { name: 'Костанай', region: 'northWest', code: 'KSN' },
    { name: 'Тараз', region: 'zhambyl', code: 'DMB' },
    { name: 'Атырау', region: 'west', code: 'GUW' },
  ];

  return (
    <div className="space-y-6">
      {activeTab === 'contacts' && <DataLoadNotice loading={contactsLoading} error={contactsError} onRetry={retryContacts} />}
      {activeTab === 'trucks' && <DataLoadNotice loading={trucksLoading} error={trucksError} onRetry={retryTrucks} />}
      {/* Top Banner Header */}
      <div className="crm-page-header relative">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-blue-50 border border-blue-100 rounded-xl">
                <BookOpen className="w-5 h-5 text-blue-600" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">{text.title}</h2>
            </div>
            <p className="text-xs sm:text-sm text-indigo-200/80 max-w-2xl">
              {text.intro}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'contacts' && (
              <button
                onClick={() => setIsAddContactOpen(!isAddContactOpen)}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-900/30 transition-all flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>{text.addPoint}</span>
              </button>
            )}
            {activeTab === 'trucks' && (
              <button
                onClick={() => setIsAddTruckOpen(!isAddTruckOpen)}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-900/30 transition-all flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>{text.addTruck}</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation Switches */}
        <div className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-slate-200">
          <button
            onClick={() => { setActiveTab('contacts'); setSearchQuery(''); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'contacts' 
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <MapPin className="w-4 h-4" />
            <span>{text.tabs.contacts(savedContacts.length)}</span>
          </button>

          <button
            onClick={() => { setActiveTab('trucks'); setSearchQuery(''); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'trucks' 
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <TruckIcon className="w-4 h-4" />
            <span>{text.tabs.trucks(savedTrucks.length)}</span>
          </button>

          <button
            onClick={() => { setActiveTab('cities'); setSearchQuery(''); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'cities' 
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>{text.tabs.cities}</span>
          </button>

          <button
            onClick={() => { setActiveTab('consignees'); setSearchQuery(''); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'consignees'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>{text.tabs.consignees}</span>
          </button>
        </div>
      </div>

      {/* Search Input Filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={text.search}
            className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
        </div>
      </div>

      {/* TAB 1: DELIVERY CONTACTS & ADDRESSES */}
      {activeTab === 'contacts' && (
        <div className="space-y-4">
          {/* Form Modal / Inline panel */}
          <AnimatePresence>
            {isAddContactOpen && (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                onSubmit={handleCreateContact}
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 shadow-lg space-y-4 overflow-hidden"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-indigo-600" />
                    <span>{text.contact.newTitle}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsAddContactOpen(false)}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {text.cancel}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">{text.contact.city}</label>
                    <select
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                    >
                      {['Астана', 'Алматы', 'Шымкент', 'Караганда', 'Актобе', 'Павлодар', 'Усть-Каменогорск', 'Костанай', 'Тараз', 'Атырау'].map(c => (
                        <option key={c} value={c}>{cityName(c)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">{text.contact.address}</label>
                    <input
                      type="text"
                      required
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder={text.contact.addressPlaceholder}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">{text.contact.phone}</label>
                    <input
                      type="text"
                      required
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="+7 701 123 4567"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">{text.contact.recipient}</label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder={text.contact.recipientPlaceholder}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md transition-all"
                  >
                    {text.save}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {filteredContacts.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 p-12 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
              <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{text.contact.empty}</p>
              <p className="text-xs text-slate-400 mt-1">{text.contact.emptyHint}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-3 group"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-extrabold text-[11px] rounded-lg border border-indigo-200/50 dark:border-slate-200">
                          {cityName(contact.city)}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(text.contact.confirmDelete(contact.deliveryAddress))) {
                            deleteSavedContact(contact.id);
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors opacity-80 group-hover:opacity-100"
                        title={text.remove}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <p className="font-bold text-slate-900 dark:text-slate-100 text-xs mb-1 line-clamp-2">
                      {contact.deliveryAddress}
                    </p>

                    <div className="space-y-1 mt-2 text-[11px] text-slate-600 dark:text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="font-medium">{contact.recipientPhone}</span>
                      </div>
                      {contact.recipientName && (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{contact.recipientName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">
                      {contact.createdAt ? new Date(contact.createdAt).toLocaleDateString(locale) : text.saved}
                    </span>
                    <button
                      onClick={() => handleCopy(`${cityName(contact.city)}, ${contact.deliveryAddress}, ${text.contact.phoneShort} ${contact.recipientPhone}`, contact.id)}
                      className="px-2.5 py-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1"
                    >
                      {copiedId === contact.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>{text.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{text.copy}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: TRUCKS & DRIVERS */}
      {activeTab === 'trucks' && (
        <div className="space-y-4">
          <AnimatePresence>
            {isAddTruckOpen && (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                onSubmit={handleCreateTruck}
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 shadow-lg space-y-4 overflow-hidden"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <TruckIcon className="w-4 h-4 text-indigo-600" />
                    <span>{text.truck.newTitle}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsAddTruckOpen(false)}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {text.cancel}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">{text.truck.plate}</label>
                    <input
                      type="text"
                      required
                      value={plateNumber}
                      onChange={(e) => setPlateNumber(e.target.value)}
                      placeholder="777 ABC 02"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 uppercase"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">{text.truck.driver}</label>
                    <input
                      type="text"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder={text.truck.driverPlaceholder}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">{text.truck.phone}</label>
                    <input
                      type="text"
                      value={driverPhone}
                      onChange={(e) => setDriverPhone(e.target.value)}
                      placeholder="+7 701 123 4567"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">{text.truck.type}</label>
                    <select
                      value={truckType}
                      onChange={(e) => setTruckType(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                    >
                      {Object.keys(text.truckTypes).map(type => (
                        <option key={type} value={type}>{truckTypeName(type)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md transition-all"
                  >
                    {text.save}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {filteredTrucks.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 p-12 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
              <TruckIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{text.truck.empty}</p>
              <p className="text-xs text-slate-400 mt-1">{text.truck.emptyHint}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTrucks.map((truck) => (
                <div
                  key={truck.id}
                  className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-3 group"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-mono font-black text-xs rounded-lg border border-emerald-200/50 dark:border-emerald-800/50 uppercase tracking-wider">
                        🚛 {truck.plateNumber}
                      </span>
                      <button
                        onClick={() => {
                          if (confirm(text.truck.confirmDelete(truck.plateNumber))) {
                            deleteSavedTruck(truck.id);
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors opacity-80 group-hover:opacity-100"
                        title={text.remove}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
                      {truck.truckType ? truckTypeName(truck.truckType) : text.truck.defaultType}
                    </p>

                    <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                      {truck.driverName && (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{text.truck.driverLabel(truck.driverName)}</span>
                        </div>
                      )}
                      {truck.driverPhone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{text.truck.phoneLabel(truck.driverPhone)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">
                      {truck.createdAt ? new Date(truck.createdAt).toLocaleDateString(locale) : text.saved}
                    </span>
                    <button
                      onClick={() => handleCopy(`${truck.plateNumber} (${truck.driverName} ${truck.driverPhone})`, truck.id)}
                      className="px-2.5 py-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1"
                    >
                      {copiedId === truck.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>{text.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{text.copy}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'consignees' && <ConsigneesDirectory searchQuery={searchQuery} />}

      {/* TAB 3: CITIES & HUBS */}
      {activeTab === 'cities' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {defaultCities
            .filter(c => [c.name, cityName(c.name), text.regions[c.region]].some(label => label.toLowerCase().includes(searchQuery.toLowerCase())))
            .map((city) => (
              <div
                key={city.code}
                className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl border border-indigo-200/50 dark:border-slate-200 text-indigo-600 dark:text-indigo-400">
                    <Navigation className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">{cityName(city.name)}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{text.regions[city.region]}</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-mono font-bold rounded-lg">
                  {city.code}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
