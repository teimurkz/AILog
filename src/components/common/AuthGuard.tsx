import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Truck, AlertCircle, ArrowUpRight } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signInAnonymously } from 'firebase/auth';
import { auth } from '../../firebase';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setError(null);
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err: any) {
      console.error("Firebase Auth Error:", err);
      if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-blocked') {
        setError(t('authBlockedMessage'));
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('Домен localhost / IP не добавлен в список авторизованных доменов OAuth в Консоли Firebase (Authentication -> Settings -> Authorized domains). Пожалуйста, воспользуйтесь кнопкой "Войти как гость (Демо)" ниже.');
      } else {
        setError(err.message || t('signInError'));
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    setError(null);
    setAuthLoading(true);
    try {
      await signInAnonymously(auth);
    } catch (err: any) {
      console.error("Guest Sign-in Error:", err);
      setError(t('guestSignInError'));
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
    </div>
  );

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
      >
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Truck className="w-8 h-8 text-blue-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('appName')}</h1>
        <p className="text-slate-500 mb-6">{t('appDescription')}</p>

        {error && (
          <div className="mb-6 p-4 bg-amber-50 rounded-xl border border-amber-200 text-left text-xs text-amber-900 flex gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-2 w-full">
              <p className="font-semibold text-amber-950">{t('authBlockedTitle')}</p>
              <p className="leading-relaxed">{error}</p>
              <button
                onClick={handleGuestSignIn}
                disabled={authLoading}
                className="mt-2 w-full py-2.5 px-3 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-semibold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                ⚡ Войти в систему без Google (Демо-доступ)
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleGuestSignIn}
            disabled={authLoading}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-500/10 text-sm"
          >
            ⚡ {t('signInGuest')} (Полный доступ)
          </button>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-400 font-medium">{t('or')}</span>
            </div>
          </div>

          <button
            onClick={handleGoogleSignIn}
            disabled={authLoading}
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 text-slate-700 font-medium rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer border border-slate-200 text-xs"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/layout/google.svg" className="w-4 h-4 bg-white rounded-full p-0.5" alt="Google" />
            {t('signInGoogle')}
          </button>
        </div>
      </motion.div>
    </div>
  );

  return <>{children}</>;
};
