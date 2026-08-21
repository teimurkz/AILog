import nodemailer from "nodemailer";
import { getMailingSettings } from "./mailing.service.js";

export function createNodemailerTransport(config: {
  host?: string;
  port?: number;
  secure?: boolean;
  user: string;
  pass: string;
  useService?: boolean;
}) {
  const cleanPass = (config.pass || '').trim().replace(/\s+/g, '');
  const cleanUser = (config.user || '').trim();
  const host = (config.host || 'smtp.gmail.com').trim();
  const isGmail = host.toLowerCase().includes('gmail') || cleanUser.toLowerCase().endsWith('@gmail.com');

  if (config.useService && isGmail) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: cleanUser,
        pass: cleanPass
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      tls: {
        rejectUnauthorized: false
      }
    } as any);
  }

  const port = config.port || 587;
  const secure = config.secure !== undefined ? config.secure : (port === 465);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && (port === 587 || port === 2525),
    auth: {
      user: cleanUser,
      pass: cleanPass
    },
    family: 4, // IPv4 enforcement for cloud containers
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    }
  } as any);
}

export async function getSmtpTransporter(customSettings?: any) {
  const settings = customSettings || await getMailingSettings();

  const host = customSettings?.smtpHost || settings.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(customSettings?.smtpPort || settings.smtpPort || process.env.SMTP_PORT || 587);
  const secure = customSettings?.smtpSecure !== undefined 
    ? Boolean(customSettings.smtpSecure) 
    : (settings.smtpSecure !== undefined ? Boolean(settings.smtpSecure) : (port === 465));
  
  const user = customSettings?.smtpUser || settings.smtpUser || process.env.SMTP_USER || 'ti07kz@gmail.com';
  const pass = customSettings?.smtpPass || settings.smtpPass || process.env.SMTP_PASS;
  const from = customSettings?.smtpFrom || settings.smtpFrom || process.env.SMTP_FROM || `"Складской Учет" <${user}>`;

  if (!host || !user || !pass) {
    return {
      transporter: null,
      configured: false,
      from,
      error: "Не введен Пароль Приложения Google (16 символов). Создайте его на странице myaccount.google.com/apppasswords и сохраните в настройках."
    };
  }

  const transporter = createNodemailerTransport({
    host: host.trim(),
    port,
    secure,
    user: user.trim(),
    pass: pass.trim()
  });

  return {
    transporter,
    configured: true,
    from,
    host: host.trim(),
    port,
    user: user.trim()
  };
}

export async function sendMailWithResilience(mailOptions: any, customSettings?: any) {
  const settings = customSettings || await getMailingSettings();
  const cleanPass = (settings?.smtpPass || process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');
  const cleanUser = (settings?.smtpUser || process.env.SMTP_USER || 'ti07kz@gmail.com').trim();
  const host = (settings?.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(settings?.smtpPort || process.env.SMTP_PORT || 587);
  const secure = settings?.smtpSecure !== undefined ? Boolean(settings.smtpSecure) : (port === 465);

  if (!cleanUser || !cleanPass) {
    throw new Error("Не введен Пароль Приложения Google (16 символов). Создайте его на странице myaccount.google.com/apppasswords и сохраните в настройках.");
  }

  const isGmail = host.toLowerCase().includes('gmail') || cleanUser.toLowerCase().endsWith('@gmail.com');

  const transportConfigs: Array<{ desc: string; config: any }> = [];

  // Strategy 1: Configured port (IPv4 forced)
  transportConfigs.push({
    desc: `${host}:${port} (${secure ? 'SSL' : 'STARTTLS'}, IPv4)`,
    config: { host, port, secure, user: cleanUser, pass: cleanPass }
  });

  // Strategy 2: Alternative port
  const altPort = port === 465 ? 587 : 465;
  transportConfigs.push({
    desc: `${host}:${altPort} (${altPort === 465 ? 'SSL' : 'STARTTLS'}, IPv4)`,
    config: { host, port: altPort, secure: altPort === 465, user: cleanUser, pass: cleanPass }
  });

  // Strategy 3: Nodemailer Gmail Service Engine
  if (isGmail) {
    transportConfigs.push({
      desc: 'Nodemailer Gmail Engine (IPv4)',
      config: { host, user: cleanUser, pass: cleanPass, useService: true }
    });
  }

  let lastErr: any = null;
  for (let attempt = 0; attempt < transportConfigs.length; attempt++) {
    const item = transportConfigs[attempt];
    try {
      console.log(`📧 [Mailing] Попытка отправки почты через [${item.desc}] (${attempt + 1}/${transportConfigs.length})...`);
      const transporter = createNodemailerTransport(item.config);
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ [Mailing] Письмо успешно отправлено через [${item.desc}]! MessageID:`, info?.messageId);
      return { success: true, info, usedStrategy: item.desc };
    } catch (err: any) {
      console.error(`⚠️ [Mailing] Сбой отправки через [${item.desc}]:`, err?.message || err);
      lastErr = err;
      if (attempt < transportConfigs.length - 1) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }
  }

  throw lastErr || new Error("Не удалось отправить письмо через все доступные протоколы SMTP");
}
