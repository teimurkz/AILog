import React from 'react';
import { 
  LayoutDashboard, 
  Package, 
  Archive, 
  Truck, 
  Navigation, 
  Languages, 
  User as UserIcon, 
  LogOut 
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import { useLanguage } from '../../LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { Language } from '../../translations';
import { cn } from '../../lib/utils';
import { Shield } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (t: string) => void;
}

export const Sidebar = ({ activeTab, setActiveTab }: SidebarProps) => {
  const { t, language, setLanguage, isRTL } = useLanguage();
  const { profile, isAdmin } = useAuth();
  
  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: t('dashboard') },
    { id: 'shipments', icon: Package, label: t('shipments') },
    { id: 'archive', icon: Archive, label: t('archive') },
    { id: 'fleet', icon: Truck, label: t('fleet') },
  ];

  if (isAdmin) {
    menuItems.push({ id: 'users', icon: Shield, label: t('users') });
  }

  const languages: { id: Language; label: string; flag: string }[] = [
    { id: 'en', label: 'English', flag: '🇺🇸' },
    { id: 'fa', label: 'فارسی', flag: '🇮🇷' },
    { id: 'ru', label: 'Русский', flag: '🇷🇺' },
  ];

  return (
    <div className={cn(
      "w-64 bg-slate-900 text-slate-300 flex flex-col h-screen fixed top-0",
      isRTL ? "right-0" : "left-0"
    )}>
      <div className="p-6 flex items-center gap-3 border-b border-slate-800">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <Navigation className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-white text-lg tracking-tight">{t('appName')}</span>
      </div>
      
      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
              activeTab === item.id 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                : "hover:bg-slate-800 hover:text-white",
              isRTL && "flex-row-reverse"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}

        <div className="pt-4 mt-4 border-t border-slate-800">
          <div className={cn("px-4 py-2 flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest", isRTL && "flex-row-reverse")}>
            <Languages className="w-4 h-4" />
            <span>Language</span>
          </div>
          <div className="grid grid-cols-1 gap-1 mt-2">
            {languages.map((lang) => (
              <button
                key={lang.id}
                onClick={() => setLanguage(lang.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 rounded-lg text-sm transition-colors",
                  language === lang.id ? "bg-slate-800 text-white" : "hover:bg-slate-800/50",
                  isRTL && "flex-row-reverse"
                )}
              >
                <span>{lang.flag}</span>
                <span className="flex-1 text-left">{lang.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className={cn("flex items-center gap-3 px-4 py-3 mb-2", isRTL && "flex-row-reverse")}>
          <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center">
            <UserIcon className="w-4 h-4 text-slate-300" />
          </div>
          <div className={cn("flex-1 min-w-0", isRTL ? "text-right" : "text-left")}>
            <p className="text-sm font-medium text-white truncate">{auth.currentUser?.displayName}</p>
            <p className="text-xs text-slate-500 truncate">{auth.currentUser?.email}</p>
          </div>
        </div>
        <button 
          onClick={() => signOut(auth)}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-red-400 transition-colors",
            isRTL && "flex-row-reverse"
          )}
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm font-medium">{t('signOut')}</span>
        </button>
      </div>
    </div>
  );
};
