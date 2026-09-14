export function smtpSecure(port: number, value?: unknown): boolean {
  if (port === 465) return true;
  if (port === 587 || port === 2525) return false;
  return value === true || value === 'true';
}

export function smtpFailure(error: any): { retryable: boolean; uncertain: boolean } {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  const response = Number(error?.responseCode);
  const rejected = response >= 400 && response < 600;
  const beforeTransfer = code === 'ETLS' || code === 'EDNS' ||
    /before secure TLS connection|Greeting never received|Connection timeout|connect ECONNREFUSED|connect ENETUNREACH/i.test(message);
  // Nodemailer can label even a socket failure after DATA as command=CONN.
  return {
    retryable: beforeTransfer || (rejected && response < 500),
    uncertain: !beforeTransfer && !rejected && !['EAUTH', 'EENVELOPE', 'ECONFIG'].includes(code),
  };
}

export function describeSmtpError(error: any, secrets: string[] = []): string {
  let message = String(error?.message || 'Ошибка SMTP');
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join('[скрыто]');
  return [error?.code, error?.command, message].filter(Boolean).join(' · ').slice(0, 1000);
}
