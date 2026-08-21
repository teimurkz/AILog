import React from 'react';
import { 
  LayoutDashboard, 
  Package, 
  Archive, 
  Truck, 
  Warehouse,
  CalendarClock,
  Send,
  Navigation, 
  Languages, 
  User as UserIcon, 
  LogOut,
  BookOpen,
  Stamp,
  Mail,
  BarChart3,
  X,
  Shield
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { Language } from '../../translations';
import { cn } from '../../lib/utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (t: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar = ({ activeTab, setActiveTab, isOpen, onClose }: SidebarProps) => {
  const { t, language, setLanguage, isRTL } = useLanguage();
  const { profile, isAdmin, isRegionalManager } = useAuth();
  
  let menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: t('dashboard') },
    { id: 'shipments', icon: Package, label: t('shipments') },
    { id: 'regional-orders', icon: Send, label: t('regionalOrders') },
    { id: 'directories', icon: BookOpen, label: t('directories') },
    { id: 'warehouses', icon: Warehouse, label: t('warehouses') },
    { id: 'auto-mailing', icon: Mail, label: t('autoMailing') || 'Авто-рассылка Excel' },
    { id: 'analytics-reports', icon: BarChart3, label: t('analyticsReports') || 'Аналитика и отчёты' },
    { id: 'kusto-stock-expiry', icon: CalendarClock, label: t('kustoStockExpiry') || 'Остатки по срокам Кусто' },
    { id: 'stamp-scans', icon: Stamp, label: t('stampOnScans') || 'Печать на сканах' },
    { id: 'archive', icon: Archive, label: t('archive') },
    { id: 'fleet', icon: Truck, label: t('fleet') },
  ];

  if (isRegionalManager && !isAdmin) {
    menuItems = [
      { id: 'regional-orders', icon: Send, label: t('regionalOrders') },
      { id: 'directories', icon: BookOpen, label: t('directories') },
    ];
  } else if (isAdmin) {
    menuItems.push({ id: 'admin-tools', icon: Shield, label: 'Admin Panel' });
  }

  const languages: { id: Language; label: string; flag: string }[] = [
    { id: 'en', label: 'English', flag: '🇺🇸' },
    { id: 'fa', label: 'فارسی', flag: '🇮🇷' },
    { id: 'ru', label: 'Русский', flag: '🇷🇺' },
  ];

  const handleTabClick = (id: string) => {
    setActiveTab(id);
    if (window.innerWidth < 1024) onClose();
  };

  return (
    <>
      {/* Mobile Overlay with smooth backdrop blur */}
      <div 
        className={cn(
          "fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 transition-opacity duration-300 lg:hidden",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={cn(
        "w-64 bg-slate-900 text-slate-300 flex flex-col h-full max-h-screen fixed top-0 bottom-0 z-50 transition-transform duration-300 ease-in-out lg:translate-x-0 shadow-2xl border-r border-slate-800/80",
        isRTL ? "right-0" : "left-0",
        isOpen ? "translate-x-0" : (isRTL ? "translate-x-full" : "-translate-x-full")
      )}>
        {/* Sidebar Header */}
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-slate-800/80 shrink-0 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20">
              <Navigation className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-white text-base tracking-tight leading-tight">{t('appName')}</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Logistics Hub</span>
            </div>
          </div>
          
          {/* Mobile Close Button */}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Закрыть меню"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Scrollable Navigation Area */}
        <nav className="flex-1 min-h-0 p-3 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-150 text-left text-sm font-medium",
                  activeTab === item.id 
                    ? "bg-blue-600 text-white shadow-md shadow-blue-900/30 font-semibold" 
                    : "text-slate-300 hover:bg-slate-800/80 hover:text-white",
                  isRTL && "flex-row-reverse text-right"
                )}
              >
                <item.icon className={cn("w-4 h-4 shrink-0", activeTab === item.id ? "text-white" : "text-slate-400")} />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>

          {/* Language Switcher Section */}
          <div className="pt-3 mt-3 border-t border-slate-800/80">
            <div className={cn("px-3 py-1 flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider", isRTL && "flex-row-reverse")}>
              <Languages className="w-3.5 h-3.5 text-slate-400" />
              <span>Language</span>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-1 px-1">
              {languages.map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => setLanguage(lang.id)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors",
                    language === lang.id ? "bg-slate-800 text-white border border-slate-700 font-bold" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  )}
                  title={lang.label}
                >
                  <span>{lang.flag}</span>
                  <span className="uppercase text-[11px]">{lang.id}</span>
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* User Profile & Sign Out Footer */}
        <div className="p-3.5 border-t border-slate-800/80 shrink-0 bg-slate-950/70">
          <div className={cn("flex items-center gap-2.5 px-2 py-1.5 mb-1.5", isRTL && "flex-row-reverse")}>
            <div className="w-8 h-8 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center shrink-0">
              <UserIcon className="w-4 h-4 text-slate-300" />
            </div>
            <div className={cn("flex-1 min-w-0", isRTL ? "text-right" : "text-left")}>
              <p className="text-xs font-semibold text-white truncate">{auth.currentUser?.displayName || 'Пользователь'}</p>
              <p className="text-[10px] text-slate-400 truncate">{auth.currentUser?.email || ''}</p>
            </div>
          </div>
          <button 
            onClick={() => signOut(auth)}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors text-xs font-medium",
              isRTL && "flex-row-reverse"
            )}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>{t('signOut')}</span>
          </button>
        </div>
      </aside>
    </>
  );
};
