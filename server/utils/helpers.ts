import https from "https";

export function extractInvoiceNumberFromText(text: string): string | null {
  if (!text) return null;
  const normText = text.replace(/\r/g, '');

  // 1. Form З-2 layout: "Номер \n документа \n Дата \n составления \n 46969 31.07.2026"
  const formZ2Match = normText.match(/Номер[\s\S]{0,80}?документа[\s\S]{0,80}?([A-Za-z0-9\-_/]{2,25})\s+\d{2}\.\d{2}\.\d{2,4}/i);
  if (formZ2Match && formZ2Match[1] && !/^(дата|составления|форма|приложение|номер|документа)$/i.test(formZ2Match[1])) {
    const val = formZ2Match[1].replace(/^[№No:#\s]+/, '').trim();
    if (val.length >= 2) return val;
  }

  // 2. Direct labels
  const patterns = [
    /(?:номер\s*документа|№\s*документа)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
    /(?:накладная\s*на\s*отпуск[^\n]*?№?|накладная\s*№|номер\s*накладной|№\s*накладной)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
    /(?:номер\s*заказа|№\s*заказа|заказ\s*№)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
    /(?:документ\s*№)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
    /(?:товарно-транспортная\s*накладная\s*№)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
  ];

  for (const pattern of patterns) {
    const match = normText.match(pattern);
    if (match && match[1]) {
      const val = match[1].replace(/^[№No:#\s]+/, '').trim();
      if (val.length >= 2 && !/^(дата|составления|форма|приложение|номер|документа)$/i.test(val)) {
        return val;
      }
    }
  }

  // 3. Fallback for "Номер" + "документа" followed within 100 chars by a standalone number
  const z2Fallback = normText.match(/Номер\s*документа[\s\S]{0,100}?(\b\d{3,12}\b)/i);
  if (z2Fallback && z2Fallback[1]) {
    return z2Fallback[1].trim();
  }

  return null;
}

export function extractPalletNumeric(palletStr: string | number): number {
  if (palletStr == null || palletStr === '') return 0;
  if (typeof palletStr === 'number') return isNaN(palletStr) ? 0 : palletStr;
  const normalized = String(palletStr).replace(/,/g, '.');
  const matches = normalized.match(/\d+(\.\d+)?/g);
  if (!matches) return 0;
  return matches.reduce((acc, curr) => acc + (parseFloat(curr) || 0), 0);
}

export function formatCellDate(val: any): string {
  if (val == null || val === '') return '';
  if (typeof val === 'number' && val > 30000 && val < 60000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    const day = ('0' + d.getUTCDate()).slice(-2);
    const month = ('0' + (d.getUTCMonth() + 1)).slice(-2);
    const year = d.getUTCFullYear();
    return `${day}.${month}.${year}`;
  }
  return String(val).trim();
}

export function fetchBufferWithRedirects(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects while downloading Google Sheet'));
    
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      },
      timeout: 20000
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchBufferWithRedirects(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Google Sheets HTTP status ${res.statusCode}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Google Sheets download timed out'));
    });
  });
}

export function getZonedTime(timeZone: string = 'Asia/Almaty') {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short'
    });

    const parts = formatter.formatToParts(now);
    const map: Record<string, string> = {};
    parts.forEach(p => { map[p.type] = p.value; });

    const hours = map.hour === '24' ? '00' : (map.hour || '00').padStart(2, '0');
    const minutes = (map.minute || '00').padStart(2, '0');
    const HHmm = `${hours}:${minutes}`;

    const yearNum = Number(map.year);
    const monthNum = Number(map.month) - 1;
    const dayNum = Number(map.day);
    const dayOfWeek = new Date(Date.UTC(yearNum, monthNum, dayNum)).getUTCDay();

    return {
      HHmm,
      todayDateStr: `${map.year}-${map.month}-${map.day}`,
      dayOfWeek,
      fullZonedString: `${map.day}.${map.month}.${map.year} ${HHmm}`
    };
  } catch (e) {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return {
      HHmm: `${hours}:${minutes}`,
      todayDateStr: now.toISOString().split('T')[0],
      dayOfWeek: now.getDay(),
      fullZonedString: now.toLocaleString('ru-RU')
    };
  }
}
