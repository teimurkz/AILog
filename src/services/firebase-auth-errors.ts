import type { CrmLanguage } from '../../shared/i18n';
import { COMMON_TEXTS } from '../i18n/common-i18n';

/** A sign-in error in the chosen language (Russian by default); `fallback` is used for unknown errors without a message. */
export function firebaseSignInError(error: { code?: string; message?: string }, fallback?: string, language: CrmLanguage = 'ru') {
  const text = COMMON_TEXTS[language].messages;
  switch (error.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return text.popupClosed;
    case 'auth/popup-blocked':
      return text.popupBlocked;
    case 'auth/unauthorized-domain':
      return text.unauthorizedDomain;
    case 'auth/network-request-failed':
      return text.network;
    case 'auth/operation-not-allowed':
      return text.methodDisabled;
    default:
      return error.message || fallback || text.signInFailed;
  }
}
