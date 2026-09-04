import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Command, X, Truck, Building2, Stamp, Mail, FileSpreadsheet, User, ArrowRight } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onNavigate }) => {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Open handled by parent listener
        }
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const navItems = [
    { id: 'regional', title: 'Региональные рейсы (Астана, Шымкент)', icon: Truck, category: 'Навигация' },
    { id: 'shipments', title: 'Складской учет и статусы авто', icon: Building2, category: 'Навигация' },
    { id: 'stamps', title: 'Печать и штампы на PDF / Сканы', icon: Stamp, category: 'Инструменты' },
    { id: 'automailing', title: 'Авто-рассылка отчетов Excel', icon: Mail, category: 'Инструменты' },
    { id: 'analytics', title: 'Аналитика и сводные отчеты', icon: FileSpreadsheet, category: 'Аналитика' },
    { id: 'directories', title: 'Справочники (Водители, Клиенты)', icon: User, category: 'Настройки' },
  ];

  const filtered = navItems.filter(item =>
    item.title.toLowerCase().includes(query.toLowerCase()) ||
    item.category.toLowerCase().includes(query.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] bg-slate-900/80 backdrop-blur-md flex items-start justify-center pt-16 sm:pt-24 px-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -10 }}
          className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-xl w-full overflow-hidden space-y-0"
        >
          {/* Header Input */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
            <Search className="w-5 h-5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Поиск по меню, заказам, водителям (Ctrl + K)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
            />
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Results List */}
          <div className="max-h-80 overflow-y-auto p-3 space-y-1">
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Ничего не найдено по запросу «{query}»
              </div>
            ) : (
              filtered.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.id);
                      onClose();
                    }}
                    className="w-full p-3 rounded-2xl flex items-center justify-between text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-100 dark:bg-slate-700/60 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold">{item.title}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider">{item.category}</div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })
            )}
          </div>

          {/* Footer Shortcuts */}
          <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Command className="w-3.5 h-3.5" /> + <b>K</b> чтобы открыть / закрыть
            </span>
            <span>Нажмите <b>Esc</b> для выхода</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
