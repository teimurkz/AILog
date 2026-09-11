import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import { effectiveRole } from '../../shared/access-policy.js';
import type { UserProfileRecord } from './storage.service.js';

type Identity = { uid: string; email?: string; email_verified?: boolean; name?: string; exp: number; firebase?: { sign_in_provider?: string } };
type VerifiedUser = { profile: UserProfileRecord; expiresAt: number };
const verified = new WeakMap<object, VerifiedUser>();
type Verifier = (token: string) => Promise<Identity>;
type ProfileLoader = (uid: string) => Promise<Partial<UserProfileRecord> | undefined>;
const verify: Verifier = async token => {
  const { admin } = await import('../config/firebase.js');
  return admin.auth().verifyIdToken(token);
};
const loadProfile: ProfileLoader = async uid => {
  const { db } = await import('../config/firebase.js');
  return (await db.collection('users').doc(uid).get()).data() as UserProfileRecord | undefined;
};

export function getCrmUser(request: Pick<IncomingMessage, 'headers'>) {
  const saved = verified.get(request);
  return saved && saved.expiresAt > Date.now() ? saved.profile : undefined;
}
export const isCrmAdmin = (request: Pick<IncomingMessage, 'headers'>) => getCrmUser(request)?.role === 'admin';
export function createAuthenticator(verifyToken: Verifier = verify, profileLoader: ProfileLoader = loadProfile) {
  return async (request: Pick<IncomingMessage, 'headers'>, suppliedToken?: string) => {
    verified.delete(request);
    const token = suppliedToken || request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return;
    const claims = await verifyToken(token);
    if (!claims.uid || !claims.exp || claims.exp * 1000 <= Date.now()) throw new Error('Expired Firebase identity');
    let saved: Partial<UserProfileRecord> | undefined;
    try { saved = await profileLoader(claims.uid); }
    catch { throw Object.assign(new Error('Firestore unavailable'), { statusCode: 503 }); }
    const identity = { email: claims.email, emailVerified: claims.email_verified,
      isAnonymous: claims.firebase?.sign_in_provider === 'anonymous' };
    const profile: UserProfileRecord = { ...saved, uid: claims.uid, email: claims.email || '',
      displayName: saved?.displayName || claims.name || (identity.isAnonymous ? 'Гость' : ''),
      role: effectiveRole(identity, saved?.role) };
    verified.set(request, { profile, expiresAt: claims.exp * 1000 });
    return profile;
  };
}
export const authenticateRequest = createAuthenticator();
export const authenticateCrm: RequestHandler = (req, res, next) => {
  authenticateRequest(req).then(() => next()).catch(error => res.status(error.statusCode === 503 ? 503 : 401).json({ error: error.statusCode === 503 ?
    'Серверу нужен доступ к Firestore существующего проекта Firebase. Проверьте настройки сервисного аккаунта.' :
    'Войдите через Google или гостевой вход Firebase.' }));
};
export const requireSignedIn: RequestHandler = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!getCrmUser(req)) return void res.status(401).json({ error: 'Войдите в CRM через Firebase.' });
  next();
};
export const requireAdmin: RequestHandler = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = getCrmUser(req);
  if (!user) return void res.status(401).json({ error: 'Войдите через Google под учётной записью администратора.' });
  if (user.role !== 'admin') return void res.status(403).json({ error: 'GPS-мониторинг доступен только администратору.' });
  next();
};
export const requireSameOrigin: RequestHandler = (req, res, next) => {
  // Firebase Functions has a different origin from AI Studio. A verified Bearer
  // token is explicit authorization; no cookies or ambient sessions are accepted.
  if (res.locals.firebaseFunction && getCrmUser(req) && /^Bearer /i.test(req.headers.authorization || '')) return next();
  // Cloud Run terminates HTTPS before Express. Compare host, not the internal protocol.
  let foreign = req.headers['sec-fetch-site'] === 'cross-site';
  if (req.headers.origin) {
    try { foreign ||= new URL(req.headers.origin).host !== req.get('host'); } catch { foreign = true; }
  }
  if (foreign) return void res.status(403).json({ error: 'Запрос с другого сайта запрещён.' });
  next();
};
