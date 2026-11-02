import { formatRegionalDay, regionalLocale, regionalTexts } from '../components/regional/regional-i18n';

/**
 * Formats a phone number to standard international digits (e.g. "+7 701 123 4567" -> "77011234567")
 */
export function formatPhoneForWhatsApp(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) {
    return '7' + digits.slice(1);
  }
  return digits;
}

/**
 * Sanitizes Russian/Cyrillic special characters that can break in WhatsApp Web intent URLs (e.g. № -> No.)
 */
export function sanitizeTextForWhatsApp(text: string): string {
  if (!text) return '';
  return text
    .replace(/№/g, 'No. ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a pre-filled, perfectly formatted WhatsApp Web/App link
 */
export function generateWhatsAppLink(phone: string, message: string): string {
  const formattedPhone = formatPhoneForWhatsApp(phone);
  const cleanMessage = sanitizeTextForWhatsApp(message);
  const encodedText = encodeURIComponent(cleanMessage);
  return `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodedText}`;
}

/**
 * Prepares beautiful, clean status notification text for WhatsApp
 */
export function buildWhatsAppStatusMessage(order: {
  orderNumber: string;
  destinationCity: string;
  invoiceNumber: string;
  shipmentDate: string;
  status: string;
  assignedTruckPlate?: string;
  assignedDriver?: string;
  deliveryAddress?: string;
}, language: string = 'ru'): string {
  const text = regionalTexts(language).whatsapp;
  const statusText = text.status[order.status as keyof typeof text.status] || order.status;
  const cleanInvoice = sanitizeTextForWhatsApp(order.invoiceNumber || '');
  const cleanAddress = sanitizeTextForWhatsApp(order.deliveryAddress || '');

  let msg = `🚚 *SILK ROAD LOGISTICS*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *${text.order}:* ${order.orderNumber}\n`;
  msg += `📄 *${text.document}:* ${cleanInvoice}\n`;
  msg += `📍 *${text.route}:* ${text.routeText(order.destinationCity)}\n`;
  if (cleanAddress) {
    msg += `🏢 *${text.address}:* ${cleanAddress}\n`;
  }
  msg += `📅 *${text.shipmentDate}:* ${formatRegionalDay(order.shipmentDate, regionalLocale(language))}\n`;
  msg += `📊 *${text.currentStatus}:* ${statusText}\n`;

  if (order.assignedTruckPlate) {
    msg += `\n🚛 *${text.truck}:* ${order.assignedTruckPlate}`;
  }
  if (order.assignedDriver) {
    msg += `\n👤 *${text.driver}:* ${order.assignedDriver}`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += text.regards;
  return msg;
}
