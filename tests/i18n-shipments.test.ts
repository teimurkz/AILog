import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CRM_LOCALES, translationProblems } from '../shared/i18n';
import { SHIPMENTS_TEXT, shipmentDay, shipmentDateTime } from '../src/components/shipments/shipments-i18n';

const SECTION_FILES = [
  'src/components/shipments/OutlookImport.tsx',
  'src/components/shipments/PowerAutomateImport.tsx',
  'src/components/shipments/ShipmentList.tsx',
  'src/components/shipments/ShipmentDetails.tsx',
  'src/components/shipments/NewShipmentModal.tsx',
  'src/components/admin/ExcelImport.tsx',
];

test('the shipments dictionaries have the same texts in Russian, English and Farsi', () => {
  assert.deepEqual(translationProblems(SHIPMENTS_TEXT), []);
});

test('Excel export column names are distinct in every language', () => {
  for (const language of ['ru', 'en', 'fa'] as const) {
    const names = Object.values(SHIPMENTS_TEXT[language].list.exportColumns);
    assert.equal(new Set(names).size, names.length, language);
  }
});

test('dates use the language locale, with Persian digits and the Gregorian calendar for Farsi', () => {
  const moment = '2026-07-31T10:00:00Z';
  assert.equal(shipmentDay(moment, CRM_LOCALES.ru), '31.07.2026');
  assert.equal(shipmentDay(moment, CRM_LOCALES.fa), '۲۰۲۶/۰۷/۳۱');
  assert.match(shipmentDateTime(moment, CRM_LOCALES.en, 'Asia/Almaty'), /31\/07\/2026.*15:00/);
});

test('section components keep no hardcoded Russian interface text', () => {
  // Russian that stays on purpose: Excel header and status matching, stored log values and code comments.
  const allowed = [/getColIdx\(/, /^\s*\/\//, /statusParts\.push/, /'Логист'/, /cleanStr\.replace/, /^\s*'[^']+': '(In Transit|Customs|Delivered|Delay)',?$/,
    /str\?\.includes\('инвойс'\)/, /[а-я]+: \d+,/, /textDateRegex/, /^\s*мая: 4/];
  for (const file of SECTION_FILES) {
    const leftovers = readFileSync(file, 'utf8').split(/\r?\n/)
      .filter(line => /[Ѐ-ӿ]/.test(line) && !allowed.some(rule => rule.test(line)));
    assert.deepEqual(leftovers, [], file);
  }
});
