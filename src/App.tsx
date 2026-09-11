import React from 'react';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';

// Components
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AuthGuard } from './components/common/AuthGuard';
import { MainApp } from './components/MainApp';
import { DriverGpsTracker } from './components/regional/DriverGpsTracker';
import { StandaloneRouteMap } from './components/regional/RouteMapModal';

const AppContent = () => {
  const { t } = useLanguage();

  // Allow drivers to open GPS tracker on phone without CRM login
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();
  if (path === '/gps-map') return <AuthGuard><StandaloneRouteMap /></AuthGuard>;
  if (path.startsWith('/gps') || path.startsWith('/track') || search.includes('track=') || search.includes('driver=')) {
    return <DriverGpsTracker />;
  }

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
