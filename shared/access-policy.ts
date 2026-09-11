export const OWNER_EMAIL = 'ti07kz@gmail.com';
export type CrmRole = 'admin' | 'logistics' | 'regional_manager' | 'viewer';
export function isOwnerIdentity(identity: { email?: string | null; emailVerified?: boolean; isAnonymous?: boolean }) {
  return !identity.isAnonymous && identity.emailVerified === true && identity.email?.toLowerCase() === OWNER_EMAIL;
}
export function effectiveRole(identity: { email?: string | null; emailVerified?: boolean; isAnonymous?: boolean }, savedRole?: string): CrmRole {
  if (isOwnerIdentity(identity)) return 'admin';
  if (identity.isAnonymous) return 'viewer';
  // Preserve stored profiles; old demo/admin flags cannot grant ownership.
  if (savedRole === 'admin') return 'logistics';
  return savedRole === 'logistics' || savedRole === 'regional_manager' ? savedRole : 'viewer';
}
