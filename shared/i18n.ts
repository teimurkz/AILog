// Texts of one CRM section in the three languages. Each section keeps its own dictionary
// (for example shared/truck-tracking-i18n.ts) so sections can be translated independently.
// Use the Russian dictionary as the type: `const en: typeof ru = {...}`.

export type CrmLanguage = 'ru' | 'en' | 'fa';
export const CRM_LANGUAGES: CrmLanguage[] = ['ru', 'en', 'fa'];
export type SectionTexts<T> = Record<CrmLanguage, T>;

// Persian numbers and names, but the Gregorian calendar the partners' documents use.
export const CRM_LOCALES: Record<CrmLanguage, string> = { ru: 'ru-RU', en: 'en-GB', fa: 'fa-IR-u-ca-gregory' };

export function pickTexts<T>(texts: SectionTexts<T>, language: string): T {
  return texts[language as CrmLanguage] ?? texts.en;
}

const CYRILLIC = /[Ѐ-ӿ]/;
const PERSIAN = /[؀-ۿ]/;

/** Problems of a dictionary set: missing or extra keys, empty texts and Russian left in en/fa. */
export function translationProblems(texts: SectionTexts<object>): string[] {
  const problems: string[] = [];
  const walk = (language: CrmLanguage, base: any, value: any, path: string) => {
    if (typeof base === 'function') {
      if (typeof value !== 'function') { problems.push(`${language}.${path}: not a function`); return; }
      // Call with sample arguments to check the produced text too.
      const sample = Array.from({ length: base.length }, () => 2);
      walk(language, base(...sample), value(...sample), `${path}()`);
      return;
    }
    if (base && typeof base === 'object') {
      if (!value || typeof value !== 'object') { problems.push(`${language}.${path}: missing`); return; }
      for (const key of Object.keys(base)) walk(language, base[key], value[key], path ? `${path}.${key}` : key);
      for (const key of Object.keys(value)) if (!(key in base)) problems.push(`${language}.${path ? `${path}.` : ''}${key}: extra`);
      return;
    }
    if (typeof base !== 'string') return;
    if (typeof value !== 'string') { problems.push(`${language}.${path}: missing`); return; }
    if (base.trim() && !value.trim()) problems.push(`${language}.${path}: empty`);
    if (language !== 'ru' && CYRILLIC.test(value)) problems.push(`${language}.${path}: Russian text "${value}"`);
    if (language === 'en' && PERSIAN.test(value)) problems.push(`${language}.${path}: Persian text "${value}"`);
  };
  for (const language of CRM_LANGUAGES) walk(language, texts.ru, texts[language], '');
  return problems;
}
