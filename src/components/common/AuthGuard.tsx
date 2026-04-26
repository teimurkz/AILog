import React from 'react';
import { motion } from 'motion/react';
import { Truck } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../../firebase';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const { t } = useLanguage();

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
        <p className="text-slate-500 mb-8">{t('appDescription')}</p>
        <button
          onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/layout/google.svg" className="w-5 h-5 bg-white rounded-full p-0.5" alt="Google" />
          {t('signInGoogle')}
        </button>
      </motion.div>
    </div>
  );

  return <>{children}</>;
};
