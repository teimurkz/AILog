import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO, addDays } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { collection, addDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../lib/utils';

interface NewShipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewShipmentModal = ({ isOpen, onClose }: NewShipmentModalProps) => {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    invoice_id: '',
    route: 'Tehran - Almaty' as 'Tehran - Almaty' | 'Amol - Almaty',
    departure_date: format(new Date(), 'yyyy-MM-dd'),
    est_travel_time: 12
  });
  const [items, setItems] = useState<string[]>(['']);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleAddItem = () => setItems([...items, '']);
  const handleRemoveItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    } else {
      setItems(['']);
    }
  };
  const handleItemChange = (index: number, value: string) => {
    const newItems = [...items];
    newItems[index] = value;
    setItems(newItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const path = 'shipments';
    try {
      const departure = parseISO(formData.departure_date);
      const arrivalDeadline = addDays(departure, formData.est_travel_time).toISOString();
      
      const shipmentData: any = {
        ...formData,
        items: items.filter(i => i.trim() !== ''),
        departure_date: departure.toISOString(),
        arrival_deadline: arrivalDeadline,
        status: 'In Transit',
        documents_url: [],
        last_updated: new Date().toISOString(),
        createdBy: auth.currentUser?.uid || 'system'
      };

      // Remove undefined keys manually to prevent Firestore errors
      Object.keys(shipmentData).forEach(key => shipmentData[key] === undefined && delete shipmentData[key]);

      await addDoc(collection(db, path), shipmentData);
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="p-4 sm:p-8 border-b border-slate-100">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{t('newShipment')}</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 sm:p-8 space-y-4 sm:space-y-6 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div className="space-y-2">
              <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('truckId')}</label>
              <input 
                required
                value={formData.invoice_id}
                onChange={e => setFormData({...formData, invoice_id: e.target.value})}
                className="w-full px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm sm:text-base"
                placeholder="e.g. Mehkaz 65"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('route')}</label>
              <select 
                value={formData.route}
                onChange={e => setFormData({...formData, route: e.target.value as any})}
                className="w-full px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm sm:text-base"
              >
                <option value="Tehran - Almaty">Tehran - Almaty</option>
                <option value="Amol - Almaty">Amol - Almaty</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('departureDate')}</label>
              <input 
                type="date"
                required
                value={formData.departure_date}
                onChange={e => setFormData({...formData, departure_date: e.target.value})}
                className="w-full px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm sm:text-base"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('estTravelTime')}</label>
              <input 
                type="number"
                required
                value={formData.est_travel_time}
                onChange={e => setFormData({...formData, est_travel_time: parseInt(e.target.value)})}
                className="w-full px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm sm:text-base"
              />
            </div>
          </div>

          <div className="space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('items')}</label>
              <button 
                type="button"
                onClick={handleAddItem}
                className="text-[10px] sm:text-xs font-bold text-blue-600 flex items-center gap-1 hover:text-blue-700 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t('addItem')}
              </button>
            </div>
            <div className="space-y-2 sm:space-y-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence initial={false}>
                {items.map((item, index) => (
                  <motion.div 
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex gap-2"
                  >
                    <input 
                      value={item}
                      onChange={e => handleItemChange(index, e.target.value)}
                      className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
                      placeholder={t('itemPlaceholder')}
                    />
                    <button 
                      type="button"
                      onClick={() => handleRemoveItem(index)}
                      className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex gap-3 sm:gap-4 pt-2 sm:pt-4">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-3 sm:py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all text-sm sm:text-base"
            >
              {t('cancel')}
            </button>
            <button 
              type="submit"
              disabled={loading}
              className="flex-1 py-3 sm:py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50 text-sm sm:text-base"
            >
              {loading ? t('creating') : t('createShipment')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
