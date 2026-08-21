import fs from "fs";
import { db } from "../config/firebase.js";
import {
  SUBSCRIBERS_FILE_PATH,
  SETTINGS_FILE_PATH,
  MAILING_LOGS_FILE_PATH,
  DEFAULT_SUBSCRIBERS,
  DEFAULT_MAILING_SETTINGS
} from "../config/constants.js";

export async function getMailingSubscribers(): Promise<any[]> {
  try {
    const snap = await db.collection('mailing_subscribers').get();
    if (!snap.empty) {
      return snap.docs.map(d => d.data());
    }
  } catch (e) {
    // Fallback to local
  }
  if (fs.existsSync(SUBSCRIBERS_FILE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE_PATH, 'utf8'));
    } catch (e) {}
  }
  return DEFAULT_SUBSCRIBERS;
}

export async function saveMailingSubscribers(subscribers: any[]) {
  try {
    fs.writeFileSync(SUBSCRIBERS_FILE_PATH, JSON.stringify(subscribers, null, 2), 'utf8');
  } catch (e) {}

  try {
    const batch = db.batch();
    subscribers.forEach(sub => {
      const ref = db.collection('mailing_subscribers').doc(sub.id);
      batch.set(ref, sub);
    });
    await batch.commit();
  } catch (e) {}
}

export async function getMailingSettings(): Promise<any> {
  let settings: any = { ...DEFAULT_MAILING_SETTINGS };

  // 1. Read local JSON fallback first
  if (fs.existsSync(SETTINGS_FILE_PATH)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
      if (fileData) {
        settings = { ...settings, ...fileData };
      }
    } catch (e) {}
  }

  // 2. Read Firestore and merge
  try {
    const doc = await db.collection('mailing_settings').doc('config').get();
    if (doc.exists) {
      const dbData = doc.data() || {};
      settings = {
        ...settings,
        ...dbData,
        smtpPass: dbData.smtpPass || settings.smtpPass || process.env.SMTP_PASS || ''
      };
    }
  } catch (e) {}

  const hasHost = !!(settings.smtpHost || process.env.SMTP_HOST);
  const hasUser = !!(settings.smtpUser || process.env.SMTP_USER);
  const hasPass = !!(settings.smtpPass || process.env.SMTP_PASS);
  
  settings.smtpConfigured = hasHost && hasUser && hasPass;
  return settings;
}

export async function saveMailingSettings(settings: any) {
  try {
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {}

  try {
    await db.collection('mailing_settings').doc('config').set(settings);
  } catch (e) {}
}

export async function getMailingLogs(): Promise<any[]> {
  try {
    const snap = await db.collection('mailing_logs').orderBy('timestamp', 'desc').limit(100).get();
    if (!snap.empty) {
      return snap.docs.map(d => d.data());
    }
  } catch (e) {}

  if (fs.existsSync(MAILING_LOGS_FILE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(MAILING_LOGS_FILE_PATH, 'utf8'));
    } catch (e) {}
  }
  return [];
}

export async function addMailingLog(log: any) {
  let existing: any[] = [];
  if (fs.existsSync(MAILING_LOGS_FILE_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(MAILING_LOGS_FILE_PATH, 'utf8')) || [];
    } catch (e) {}
  }
  existing.unshift(log);
  existing = existing.slice(0, 100);
  try {
    fs.writeFileSync(MAILING_LOGS_FILE_PATH, JSON.stringify(existing, null, 2), 'utf8');
  } catch (e) {}

  try {
    await db.collection('mailing_logs').doc(log.id).set(log);
  } catch (e) {}
}
