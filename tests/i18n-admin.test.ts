import test from 'node:test';
import assert from 'node:assert/strict';
import { translationProblems } from '../shared/i18n';
import { SVH_ISSUE_TEXTS } from '../shared/svh-reconcile-i18n';
import { ADMIN_TEXTS } from '../src/components/admin/admin-i18n';
import { ANALYTICS_TEXTS } from '../src/components/analytics/analytics-i18n';
import { DIRECTORIES_TEXTS } from '../src/components/directories/directories-i18n';
import { COMMON_TEXTS, MESSAGE, translateMessage } from '../src/i18n/common-i18n';
import { reportsWorkbook } from '../src/utils/work-reports-excel';

for (const [name, texts] of Object.entries({ SVH_ISSUE_TEXTS, ADMIN_TEXTS, ANALYTICS_TEXTS, DIRECTORIES_TEXTS, COMMON_TEXTS })) {
  test(`${name} is complete in ru, en and fa`, () => assert.deepEqual(translationProblems(texts), []));
}

test('service messages are translated where they are shown', () => {
  assert.equal(translateMessage(MESSAGE.permissionDenied, 'en'), COMMON_TEXTS.en.messages.permissionDenied);
  assert.equal(translateMessage(MESSAGE.loadFailed, 'ru'), MESSAGE.loadFailed);
  assert.equal(translateMessage('custom error', 'fa'), 'custom error');
});

test('report workbook uses translated sheet names and opens right to left for Farsi', () => {
  const table = ANALYTICS_TEXTS.fa.tables.queue;
  const workbook = reportsWorkbook([{ title: table.title, header: table.header, rows: [['351', 'Amol', '01.10.2026', 3]] }], true);
  assert.deepEqual(workbook.SheetNames, [table.title]);
  assert.equal(workbook.Workbook?.Views?.[0]?.RTL, true);
  assert.equal(reportsWorkbook([{ title: 'Reports', header: ['A'], rows: [] }]).Workbook?.Views, undefined);
});
