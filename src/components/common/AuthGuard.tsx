import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Truck, AlertCircle, ArrowUpRight } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../../firebase';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { firebaseSignInError } from '../../services/firebase-auth-errors';
import { translateMessage } from '../../i18n/common-i18n';

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading, authError } = useAuth();
  const { t, language } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setError(null);
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err: any) {
      console.error("Firebase Auth Error:", err);
      setError(firebaseSignInError(err, t('signInError'), language));
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
          <div className="mb-6 p-4 bg-amber-50 rounded-xl border border-amber-200 text-start text-xs text-amber-900 flex gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-2 w-full">
              <p className="font-semibold text-amber-950">{t('signInFailedTitle')}</p>
              <p className="leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleGoogleSignIn}
            disabled={authLoading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-blue-500/10 text-sm"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/layout/google.svg" className="w-4 h-4 bg-white rounded-full p-0.5" alt="Google" />
            {t('signInGoogle')}
          </button>
        </div>
      </motion.div>
    </div>
  );

  if (authError) return <div className="min-h-screen flex items-center justify-center p-6"><p role="alert">{translateMessage(authError, language)}</p></div>;
  return <React.Fragment key={`${user.uid}:${profile?.role}`}>{children}</React.Fragment>;
};
