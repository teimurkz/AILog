import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X, Undo2 } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  onUndo?: () => void;
  undoLabel?: string;
}

interface ToastContextType {
  showToast: (toast: Omit<ToastItem, 'id'>) => string;
  showSuccess: (message: string, title?: string) => string;
  showError: (message: string, title?: string) => string;
  showWarning: (message: string, title?: string) => string;
  showInfo: (message: string, title?: string) => string;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type, title, message, duration = 4000, onUndo, undoLabel = 'Отменить' }: Omit<ToastItem, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const newToast: ToastItem = { id, type, title, message, duration, onUndo, undoLabel };

      setToasts((prev) => [...prev.slice(-4), newToast]); // Keep max 5 visible

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }

      return id;
    },
    [removeToast]
  );

  const showSuccess = useCallback((message: string, title?: string) => showToast({ type: 'success', message, title }), [showToast]);
  const showError = useCallback((message: string, title?: string) => showToast({ type: 'error', message, title }), [showToast]);
  const showWarning = useCallback((message: string, title?: string) => showToast({ type: 'warning', message, title }), [showToast]);
  const showInfo = useCallback((message: string, title?: string) => showToast({ type: 'info', message, title }), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo, removeToast }}>
      {children}
      {/* Floating Toast Portal Container */}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, x: 20 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto p-4 rounded-2xl shadow-xl border flex items-start gap-3 backdrop-blur-md transition-all ${
                t.type === 'success'
                  ? 'bg-emerald-950/90 text-white border-emerald-500/40 shadow-emerald-950/20'
                  : t.type === 'error'
                  ? 'bg-rose-950/90 text-white border-rose-500/40 shadow-rose-950/20'
                  : t.type === 'warning'
                  ? 'bg-amber-950/90 text-white border-amber-500/40 shadow-amber-950/20'
                  : 'bg-slate-900/90 text-white border-slate-700 shadow-slate-950/20'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                {t.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" />}
                {t.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
                {t.type === 'info' && <Info className="w-5 h-5 text-blue-400" />}
              </div>

              <div className="flex-1 min-w-0">
                {t.title && <h4 className="text-xs font-bold uppercase tracking-wider opacity-90 mb-0.5">{t.title}</h4>}
                <p className="text-xs font-medium leading-relaxed">{t.message}</p>
                {t.onUndo && (
                  <button
                    onClick={() => {
                      t.onUndo?.();
                      removeToast(t.id);
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 hover:text-white underline transition-colors"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>{t.undoLabel}</span>
                  </button>
                )}
              </div>

              <button
                onClick={() => removeToast(t.id)}
                className="text-white/60 hover:text-white p-1 transition-colors rounded-lg hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};
