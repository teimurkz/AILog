import { useLanguage } from '../contexts/LanguageContext';
import { CRM_LOCALES, CrmLanguage, pickTexts, SectionTexts } from '../../shared/i18n';

/** The section's texts in the chosen interface language, with its locale for dates and numbers. */
export function useSectionText<T>(texts: SectionTexts<T>) {
  const { language, isRTL } = useLanguage();
  const lang = (language in texts ? language : 'en') as CrmLanguage;
  return { text: pickTexts(texts, lang), language: lang, isRTL, locale: CRM_LOCALES[lang] };
}
