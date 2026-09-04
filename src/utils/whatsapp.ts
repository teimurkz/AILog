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
}): string {
  const statusLabels: Record<string, string> = {
    new: '🆕 Принята в обработку',
    assigned: '🚛 Назначена машина',
    loading: '📦 На погрузке СВХ',
    dispatched: '🚚 В пути на региональный склад',
    delivered: '✅ Выгружено / Доставлено',
    cancelled: '❌ Отменено'
  };

  const statusText = statusLabels[order.status] || order.status;
  const cleanInvoice = sanitizeTextForWhatsApp(order.invoiceNumber || '');
  const cleanAddress = sanitizeTextForWhatsApp(order.deliveryAddress || '');

  let msg = `🚚 *SILK ROAD LOGISTICS*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *Заявка:* ${order.orderNumber}\n`;
  msg += `📄 *Документ:* ${cleanInvoice}\n`;
  msg += `📍 *Маршрут:* г. Алматы ➔ г. ${order.destinationCity}\n`;
  if (cleanAddress) {
    msg += `🏢 *Адрес выгрузки:* ${cleanAddress}\n`;
  }
  msg += `📅 *Дата отгрузки:* ${order.shipmentDate}\n`;
  msg += `📊 *Текущий статус:* ${statusText}\n`;

  if (order.assignedTruckPlate) {
    msg += `\n🚛 *Назначено авто:* ${order.assignedTruckPlate}`;
  }
  if (order.assignedDriver) {
    msg += `\n👤 *Водитель:* ${order.assignedDriver}`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `С уважением,\nСлужба логистики Silk Road`;
  return msg;
}
