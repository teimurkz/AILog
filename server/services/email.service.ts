import nodemailer from 'nodemailer';
import { getMailingSettings } from './mailing.service.js';
import { smtpSecure, smtpFailure, describeSmtpError } from './smtp-policy.js';

export function createNodemailerTransport(config: { host?: string; port?: number; secure?: boolean; user: string; pass: string; useService?: boolean }) {
  const host = (config.host || 'smtp.gmail.com').trim();
  const gmail = host.toLowerCase() === 'smtp.gmail.com';
  const port = config.useService && gmail ? 465 : Number(config.port || 587);
  return nodemailer.createTransport({
    host, port, secure: smtpSecure(port, config.secure), requireTLS: port !== 465,
    auth: { user: config.user.trim(), pass: gmail ? config.pass.replace(/\s+/g, '') : config.pass },
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
}

export async function getSmtpTransporter(customSettings?: any) {
  const settings = customSettings || await getMailingSettings();
  const host = settings.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(settings.smtpPort || process.env.SMTP_PORT || 587);
  const user = settings.smtpUser || process.env.SMTP_USER || '';
  const pass = settings.smtpPass || process.env.SMTP_PASS || '';
  const from = settings.smtpFrom || process.env.SMTP_FROM || `"Складской Учет" <${user}>`;
  if (!user || !pass) return { transporter: null, configured: false, from, error: 'Укажите логин и пароль SMTP в настройках рассылки.' };
  return { transporter: createNodemailerTransport({ host, port, secure: smtpSecure(port, settings.smtpSecure), user, pass }), configured: true, from, host, port, user };
}

export async function sendMailWithResilience(mailOptions: any, customSettings?: any) {
  const settings = customSettings || await getMailingSettings();
  const host = (settings.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(settings.smtpPort || process.env.SMTP_PORT || 587);
  const user = (settings.smtpUser || process.env.SMTP_USER || '').trim();
  const pass = settings.smtpPass || process.env.SMTP_PASS || '';
  if (!user || !pass) throw Object.assign(new Error('Укажите логин и пароль SMTP в настройках рассылки.'), { code: 'ECONFIG', retryable: false, uncertain: false });
  // A custom SMTP provider may not support alternate ports.
  const ports = host.toLowerCase() === 'smtp.gmail.com' && [465, 587].includes(port) ? [port, port === 465 ? 587 : 465] : [port];
  const attempts: string[] = [];
  for (const nextPort of ports) {
    const transport = createNodemailerTransport({ host, port: nextPort, secure: smtpSecure(nextPort, settings.smtpSecure), user, pass });
    try {
      const info = await transport.sendMail(mailOptions);
      return { success: true, info, usedStrategy: `${host}:${nextPort}`, attempts };
    } catch (error: any) {
      const policy = smtpFailure(error);
      attempts.push(`${host}:${nextPort}: ${describeSmtpError(error, [pass, pass.replace(/\s+/g, '')])}`);
      if (!policy.retryable || nextPort === ports.at(-1)) {
        throw Object.assign(new Error(attempts.join('\n')), { ...policy, code: error.code, command: error.command });
      }
    } finally { transport.close(); }
  }
  throw new Error('Не удалось отправить письмо.');
}
