import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { emailKey, invoiceKey, validateOutlookSettings, validateMailImportSettings, type PowerAutomateStatus, type MailDocument, type OutlookSettings, type OutlookStatus, type OutlookLogin, type OutlookImportLog } from '../../shared/outlook-import.js';
import { OutlookGraph, OutlookError, microsoftTokenRequest, outlookScopes, type GraphMessage } from './outlook-graph.js';
import { ImportReview, invoiceName, parseInvoiceWorkbook, mergeMailShipment } from './outlook-invoice.js';
import type { Shipment } from '../../src/types/index.js';
import { MailIngressError, readPowerAutomateMail, type MailSource } from './power-automate-mail.js';

const hash = (text: string | Buffer) => crypto.createHash('sha256').update(text).digest('hex');
const random = () => crypto.randomUUID();
const emptySettings = (): OutlookSettings => ({ tenantId: '', clientId: '', mailbox: '', sender: '',
  importFrom: new Date().toISOString(), travelDays: 12, enabled: false });
const safeError = (error: unknown) => error instanceof OutlookError || error instanceof ImportReview ? error.message :
  'Не удалось завершить импорт. Проверьте доступ Firebase к базе и хранилищу, затем повторите проверку.';
type State = { settings?: OutlookSettings; connectionId?: string; connectedMailbox?: string; ownerUid?: string;
  authVersion?: string;
  leaseOwner?: string; leaseUntil?: number; lastHeartbeat?: string; lastSuccess?: string; lastError?: string | null;
  nextLink?: string | null; windowEnd?: string; watermark?: string };
interface Dependencies {
  db: Firestore;
  saveFile: (path: string, bytes: Buffer, name: string, type: string) => Promise<string>;
  graph?: (token: string) => OutlookGraph;
  oauth?: typeof microsoftTokenRequest;
  now?: () => number;
}
export function createOutlookImportService(deps: Dependencies) {
  const { db } = deps, graph = deps.graph || (token => new OutlookGraph(token)), oauth = deps.oauth || microsoftTokenRequest;
  const now = deps.now || Date.now, iso = () => new Date(now()).toISOString();
  const stateRef = db.collection('outlook_private').doc('state');
  const credentialsRef = db.collection('outlook_private').doc('credentials');
  const powerRef = db.collection('outlook_private').doc('powerAutomate');
  const flows = db.collection('outlook_private').doc('flows').collection('sessions');
  const ledger = db.collection('outlook_imports');
  const ensureIdle = (state: State) => { if ((state.leaseUntil || 0) > now()) throw new ImportReview('Проверка писем уже выполняется. Дождитесь её завершения.'); };

  async function status(): Promise<OutlookStatus> {
    const [stateSnap, recent] = await Promise.all([stateRef.get(), ledger.orderBy('checkedAt', 'desc').limit(20).get()]);
    const state = (stateSnap.data() || {}) as State;
    return { settings: state.settings || emptySettings(), connected: Boolean(state.connectionId),
      connectedMailbox: state.connectedMailbox || null, lastHeartbeat: state.lastHeartbeat || null,
      lastSuccess: state.lastSuccess || null, lastError: state.lastError || null, busy: (state.leaseUntil || 0) > now(),
      logs: recent.docs.map(doc => { const item = doc.data(); return {
        id: doc.id, subject: item.subject, receivedAt: item.receivedAt, checkedAt: item.checkedAt, status: item.status,
        ...(item.invoice ? { invoice: item.invoice } : {}), ...(item.shipmentId ? { shipmentId: item.shipmentId } : {}),
        ...(item.documents !== undefined ? { documents: item.documents } : {}), ...(item.reason ? { reason: item.reason } : {}),
      } as OutlookImportLog; }) };
  }
  async function saveSettings(input: unknown) {
    const settings = validateOutlookSettings(input);
    await db.runTransaction(async tx => {
      const state = ((await tx.get(stateRef)).data() || {}) as State;
      ensureIdle(state);
      if (state.connectionId && ['tenantId', 'clientId', 'mailbox'].some(key => state.settings?.[key] !== settings[key])) {
        throw new ImportReview('Сначала отключите текущую почту, затем измените параметры подключения.');
      }
      if (settings.enabled && !state.connectionId) throw new ImportReview('Сначала подключите почту Microsoft.');
      const changed = state.settings?.sender !== settings.sender || state.settings?.importFrom !== settings.importFrom;
      tx.set(stateRef, { ...state, settings, authVersion: random(), ...(changed ? { nextLink: null, watermark: settings.importFrom, windowEnd: settings.importFrom } : {}) });
    });
  }
  async function beginLogin(uid: string): Promise<OutlookLogin> {
    const state = ((await stateRef.get()).data() || {}) as State;
    ensureIdle(state);
    const settings = validateOutlookSettings(state.settings);
    if (state.connectionId) throw new ImportReview('Почта уже подключена.');
    const data = await oauth(settings, 'devicecode', { scope: outlookScopes });
    if (!data.device_code || !data.user_code || !Number.isFinite(data.expires_in)) throw new ImportReview('Microsoft не вернул код подключения.');
    const flowId = random(), interval = Math.max(5, Number(data.interval) || 5), expiresAt = new Date(now() + data.expires_in * 1000).toISOString();
    // Only the harmless user code leaves the server; device_code and refresh
    // tokens stay in a collection denied to every Firestore client.
    await flows.doc(flowId).set({ uid, settings, authVersion: state.authVersion || '', deviceCode: data.device_code, expiresAt,
      interval, nextPollAt: now() + interval * 1000, createdAt: iso() });
    return { flowId, userCode: data.user_code, verificationUri: 'https://microsoft.com/devicelogin', expiresAt, interval };
  }
  async function pollLogin(uid: string, flowId: string) {
    if (!/^[\w-]{36}$/.test(flowId)) throw new ImportReview('Не найдена попытка подключения.');
    const ref = flows.doc(flowId);
    const flow = await db.runTransaction(async tx => {
      const snap = await tx.get(ref), saved = snap.data();
      if (!saved || saved.uid !== uid || Date.parse(saved.expiresAt) <= now()) throw new ImportReview('Время подключения истекло. Начните вход заново.');
      if (saved.nextPollAt > now()) return null;
      tx.update(ref, { nextPollAt: now() + Math.max(saved.interval * 1000, 90000) });
      return saved;
    });
    if (!flow) return { state: 'pending' as const };
    try {
      const tokens = await oauth(flow.settings, 'token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: flow.deviceCode });
      if (!tokens.refresh_token || !tokens.access_token) throw new ImportReview('Microsoft не разрешил фоновое чтение почты. Проверьте offline_access.');
      const identity = await graph(tokens.access_token).profile();
      if (!identity.id || ![identity.mail, identity.userPrincipalName].some(mail => mail && emailKey(mail) === flow.settings.mailbox)) {
        throw new ImportReview('Вы вошли в другую почту Microsoft. Подключите указанный рабочий адрес.');
      }
      await db.runTransaction(async tx => {
        const state = ((await tx.get(stateRef)).data() || {}) as State;
        ensureIdle(state);
        const changed = Object.entries(validateOutlookSettings(state.settings)).some(([key, value]) => value !== flow.settings[key]);
        if (state.connectionId || (state.authVersion || '') !== flow.authVersion || changed) throw new ImportReview('Настройки подключения изменились. Начните вход заново.');
        const connectionId = random();
        tx.set(credentialsRef, { refreshToken: tokens.refresh_token, connectionId, mailboxId: identity.id });
        tx.set(stateRef, { ...state, settings: { ...flow.settings, enabled: false }, connectionId,
          connectedMailbox: flow.settings.mailbox, ownerUid: uid, nextLink: null,
          watermark: flow.settings.importFrom, lastError: null, lastSuccess: null });
        tx.delete(ref);
      });
      return { state: 'connected' as const };
    } catch (error) {
      if (error instanceof OutlookError && ['authorization_pending', 'slow_down'].includes(error.code)) {
        const interval = flow.interval + (error.code === 'slow_down' ? 5 : 0);
        await ref.update({ interval, nextPollAt: now() + interval * 1000 });
        return { state: 'pending' as const };
      }
      await ref.delete();
      throw error;
    }
  }
  async function disconnect() {
    await db.runTransaction(async tx => {
      const state = ((await tx.get(stateRef)).data() || {}) as State;
      ensureIdle(state);
      tx.set(stateRef, { ...state, settings: { ...(state.settings || emptySettings()), enabled: false },
        connectionId: null, connectedMailbox: null, nextLink: null, lastError: null, authVersion: random() });
      tx.delete(credentialsRef);
    });
  }
  async function importMessage(client: MailSource, state: State, message: GraphMessage, leaseOwner: string, retryReview = false) {
    const settings = state.settings!, receivedAt = new Date(message.receivedDateTime).toISOString();
    if (emailKey(message.from?.emailAddress?.address || '') !== settings.sender || message.isDraft || Date.parse(receivedAt) < Date.parse(settings.importFrom)) return;
    const messageId = hash(settings.mailbox + '\0' + (message.internetMessageId || message.id)), record = ledger.doc(messageId);
    const previous = await record.get();
    if (previous.exists && !(retryReview && previous.data()?.status === 'review')) return previous.data();
    let name: string | undefined;
    const base = { subject: (message.subject || '(Без темы)').slice(0, 500), receivedAt, checkedAt: iso(),
      graphMessageId: message.id, mailbox: settings.mailbox };
    try {
      const attachments = (await client.attachments(message.id)).filter(item => !item.isInline);
      if (!attachments.length) return;
      const invoices = attachments.filter(item => /\.(xlsx|xls)$/i.test(item.name));
      if (invoices.length !== 1) throw new ImportReview(invoices.length ? 'В письме несколько Excel-файлов. Нужна проверка принадлежности документов.' : 'В письме нет Excel с номером инвойса.');
      name = invoiceName(invoices[0].name);
      if (attachments.some(item => item['@odata.type'] !== '#microsoft.graph.fileAttachment')) throw new ImportReview('Письмо содержит ссылку или вложенное письмо вместо обычного файла. Нужна проверка документов.');
      if (attachments.some(item => item.size > 25 * 1024 * 1024) || attachments.reduce((sum, item) => sum + item.size, 0) > 40 * 1024 * 1024) throw new ImportReview('Пакет документов превышает лимит импорта: 25 МБ на файл, 40 МБ на письмо.');
      const excel = await client.attachment(message.id, invoices[0].id);
      const draft = await parseInvoiceWorkbook(excel, invoices[0].name);
      const key = hash(settings.mailbox + '\0' + invoiceKey(name)), indexRef = db.collection('outlook_invoice_index').doc(key);
      // Legacy shipments have no import index. Match their existing invoice names
      // without changing IDs or replacing collections.
      const existingIndex = await indexRef.get();
      let shipmentId = existingIndex.data()?.shipmentId as string | undefined;
      if (!shipmentId) {
        const legacy = (await db.collection('shipments').get()).docs.filter(doc => invoiceKey(String(doc.data().invoice_id || '')) === invoiceKey(name!));
        if (legacy.length > 1) throw new ImportReview('В CRM уже несколько отправлений с этим инвойсом. Нужно выбрать правильное вручную.');
        shipmentId = legacy[0]?.id || 'mail-' + key;
      }
      const documents: MailDocument[] = [];
      let size = 0;
      for (const attachment of attachments) {
        const bytes = attachment.id === invoices[0].id ? excel : await client.attachment(message.id, attachment.id);
        size += bytes.length;
        if (size > 40 * 1024 * 1024) throw new ImportReview('Пакет документов превышает 40 МБ.');
        const sha256 = hash(bytes), type = attachment.contentType || 'application/octet-stream';
        const url = await deps.saveFile(`mail-documents/${key}/${sha256}`, bytes, attachment.name, type);
        documents.push({ id: sha256, sha256, fileName: attachment.name.slice(0, 250), size: bytes.length, contentType: type, url, receivedAt });
      }
      const original = await client.original(message.id);
      const sourceUrl = await deps.saveFile(`mail-documents/${key}/email-${messageId}`, original, `${name}.eml`, 'message/rfc822');
      const shipmentRef = db.collection('shipments').doc(shipmentId);
      await db.runTransaction(async tx => {
        const [control, done, index, existing] = await Promise.all([tx.get(stateRef), tx.get(record), tx.get(indexRef), tx.get(shipmentRef)]);
        const current = control.data() as State;
        if (current.connectionId !== state.connectionId || current.leaseOwner !== leaseOwner || current.leaseUntil! <= now()) throw new ImportReview('Сеанс импорта изменился. Повторите проверку.');
        if (done.exists && !(retryReview && done.data()?.status === 'review')) return;
        if (index.exists && index.data()?.shipmentId !== shipmentId) throw new ImportReview('Инвойс уже связан с другим отправлением.');
        if (index.data()?.fullInvoice && index.data()?.fullInvoice !== draft.commercial_invoice_number) throw new ImportReview('Короткое имя инвойса уже связано с другим полным номером инвойса.');
        const old = existing.exists ? existing.data() as Shipment : undefined;
        if (old && invoiceKey(old.invoice_id) !== invoiceKey(name!)) throw new ImportReview('Название существующего отправления изменено. Нужна ручная проверка.');
        if (old?.commercial_invoice_number && old.commercial_invoice_number !== draft.commercial_invoice_number) throw new ImportReview('Короткое имя инвойса совпало, но полный номер отличается. Нужна проверка.');
        const patch = mergeMailShipment(old, draft, documents, receivedAt, sourceUrl, settings.travelDays, state.ownerUid!, iso());
        if ((patch.mail_documents?.length || 0) > 200 || (patch.source_email_urls?.length || 0) > 100) throw new ImportReview('У отправления слишком много версий документов. Нужна ручная проверка.');
        tx.set(shipmentRef, { ...patch, id: shipmentId }, { merge: true });
        tx.set(indexRef, { shipmentId, invoice: name, fullInvoice: draft.commercial_invoice_number });
        tx.set(record, { ...base, status: old ? 'updated' : 'created', invoice: name, shipmentId, documents: documents.length });
        tx.create(shipmentRef.collection('logs').doc(messageId), { timestamp: iso(), shipmentId,
          location: 'Outlook', message: `Получены документы к ${name}: ${documents.length} файлов. Дата письма: ${receivedAt}.`, updatedBy: 'Импорт из Outlook' });
      });
    } catch (error) {
      if (!(error instanceof ImportReview) && !(error instanceof OutlookError && !error.retryable)) throw error;
      // Auth errors are global connection failures, not failures of this email.
      if (error instanceof OutlookError && ['graph_401', 'graph_403'].includes(error.code)) throw error;
      await record.set({ ...base, status: 'review', ...(name ? { invoice: name } : {}), reason: safeError(error) });
    }
    return (await record.get()).data();
  }
  async function powerStatus(): Promise<PowerAutomateStatus> {
    const saved = (await powerRef.get()).data() || {};
    const { mailbox, sender, importFrom, travelDays, enabled } = saved.settings || emptySettings();
    return { settings: { mailbox, sender, importFrom, travelDays, enabled }, configured: Boolean(saved.keyHash),
      lastReceived: saved.lastReceived || null, lastError: saved.lastError || null };
  }
  async function savePowerSettings(input: unknown, uid: string, rotate = false) {
    const settings = validateMailImportSettings(input), key = rotate ? crypto.randomBytes(32).toString('hex') : undefined;
    await db.runTransaction(async tx => {
      const [control, saved] = await Promise.all([tx.get(stateRef), tx.get(powerRef)]);
      ensureIdle((control.data() || {}) as State);
      if (settings.enabled && !saved.data()?.keyHash && !key) throw new MailIngressError(400, 'Сначала создайте ключ подключения.');
      tx.set(powerRef, { settings, ownerUid: uid, ...(key ? { keyHash: hash(key) } : {}) }, { merge: true });
    });
    // The secret is returned once to the verified admin; only its hash is stored.
    return key ? { key } : { saved: true };
  }
  function checkPowerKey(saved: any, key: string) {
    if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(saved?.keyHash || '') ||
      !crypto.timingSafeEqual(Buffer.from(hash(key), 'hex'), Buffer.from(saved.keyHash, 'hex'))) {
      throw new MailIngressError(401, 'Неверный ключ Power Automate.');
    }
    if (!saved.settings?.enabled) throw new MailIngressError(403, 'Приём писем Power Automate выключен в CRM.');
  }
  async function authorizePower(key: string) { checkPowerKey((await powerRef.get()).data(), key); }
  async function receivePower(key: string, bytes: Buffer, receivedAt: string) {
    const leaseOwner = random();
    const context = await db.runTransaction(async tx => {
      const [control, power] = await Promise.all([tx.get(stateRef), tx.get(powerRef)]);
      const state = (control.data() || {}) as State, saved = power.data();
      checkPowerKey(saved, key);
      if ((state.leaseUntil || 0) > now()) throw new MailIngressError(429, 'Другой импорт ещё выполняется. Повторите передачу через минуту.');
      tx.set(stateRef, { leaseOwner, leaseUntil: now() + 360000 }, { merge: true });
      return { ...state, settings: { tenantId: '', clientId: '', ...saved!.settings }, ownerUid: saved!.ownerUid } as State;
    });
    try {
      const { message, source } = await readPowerAutomateMail(bytes, receivedAt, context.settings!.sender, now());
      if (Date.parse(message.receivedDateTime) < Date.parse(context.settings!.importFrom)) {
        throw new MailIngressError(422, 'Дата письма раньше выбранного периода импорта в CRM.');
      }
      const result = await importMessage(source, context, message, leaseOwner, true);
      if (!result) throw new MailIngressError(422, 'В письме нет документов для создания отправления.');
      if (result.status === 'review') throw new MailIngressError(422, result.reason);
      await powerRef.update({ lastReceived: iso(), lastError: null });
      return { status: result.status, shipmentId: result.shipmentId, invoice: result.invoice, documents: result.documents };
    } catch (error) {
      const detail = error instanceof MailIngressError ? error.message : safeError(error);
      await powerRef.update({ lastError: detail });
      if (error instanceof MailIngressError) throw error;
      throw new MailIngressError(503, detail);
    } finally {
      await db.runTransaction(async tx => {
        const saved = (await tx.get(stateRef)).data();
        if (saved?.leaseOwner === leaseOwner) tx.update(stateRef, { leaseOwner: '', leaseUntil: 0 });
      });
    }
  }
  async function run(manual = false) {
    const leaseOwner = random();
    const state = await db.runTransaction(async tx => {
      const saved = ((await tx.get(stateRef)).data() || {}) as State;
      if (!manual) tx.set(stateRef, { lastHeartbeat: iso() }, { merge: true });
      if (!saved.connectionId || !saved.settings || (!manual && !saved.settings.enabled)) return null;
      if ((saved.leaseUntil || 0) > now()) return null;
      tx.set(stateRef, { leaseOwner, leaseUntil: now() + 6 * 60 * 1000 }, { merge: true });
      return saved;
    });
    if (!state) return { state: 'idle' };
    try {
      const credentials = (await credentialsRef.get()).data();
      if (!credentials?.refreshToken || credentials.connectionId !== state.connectionId) throw new ImportReview('Подключите почту Microsoft заново.');
      const tokens = await oauth(state.settings!, 'token', { grant_type: 'refresh_token', refresh_token: credentials.refreshToken, scope: outlookScopes });
      if (!tokens.access_token) throw new ImportReview('Microsoft не вернул доступ к почте.');
      if (tokens.refresh_token) await credentialsRef.update({ refreshToken: tokens.refresh_token });
      const client = graph(tokens.access_token), excluded = await client.excludedFolders();
      const lower = new Date(Math.max(Date.parse(state.settings!.importFrom), Date.parse(state.watermark || state.settings!.importFrom) - 86400000)).toISOString();
      const upper = state.nextLink && state.windowEnd ? state.windowEnd : iso();
      const page = await client.messages(lower, upper, state.settings!.sender, state.nextLink || undefined);
      const started = now();
      for (const message of page.value) {
        // A timed-out page is safely replayed using the durable email ledger.
        if (now() - started > 210000) return { state: 'continuing' };
        if (excluded.includes(message.parentFolderId || '')) continue;
        await importMessage(client, state, message, leaseOwner);
      }
      await stateRef.update({ nextLink: page['@odata.nextLink'] || null, windowEnd: upper,
        ...(page['@odata.nextLink'] ? {} : { watermark: upper }), lastSuccess: iso(), lastError: null });
      return { state: page['@odata.nextLink'] ? 'continuing' : 'checked' };
    } catch (error) {
      await stateRef.set({ lastError: safeError(error) }, { merge: true });
      throw new ImportReview(safeError(error));
    } finally {
      await db.runTransaction(async tx => {
        const saved = (await tx.get(stateRef)).data();
        if (saved?.leaseOwner === leaseOwner) tx.update(stateRef, { leaseOwner: '', leaseUntil: 0 });
      });
    }
  }
  async function retry(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new ImportReview('Не найдена запись импорта.');
    await db.runTransaction(async tx => {
      const [stateSnap, record] = await Promise.all([tx.get(stateRef), tx.get(ledger.doc(id))]);
      const state = (stateSnap.data() || {}) as State, item = record.data();
      ensureIdle(state);
      if (!item || item.status !== 'review' || item.mailbox !== state.settings?.mailbox) throw new ImportReview('Эта запись не ожидает повторной проверки.');
      tx.delete(record.ref);
      tx.update(stateRef, { nextLink: null, watermark: state.settings!.importFrom });
    });
    return run(true);
  }
  return { status, saveSettings, beginLogin, pollLogin, disconnect, run, retry, powerStatus, savePowerSettings, authorizePower, receivePower };
}

let runtime: ReturnType<typeof createOutlookImportService> | undefined;
export async function getOutlookImportService() {
  if (runtime) return runtime;
  const { db, admin } = await import('../config/firebase.js');
  runtime = createOutlookImportService({ db, saveFile: async (path, bytes, name, type) => {
    const file = admin.storage().bucket().file(path);
    let token: string;
    try { token = String((await file.getMetadata())[0].metadata?.firebaseStorageDownloadTokens || ''); }
    catch (error: any) { if (Number(error.code) !== 404) throw error; token = ''; }
    if (!token) {
      token = random();
      await file.save(bytes, { resumable: false, contentType: type, metadata: {
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name.replace(/[\r\n]/g, '_'))}`,
        metadata: { firebaseStorageDownloadTokens: token },
      } });
    }
    return `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  } });
  return runtime;
}
