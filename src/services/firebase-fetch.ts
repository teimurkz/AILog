import { auth } from '../firebase';
import { apiUrl } from './api-endpoint';
export async function firebaseFetch(url: string, options: RequestInit = {}) {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  try {
    return await fetch(apiUrl(url), { ...options, headers, credentials: 'omit', signal: options.signal || AbortSignal.timeout(60000) });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('Не удалось связаться с Firebase Cloud Functions. Проверьте соединение и публикацию функции crmApi в существующем Firebase-проекте.');
  }
}
export async function downloadFirebaseFile(path: string, name: string) {
  const response = await firebaseFetch(path);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Не удалось скачать файл из Firebase.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
