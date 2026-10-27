import { useLanguage } from '../../contexts/LanguageContext';
import { TRACKING_TEXT, trackingLanguage } from '../../../shared/truck-tracking-i18n';

/** Texts of the "Слежка авто" tab in the language picked in the CRM menu. */
export const useTrackingText = () => {
  const { language, isRTL } = useLanguage();
  const lang = trackingLanguage(language);
  return { text: TRACKING_TEXT[lang], language: lang, isRTL };
};
