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
import { WarehouseInventory } from './warehouses/WarehouseInventory';
import { RegionalOrders } from './regional/RegionalOrders';
import { DirectoriesManager } from './directories/DirectoriesManager';
import { KustoExpiryStock } from './kusto/KustoExpiryStock';
import { StampOnScans } from './stamps/StampOnScans';
import { WarehouseAutoMailing } from './warehouses/WarehouseAutoMailing';
import { AnalyticsReports } from './analytics/AnalyticsReports';

// Hooks
import { useShipments } from '../hooks/useShipments';
import { useAuth } from '../contexts/AuthContext';

// Utils
import { generateDelayReport } from '../utils/reports';

export const MainApp = () => {
  const { t, isRTL } = useLanguage();
  const { isAdmin, isLogistics, isRegionalManager } = useAuth();
  const [activeTab, setActiveTab] = React.useState('dashboard');
  const [selectedShipment, setSelectedShipment] = React.useState<Shipment | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = React.useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const { shipments } = useShipments();

  const isRegionalOnly = isRegionalManager && !isAdmin;
  const currentTab = isRegionalOnly && activeTab !== 'directories' ? 'regional-orders' : activeTab;

  React.useEffect(() => {
    if (isRegionalOnly && activeTab !== 'regional-orders' && activeTab !== 'directories') {
      setActiveTab('regional-orders');
    }
  }, [isRegionalOnly, activeTab]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col relative antialiased selection:bg-blue-100 selection:text-blue-900">
      <Sidebar 
        activeTab={currentTab} 
        setActiveTab={(t) => { setActiveTab(t); setSelectedShipment(null); }} 
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      
      {/* Mobile Top Header */}
      <div className="lg:hidden sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 rounded-xl text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Открыть меню"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-900 leading-tight truncate max-w-[190px] sm:max-w-xs">
              {t(currentTab as any) || currentTab}
            </span>
            <span className="text-[10px] text-slate-500">Silk Road Logistics</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2 py-1 rounded-lg flex items-center gap-1.5 text-[10px] font-bold">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="hidden xs:inline">ONLINE</span>
          </div>
        </div>
      </div>

      <main className={cn(
        "flex-1 min-w-0 transition-all duration-300 flex flex-col",
        isRTL ? "lg:mr-64" : "lg:ml-64"
      )}>
        <div className="flex-1 w-full max-w-[1700px] mx-auto p-3.5 sm:p-5 md:p-6 lg:p-8 space-y-6">
          {/* Desktop & Tablet Header */}
          <header className={cn("hidden lg:flex items-center justify-between gap-4 pb-2 border-b border-slate-200/60", isRTL && "flex-row-reverse")}>
            <div className={isRTL ? "text-right" : "text-left"}>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                {t(currentTab as any) || currentTab}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">{t('controlCenter')}</p>
            </div>
            
            <div className={cn("flex flex-wrap items-center gap-2.5 sm:gap-3", isRTL && "flex-row-reverse")}>
              {!isRegionalOnly && (
                <button
                  onClick={() => generateDelayReport(shipments, t)}
                  className="px-3.5 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-2xs flex items-center gap-2"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>{t('generateDelayReport')}</span>
                </button>
              )}
              <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200 flex items-center gap-2 shadow-2xs">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold text-slate-700 tracking-wide uppercase">{t('systemOnline')}</span>
              </div>
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={selectedShipment ? 'details' : currentTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="w-full min-w-0"
            >
              {selectedShipment && !isRegionalOnly ? (
                <ShipmentDetails 
                  shipment={shipments.find(s => s.id === selectedShipment.id) || selectedShipment} 
                  onBack={() => setSelectedShipment(null)} 
                />
              ) : currentTab === 'regional-orders' ? (
                <RegionalOrders />
              ) : currentTab === 'directories' ? (
                <DirectoriesManager />
              ) : currentTab === 'dashboard' ? (
                <Dashboard shipments={shipments} onSelect={setSelectedShipment} />
              ) : currentTab === 'shipments' ? (
                <ShipmentList 
                  shipments={shipments} 
                  onSelect={setSelectedShipment} 
                  onNew={() => setIsNewModalOpen(true)} 
                />
              ) : currentTab === 'warehouses' ? (
                <WarehouseInventory />
              ) : currentTab === 'auto-mailing' ? (
                <WarehouseAutoMailing />
              ) : currentTab === 'analytics-reports' ? (
                <AnalyticsReports />
              ) : currentTab === 'kusto-stock-expiry' ? (
                <KustoExpiryStock />
              ) : currentTab === 'stamp-scans' ? (
                <StampOnScans />
              ) : currentTab === 'archive' ? (
                <ShipmentList 
                  shipments={shipments} 
                  onSelect={setSelectedShipment} 
                  onNew={() => setIsNewModalOpen(true)} 
                  filterStatus={['Delivered']}
                />
              ) : currentTab === 'admin-tools' && isAdmin ? (
                <div className="space-y-8">
                  <ExcelImport />
                  <UserManagement />
                </div>
              ) : (
                <div className="bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-slate-200/70 text-center">
                  <Truck className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-slate-900">{t('fleet')}</h3>
                  <p className="text-slate-500 mt-1 text-sm">{t('comingSoon')}</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <NewShipmentModal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} />
        </div>
      </main>
    </div>
  );
};
