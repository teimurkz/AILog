import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditSection, canViewSection, cleanAccess, effectiveAccess, roleAccess, CRM_SECTIONS } from '../shared/access-policy';
import { createAuthenticator } from '../server/services/crm-auth.service';

const staff = { email: 'staff@example.test', emailVerified: true, isAnonymous: false };
const owner = { email: 'ti07kz@gmail.com', emailVerified: true, isAnonymous: false };
const guest = { email: '', emailVerified: false, isAnonymous: true };

test('without saved access the role decides, as before', () => {
  const logistics = effectiveAccess(staff, 'logistics');
  assert.equal(Object.keys(logistics).length, CRM_SECTIONS.length);
  assert.ok(canEditSection(logistics, 'shipments') && canEditSection(logistics, 'truck-tracking'));
  const viewer = effectiveAccess(staff, 'viewer');
  assert.ok(canViewSection(viewer, 'shipments') && !canEditSection(viewer, 'shipments'));
  assert.deepEqual(Object.keys(effectiveAccess(staff, 'regional_manager')).sort(), ['directories', 'regional-orders']);
});

test('saved access overrides the role: hidden sections and per-section editing', () => {
  const access = effectiveAccess(staff, 'viewer', { 'truck-tracking': 'edit', shipments: 'view' });
  assert.ok(canEditSection(access, 'truck-tracking'));
  assert.ok(canViewSection(access, 'shipments') && !canEditSection(access, 'shipments'));
  assert.ok(!canViewSection(access, 'dashboard') && !canViewSection(access, 'warehouses'));
  // A logistics user can be limited too.
  assert.ok(!canEditSection(effectiveAccess(staff, 'logistics', { shipments: 'view' }), 'shipments'));
  // An empty map hides everything (it is not "by role").
  assert.deepEqual(effectiveAccess(staff, 'logistics', {}), {});
});

test('access is cleaned: unknown sections dropped, "edit" only where supported', () => {
  assert.deepEqual(cleanAccess({ dashboard: 'edit', shipments: 'edit', hacker: 'edit', archive: 'admin' }), { dashboard: 'view', shipments: 'edit' });
  assert.equal(cleanAccess(null), null); assert.equal(cleanAccess(['shipments']), null);
});

test('the owner always has everything; guests never edit', () => {
  assert.deepEqual(effectiveAccess(owner, 'viewer', {}), roleAccess('admin'));
  const access = effectiveAccess(guest, 'logistics', { shipments: 'edit', 'truck-tracking': 'edit' });
  assert.ok(canViewSection(access, 'shipments') && !canEditSection(access, 'shipments') && !canEditSection(access, 'truck-tracking'));
});

test('the server applies the saved access of the signed-in user', async () => {
  const authenticate = createAuthenticator(
    async () => ({ uid: 'u1', email: staff.email, email_verified: true, exp: Date.now() / 1000 + 600, firebase: { sign_in_provider: 'google.com' } }),
    async () => ({ role: 'logistics', access: { shipments: 'view' } as any }));
  const profile = await authenticate({ headers: { authorization: 'Bearer token' } });
  assert.equal(profile!.role, 'logistics');
  assert.ok(canViewSection(profile!.access!, 'shipments') && !canEditSection(profile!.access!, 'shipments'));
});
