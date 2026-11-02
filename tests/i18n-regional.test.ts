import test from 'node:test';
import assert from 'node:assert/strict';
import { translationProblems } from '../shared/i18n';
import { REGIONAL_TEXT, formatRegionalDay, localizeGpsText } from '../src/components/regional/regional-i18n';
import { buildWhatsAppStatusMessage } from '../src/utils/whatsapp';

test('regional orders texts are complete in Russian, English and Farsi', () => {
  assert.deepEqual(translationProblems(REGIONAL_TEXT), []);
});

test('Russian GPS server texts are shown in the interface language', () => {
  assert.equal(localizeGpsText('Груз доставлен', 'en'), 'Cargo delivered');
  assert.equal(localizeGpsText('🟢 В движении (64 км/ч)', 'en'), '🟢 Moving (64 km/h)');
  assert.equal(localizeGpsText('~2 ч 5 мин (при 70 км/ч)', 'en'), '~2 h 5 min (at 70 km/h)');
  assert.equal(localizeGpsText('🔴 Нет сигнала (12 мин. назад)', 'fa'), '🔴 بدون سیگنال (۱۲ دقیقه پیش)');
  assert.equal(localizeGpsText('Груз доставлен', 'ru'), 'Груз доставлен');
  assert.equal(localizeGpsText('unknown text', 'fa'), 'unknown text');
});

test('stored days follow the locale and keep the Gregorian calendar in Farsi', () => {
  assert.equal(formatRegionalDay('2026-09-15', 'ru-RU'), '15.09.2026');
  assert.equal(formatRegionalDay('2026-09-15', 'en-GB'), '15/09/2026');
  assert.equal(formatRegionalDay('2026-09-15', 'fa-IR-u-ca-gregory'), '۲۰۲۶/۰۹/۱۵');
  assert.equal(formatRegionalDay('завтра', 'en-GB'), 'завтра');
});

test('WhatsApp status message follows the language and keeps data values', () => {
  const order = { orderNumber: 'REG-1', destinationCity: 'Астана', invoiceNumber: 'INV-7', shipmentDate: '2026-09-15', status: 'dispatched' };
  assert.match(buildWhatsAppStatusMessage(order), /Маршрут:\* г\. Алматы ➔ г\. Астана/);
  const english = buildWhatsAppStatusMessage(order, 'en');
  assert.match(english, /Route:\* Almaty ➔ Астана/);
  assert.match(english, /On the way to the regional warehouse/);
  assert.doesNotMatch(buildWhatsAppStatusMessage(order, 'fa'), /Заявка|Маршрут/);
});
