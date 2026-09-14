import fs from 'node:fs';
import { db } from '../config/firebase.js';
import { usesFirebase } from './tracking-context.js';
import { SUBSCRIBERS_FILE_PATH, SETTINGS_FILE_PATH, MAILING_LOGS_FILE_PATH, DEFAULT_SUBSCRIBERS, DEFAULT_MAILING_SETTINGS } from '../config/constants.js';

const clean = (value: any) => JSON.parse(JSON.stringify(value));
function readLocal(file: string, fallback: any) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

// Firebase is authoritative, including empty collections. Never substitute
// development recipients/settings/logs after a production database error.
export async function getMailingSubscribers(): Promise<any[]> {
  if (!usesFirebase()) return readLocal(SUBSCRIBERS_FILE_PATH, DEFAULT_SUBSCRIBERS);
  const snap = await db.collection('mailing_subscribers').get();
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

export async function saveMailingSubscribers(subscribers: any[]) {
  if (!usesFirebase()) return fs.writeFileSync(SUBSCRIBERS_FILE_PATH, JSON.stringify(subscribers, null, 2));
  const batch = db.batch();
  subscribers.forEach(sub => batch.set(db.collection('mailing_subscribers').doc(sub.id), clean(sub), { merge: true }));
  await batch.commit();
}

export async function markMailingSubscribersSent(subscribers: any[], timestamp: string) {
  if (!usesFirebase()) {
    const current = await getMailingSubscribers();
    await saveMailingSubscribers(current.map(s => subscribers.some(sent => sent.id === s.id && sent.email === s.email) ? { ...s, lastSentAt: timestamp } : s));
    return;
  }
  // Patch existing recipients only, preserving concurrent edits/deletions.
  await db.runTransaction(async tx => {
    const docs = await Promise.all(subscribers.map(s => tx.get(db.collection('mailing_subscribers').doc(s.id))));
    docs.forEach((doc, i) => {
      if (doc.exists && doc.data()?.email === subscribers[i].email) tx.update(doc.ref, { lastSentAt: timestamp });
    });
  });
}

export async function getMailingSettings(): Promise<any> {
  let saved: any;
  if (usesFirebase()) {
    const doc = await db.collection('mailing_settings').doc('config').get();
    saved = doc.exists ? doc.data() : { enabled: false };
  } else saved = readLocal(SETTINGS_FILE_PATH, {});
  const settings = { ...DEFAULT_MAILING_SETTINGS, ...saved };
  settings.smtpConfigured = !!((settings.smtpHost || process.env.SMTP_HOST) && (settings.smtpUser || process.env.SMTP_USER) && (settings.smtpPass || process.env.SMTP_PASS));
  return settings;
}

export async function saveMailingSettings(settings: any) {
  if (!usesFirebase()) return fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2));
  await db.collection('mailing_settings').doc('config').set(clean(settings), { merge: true });
}

export async function getMailingLogs(): Promise<any[]> {
  if (!usesFirebase()) return readLocal(MAILING_LOGS_FILE_PATH, []);
  const snap = await db.collection('mailing_logs').orderBy('timestamp', 'desc').limit(100).get();
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

export async function addMailingLog(log: any) {
  if (!usesFirebase()) {
    const logs = [log, ...readLocal(MAILING_LOGS_FILE_PATH, [])].slice(0, 100);
    return fs.writeFileSync(MAILING_LOGS_FILE_PATH, JSON.stringify(logs, null, 2));
  }
  await db.collection('mailing_logs').doc(log.id).set(clean(log));
}
