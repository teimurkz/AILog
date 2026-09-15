import { simpleParser } from 'mailparser';
import { emailKey } from '../../shared/outlook-import.js';
import type { OutlookGraph, GraphMessage } from './outlook-graph.js';

export class MailIngressError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type MailSource = Pick<OutlookGraph, 'attachments' | 'attachment' | 'original'>;
export const maxMailBytes = 25 * 1024 * 1024;

export async function readPowerAutomateMail(bytes: Buffer, receivedAt: string, sender: string, now: number) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxMailBytes) {
    throw new MailIngressError(413, 'Передайте исходное письмо EML размером до 25 МБ.');
  }
  const receivedTime = Date.parse(receivedAt);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(receivedAt) || !Number.isFinite(receivedTime) || receivedTime > now + 300000) {
    throw new MailIngressError(400, 'В X-CRM-Received-At нужна дата получения письма с часовым поясом.');
  }
  // Work on raw MIME bytes only. No links, scripts, formulas or HTML are opened.
  let mail: Awaited<ReturnType<typeof simpleParser>>;
  try { mail = await simpleParser(bytes, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true, skipTextLinks: true }); }
  catch { throw new MailIngressError(422, 'Не удалось прочитать EML. В HTTP Body выберите Body действия Export email (V2).'); }
  if (mail.from?.value.length !== 1 || emailKey(mail.from.value[0].address || '') !== sender) {
    throw new MailIngressError(422, 'Отправитель исходного письма не совпадает с настройкой CRM.');
  }
  if (!mail.messageId || mail.messageId.length > 1000 || /[\r\n]/.test(mail.messageId)) {
    throw new MailIngressError(422, 'В письме отсутствует корректный Message-ID. Передайте оригинал через Export email (V2).');
  }
  if (!mail.attachments.length) throw new MailIngressError(503, 'В письме пока нет вложений. Повторите передачу после их появления в Outlook.');
  if (mail.attachments.length > 100) throw new MailIngressError(422, 'В письме больше 100 вложений. Нужна ручная проверка.');
  const message: GraphMessage = { id: mail.messageId, internetMessageId: mail.messageId,
    receivedDateTime: new Date(receivedTime).toISOString(), subject: mail.subject || '(Без темы)', from: { emailAddress: { address: sender } } };
  const source: MailSource = {
    attachments: async () => mail.attachments.map((file, index) => ({ id: String(index), name: file.filename || 'attachment', size: file.content.length,
      contentType: file.contentType, isInline: file.contentDisposition === 'inline' || file.related === true,
      '@odata.type': file.contentType === 'message/rfc822' ? '#microsoft.graph.itemAttachment' : '#microsoft.graph.fileAttachment' })),
    attachment: async (_messageId, id) => mail.attachments[Number(id)].content,
    original: async () => bytes,
  };
  return { message, source };
}
