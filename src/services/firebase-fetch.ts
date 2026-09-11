import { auth } from '../firebase';
export async function firebaseFetch(url: string, options: RequestInit = {}) {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, { ...options, headers });
}
