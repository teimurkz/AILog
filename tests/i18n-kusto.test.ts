import test from 'node:test';
import assert from 'node:assert/strict';
import { translationProblems } from '../shared/i18n';
import { KUSTO_TEXT } from '../src/components/kusto/kusto-i18n';

test('the Kusto expiry stock texts exist in all three languages', () => {
  assert.deepEqual(translationProblems(KUSTO_TEXT), []);
});

test('Kusto Excel sheet names fit Excel limits in every language', () => {
  for (const texts of Object.values(KUSTO_TEXT)) {
    assert.ok(texts.sheetName.length <= 31, texts.sheetName);
    assert.doesNotMatch(texts.sheetName, /[\\/?*[\]:]/);
  }
});
