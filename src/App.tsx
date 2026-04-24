import React from 'react';
import { LanguageProvider, useLanguage } from './LanguageContext';
import { AuthProvider } from './contexts/AuthContext';

// Components
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AuthGuard } from './components/common/AuthGuard';
import { MainApp } from './components/MainApp';

const AppContent = () => {
  const { t } = useLanguage();
  return (
    <ErrorBoundary t={t}>
      <AuthGuard>
        <MainApp />
      </AuthGuard>
    </ErrorBoundary>
  );
};

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
}
