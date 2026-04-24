import React, { useState } from 'react';
import { Truck, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../LanguageContext';
import { Shipment } from '../types';
import { cn } from '../lib/utils';

// Components
import { Sidebar } from './common/Sidebar';
import { Dashboard } from './dashboard/Dashboard';
import { ShipmentList } from './shipments/ShipmentList';
import { ShipmentDetails } from './shipments/ShipmentDetails';
import { NewShipmentModal } from './shipments/NewShipmentModal';
import { UserManagement } from './admin/UserManagement';

// Hooks
import { useShipments } from '../hooks/useShipments';
import { useAuth } from '../contexts/AuthContext';

// Utils
import { generateDelayReport } from '../utils/reports';

export const MainApp = () => {
  const { t, isRTL } = useLanguage();
  const { isAdmin, isLogistics } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const { shipments } = useShipments();

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar activeTab={activeTab} setActiveTab={(t) => { setActiveTab(t); setSelectedShipment(null); }} />
      
      <main className={cn(
        "flex-1 p-8 transition-all duration-300",
        isRTL ? "mr-64" : "ml-64"
      )}>
        <header className={cn("flex items-center justify-between mb-8", isRTL && "flex-row-reverse")}>
          <div className={isRTL ? "text-right" : "text-left"}>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
              {t(activeTab as any) || activeTab}
            </h1>
            <p className="text-slate-500 mt-1">{t('controlCenter')}</p>
          </div>
          <div className={cn("flex items-center gap-4", isRTL && "flex-row-reverse")}>
            <button
              onClick={() => generateDelayReport(shipments, t)}
              className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              {t('generateDelayReport')}
            </button>
            <div className="bg-white p-2 rounded-xl border border-slate-200 flex items-center gap-2 px-4">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">{t('systemOnline')}</span>
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={selectedShipment ? 'details' : activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {selectedShipment ? (
              <ShipmentDetails 
                shipment={shipments.find(s => s.id === selectedShipment.id) || selectedShipment} 
                onBack={() => setSelectedShipment(null)} 
              />
            ) : activeTab === 'dashboard' ? (
              <Dashboard shipments={shipments} onSelect={setSelectedShipment} />
            ) : activeTab === 'shipments' ? (
              <ShipmentList 
                shipments={shipments} 
                onSelect={setSelectedShipment} 
                onNew={() => setIsNewModalOpen(true)} 
              />
            ) : activeTab === 'archive' ? (
              <ShipmentList 
                shipments={shipments} 
                onSelect={setSelectedShipment} 
                onNew={() => setIsNewModalOpen(true)}
                filterStatus={['Delivered']}
              />
            ) : activeTab === 'users' && isAdmin ? (
              <UserManagement />
            ) : (
              <div className="bg-white p-12 rounded-2xl shadow-sm border border-slate-100 text-center">
                <Truck className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-slate-900">{t('fleet')}</h3>
                <p className="text-slate-500">{t('comingSoon')}</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <NewShipmentModal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} />
      </main>
    </div>
  );
};
