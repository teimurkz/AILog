import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTexts, translationProblems } from '../shared/i18n';
import { translations } from '../src/i18n/translations';

test('dictionary check finds missing keys, empty texts and Russian left in translations', () => {
  const ru = { title: 'Сверка', count: (n: number) => `Всего: ${n}`, nested: { ok: 'Да' } };
  const good = {
    ru,
    en: { title: 'Reconciliation', count: (n: number) => `Total: ${n}`, nested: { ok: 'Yes' } },
    fa: { title: 'تطبیق', count: (n: number) => `مجموع: ${n}`, nested: { ok: 'بله' } },
  };
  assert.deepEqual(translationProblems(good), []);
  const bad = {
    ru,
    en: { title: '', count: (n: number) => `Всего: ${n}`, nested: { ok: 'Yes' }, extra: 'x' },
    fa: { title: 'تطبیق', count: (n: number) => `مجموع: ${n}`, nested: {} },
  } as any;
  assert.deepEqual(translationProblems(bad), [
    'en.title: empty', 'en.count(): Russian text "Всего: 2"', 'en.extra: extra', 'fa.nested.ok: missing',
  ]);
  assert.equal(pickTexts(good, 'de').title, 'Reconciliation');
});

test('the main menu and shared texts exist in all three languages', () => {
  const { en, ru, fa } = translations as any;
  const missing = (dict: any) => Object.keys(en).filter(key => !dict[key]);
  assert.deepEqual(missing(ru), []);
  assert.deepEqual(missing(fa), []);
  const cyrillicInFa = Object.entries(fa).filter(([, value]) => /[Ѐ-ӿ]/.test(String(value)));
  assert.deepEqual(cyrillicInFa, []);
});
