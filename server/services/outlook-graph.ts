import type { OutlookSettings } from '../../shared/outlook-import.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
export const outlookScopes = 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access';
export interface GraphMessage {
  id: string; internetMessageId?: string; subject?: string; receivedDateTime: string;
  from?: { emailAddress?: { address?: string } }; isDraft?: boolean; parentFolderId?: string;
}
export interface GraphAttachment {
  id: string; name: string; size: number; contentType?: string; isInline?: boolean;
  '@odata.type': string;
}
export class OutlookError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message); }
}
export function graphUrl(path: string) {
  const url = new URL(path.startsWith('/') ? GRAPH + path : path);
  if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password) {
    throw new OutlookError('invalid_link', 'Microsoft вернул некорректную ссылку.');
  }
  return url.href;
}
// A bounded reader also covers chunked responses without Content-Length.
async function readBytes(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > limit) throw new OutlookError('file_too_large', 'Превышен размер документа для автоматического импорта.');
  const reader = response.body?.getReader();
  if (!reader) throw new OutlookError('empty_response', 'Microsoft вернул пустой ответ.', true);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new OutlookError('file_too_large', 'Превышен размер документа для автоматического импорта.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
export async function microsoftTokenRequest(settings: Pick<OutlookSettings, 'tenantId' | 'clientId'>, endpoint: 'devicecode' | 'token', fields: Record<string, string>, send = fetch): Promise<any> {
  const response = await send(`https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: settings.clientId, ...fields }), signal: AbortSignal.timeout(25000), redirect: 'error',
  });
  const data = JSON.parse((await readBytes(response, 128 * 1024)).toString('utf8'));
  if (response.ok) return data;
  const code = String(data.error || 'microsoft_unavailable');
  const messages: Record<string, string> = {
    authorization_pending: 'Ожидается вход Microsoft.', slow_down: 'Microsoft просит подождать перед повторной проверкой.',
    authorization_declined: 'Вход Microsoft отменён.', expired_token: 'Время входа истекло. Начните подключение заново.',
    invalid_grant: 'Microsoft отозвал доступ. Подключите почту заново.',
    unauthorized_client: 'В Microsoft не разрешён вход по коду для этого приложения. Обратитесь к администратору Microsoft 365.',
    invalid_client: 'Проверьте Tenant ID, Client ID и разрешение public client flows в Microsoft.',
    access_denied: 'Microsoft не разрешил доступ. Возможно, требуется согласование администратора вашей организации.',
  };
  throw new OutlookError(code, messages[code] || 'Microsoft не подтвердил подключение. Проверьте настройки приложения и разрешения.', response.status === 429 || response.status >= 500);
}
export class OutlookGraph {
  constructor(private token: string, private send = fetch) {}
  async response(path: string) {
    const response = await this.send(graphUrl(path), { headers: { Authorization: `Bearer ${this.token}`, Prefer: 'IdType="ImmutableId"' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new OutlookError(`graph_${response.status}`, response.status === 401 || response.status === 403 ?
        'Microsoft не разрешил чтение почты. Проверьте разрешение Mail.Read и переподключите Outlook.' :
        response.status === 404 ? 'Письмо или вложение больше не доступно в Outlook.' : 'Microsoft временно не отвечает. Проверка будет повторена.',
        response.status === 429 || response.status >= 500);
    }
    return response;
  }
  async json<T>(path: string): Promise<T> { return JSON.parse((await readBytes(await this.response(path), 2 * 1024 * 1024)).toString('utf8')); }
  async bytes(path: string, limit = 25 * 1024 * 1024) { return readBytes(await this.response(path), limit); }
  profile() { return this.json<{ id: string; mail?: string; userPrincipalName?: string }>('/me?$select=id,mail,userPrincipalName'); }
  messages(from: string, to: string, sender: string, nextLink?: string) {
    const query = new URLSearchParams({ '$select': 'id,internetMessageId,subject,receivedDateTime,from,isDraft,parentFolderId',
      '$filter': `receivedDateTime ge ${from} and receivedDateTime le ${to} and from/emailAddress/address eq '${sender.replace(/'/g, "''")}'`,
      '$orderby': 'receivedDateTime asc', '$top': '10' });
    return this.json<{ value: GraphMessage[]; '@odata.nextLink'?: string }>(nextLink || `/me/messages?${query}`);
  }
  async excludedFolders() {
    const folders = await Promise.all(['deleteditems', 'junkemail'].map(name => this.json<{ id: string; childFolderCount: number }>(`/me/mailFolders/${name}?$select=id,childFolderCount`)));
    for (let index = 0; index < folders.length; index++) {
      if (!folders[index].childFolderCount) continue;
      let url: string | undefined = `/me/mailFolders/${encodeURIComponent(folders[index].id)}/childFolders?$select=id,childFolderCount&$top=100`;
      while (url) {
        const page = await this.json<{ value: { id: string; childFolderCount: number }[]; '@odata.nextLink'?: string }>(url);
        folders.push(...page.value);
        if (folders.length > 200) throw new OutlookError('folder_limit', 'Слишком много вложенных папок в удалённых письмах. Требуется проверка структуры почты.');
        url = page['@odata.nextLink'];
      }
    }
    return folders.map(folder => folder.id);
  }
  async attachments(messageId: string) {
    let url: string | undefined = `/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,size,contentType,isInline&$top=50`;
    const attachments: GraphAttachment[] = [];
    while (url) {
      const page = await this.json<{ value: GraphAttachment[]; '@odata.nextLink'?: string }>(url);
      attachments.push(...page.value);
      if (attachments.length > 100) throw new OutlookError('too_many_files', 'В письме больше 100 вложений. Нужна ручная проверка.');
      url = page['@odata.nextLink'];
    }
    return attachments;
  }
  attachment(messageId: string, attachmentId: string) { return this.bytes(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`); }
  original(messageId: string) { return this.bytes(`/me/messages/${encodeURIComponent(messageId)}/$value`, 64 * 1024 * 1024); }
}
