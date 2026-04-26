import React, { useState } from 'react';
import { Truck, FileText, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { Shipment } from '../types';
import { cn } from '../lib/utils';

// Components
import { Sidebar } from './common/Sidebar';
import { Dashboard } from './dashboard/Dashboard';
import { ShipmentList } from './shipments/ShipmentList';
import { ShipmentDetails } from './shipments/ShipmentDetails';
import { NewShipmentModal } from './shipments/NewShipmentModal';
import { UserManagement } from './admin/UserManagement';
import { ExcelImport } from './admin/ExcelImport';

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { shipments } = useShipments();

  return (
    <div className="min-h-screen bg-slate-50 flex overflow-x-hidden">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={(t) => { setActiveTab(t); setSelectedShipment(null); }} 
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      
      <main className={cn(
        "flex-1 p-4 sm:p-8 transition-all duration-300 w-full min-h-screen",
        isRTL ? "lg:mr-64" : "lg:ml-64"
      )}>
        <header className={cn("flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4", isRTL && "sm:flex-row-reverse")}>
          <div className={cn("flex items-center justify-between w-full sm:w-auto", isRTL && "flex-row-reverse")}>
            <div className={isRTL ? "text-right" : "text-left"}>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                {t(activeTab as any) || activeTab}
              </h1>
              <p className="text-sm text-slate-500 mt-1">{t('controlCenter')}</p>
            </div>
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="lg:hidden p-2 bg-white border border-slate-200 rounded-xl text-slate-600 shadow-sm"
            >
              {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
          <div className={cn("flex flex-wrap items-center gap-2 sm:gap-4", isRTL && "flex-row-reverse")}>
            <button
              onClick={() => generateDelayReport(shipments, t)}
              className="px-3 sm:px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
            >
              <FileText className="w-3 h-3 sm:w-4 h-4" />
              {t('generateDelayReport')}
            </button>
            <div className="bg-white p-2 rounded-xl border border-slate-200 flex items-center gap-2 px-3 sm:px-4">
              <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest">{t('systemOnline')}</span>
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
            ) : activeTab === 'admin-tools' && isAdmin ? (
              <div className="space-y-8">
                <ExcelImport />
                <UserManagement />
              </div>
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
