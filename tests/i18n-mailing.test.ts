import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translationProblems } from '../shared/i18n';
import { normalizeMailingDiagnostics } from '../shared/mailing-diagnostics';
import { MAILING_TEXT } from '../src/components/warehouses/mailing-i18n';
import { MailingDiagnosticsPanel } from '../src/components/warehouses/MailingDiagnosticsPanel';

test('mailing section texts are complete in Russian, English and Farsi', () => {
  assert.deepEqual(translationProblems(MAILING_TEXT), []);
});

test('every stored department and time zone has a label in each language', () => {
  for (const language of ['en', 'fa'] as const) {
    assert.deepEqual(Object.keys(MAILING_TEXT[language].departments), Object.keys(MAILING_TEXT.ru.departments));
    assert.deepEqual(Object.keys(MAILING_TEXT[language].timezones), Object.keys(MAILING_TEXT.ru.timezones));
  }
});

test('diagnostics panel follows the chosen language and stays Russian by default', () => {
  const diagnostics = normalizeMailingDiagnostics({ enabled: true, scheduleType: 'daily', targetSendTime: '09:00', smtpConfigured: true, schedulerHealthy: true, statusMessage: 'ok' });
  const render = (language?: 'ru' | 'en' | 'fa') => renderToStaticMarkup(React.createElement(MailingDiagnosticsPanel, { diagnostics, onClose: () => {}, language }));
  assert.match(render(), /Результаты диагностики/);
  const en = render('en');
  assert.match(en, /Mailing service diagnostics/);
  assert.doesNotMatch(en, /[Ѐ-ӿ]/);
  const fa = render('fa');
  assert.match(fa, /عیب‌یابی سرویس ارسال/);
  assert.doesNotMatch(fa, /[Ѐ-ӿ]/);
});
