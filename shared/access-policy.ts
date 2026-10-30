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

/** CRM sections the administrator can open or close for a user. `editable`: the section has its own "can change" switch. */
export const CRM_SECTIONS = [
  { id: 'dashboard', editable: false },
  { id: 'shipments', editable: true },
  { id: 'truck-tracking', editable: true },
  { id: 'regional-orders', editable: false },
  { id: 'directories', editable: false },
  { id: 'warehouses', editable: false },
  { id: 'auto-mailing', editable: false },
  { id: 'analytics-reports', editable: false },
  { id: 'kusto-stock-expiry', editable: false },
  { id: 'archive', editable: false },
] as const;
export type CrmSection = typeof CRM_SECTIONS[number]['id'];
export type AccessLevel = 'view' | 'edit';
/** Absent section = hidden. A user without a saved map gets the defaults of the role. */
export type AccessMap = Partial<Record<CrmSection, AccessLevel>>;
const sectionIds = CRM_SECTIONS.map(section => section.id) as CrmSection[];
const editableIds = new Set<string>(CRM_SECTIONS.filter(section => section.editable).map(section => section.id));

export function roleAccess(role: CrmRole): AccessMap {
  if (role === 'regional_manager') return { 'regional-orders': 'view', directories: 'view' };
  const level: AccessLevel = role === 'viewer' ? 'view' : 'edit';
  return Object.fromEntries(sectionIds.map(id => [id, editableIds.has(id) ? level : 'view']));
}
/** Keeps only known sections and levels; "edit" only where the section supports it. */
export function cleanAccess(value: unknown): AccessMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: AccessMap = {};
  for (const id of sectionIds) {
    const level = (value as Record<string, unknown>)[id];
    if (level === 'edit') result[id] = editableIds.has(id) ? 'edit' : 'view';
    else if (level === 'view') result[id] = 'view';
  }
  return result;
}
export function effectiveAccess(identity: { email?: string | null; emailVerified?: boolean; isAnonymous?: boolean }, savedRole?: string, savedAccess?: unknown): AccessMap {
  const role = effectiveRole(identity, savedRole);
  if (role === 'admin') return roleAccess('admin');
  const access = cleanAccess(savedAccess) || roleAccess(role);
  // Guests can be shown sections but never change data.
  return identity.isAnonymous ? Object.fromEntries(Object.keys(access).map(id => [id, 'view'])) : access;
}
export const canViewSection = (access: AccessMap, section: CrmSection) => Boolean(access[section]);
export const canEditSection = (access: AccessMap, section: CrmSection) => access[section] === 'edit';
