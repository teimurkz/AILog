import firebase from '../firebase-applet-config.json';
import functions from '../firebase-functions-config.json';

export const firebaseApiBase = `https://${functions.region}-${firebase.projectId}.cloudfunctions.net/${functions.apiFunction}`;
export function resolveFirebaseApiUrl(path: string, base = firebaseApiBase) {
  if (!/^\/api(?:\/|$)/.test(path)) throw new Error('Expected a CRM API path');
  return base.replace(/\/$/, '') + path;
}
