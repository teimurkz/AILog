import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { watchCollection, normalizeDocument, type CollectionState } from '../src/services/collection-state';
import { DataLoadNotice } from '../src/components/common/DataLoadNotice';
import { isShipmentDelayed } from '../src/utils/shipmentUtils';

function fixture(timeout = 1000) {
  let next!: (data: any[], cached: boolean) => void;
  let fail!: (error: unknown) => void;
  let closed = false;
  const states: CollectionState<any>[] = [];
  const stop = watchCollection<any>((onData, onError) => {
    next = onData; fail = onError;
    return () => { closed = true; };
  }, state => states.push(state), timeout);
  return { next: (data: any[], cached = false) => next(data, cached), fail: (error: unknown) => fail(error),
    states, latest: () => states.at(-1)!, stop, closed: () => closed };
}

test('an empty browser cache never reports an empty Firebase database', () => {
  const view = fixture();
  try {
    view.next([], true);
    assert.equal(view.latest().loading, true);
    assert.equal(view.latest().confirmed, false);
    view.next([{ id: 'existing-shipment', invoice_id: 'INV-2026' }]);
    assert.equal(view.latest().confirmed, true);
    assert.equal(view.latest().data[0].id, 'existing-shipment');
    assert.equal(view.latest().error, null);
  } finally { view.stop(); }
});

test('permission and network errors retain loaded records and are visible', () => {
  const view = fixture();
  try {
    view.next([{ id: 'existing-user', role: 'logistics' }]);
    view.fail({ code: 'permission-denied' });
    assert.equal(view.latest().data.length, 1);
    assert.match(view.latest().error!, /Нет доступа/);
    const html = renderToStaticMarkup(React.createElement(DataLoadNotice, { error: view.latest().error, onRetry() {} }));
    assert.match(html, /role="alert"/);
    assert.match(html, /Повторить/);
    assert.doesNotMatch(html, /No users found|0 registered/);
    view.fail({ code: 'unavailable' });
    assert.equal(view.latest().data[0].id, 'existing-user');
    view.next([{ id: 'existing-user' }, { id: 'second-user' }]);
    assert.equal(view.latest().data.length, 2);
    assert.equal(view.latest().error, null);
  } finally { view.stop(); }
});

test('offline cache is marked unconfirmed and an empty cache does not replace records', () => {
  const view = fixture();
  try {
    view.next([{ id: 'saved-truck' }], true);
    assert.equal(view.latest().confirmed, false);
    assert.ok(view.latest().error);
    view.next([], true);
    assert.equal(view.latest().data.length, 1);
    view.next([]);
    assert.equal(view.latest().confirmed, true);
    assert.deepEqual(view.latest().data, []);
    assert.equal(view.latest().error, null);
  } finally { view.stop(); }
});

test('a connection that never answers ends loading with an error and can recover', async () => {
  const view = fixture(10);
  try {
    view.next([], true);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(view.latest().loading, false);
    assert.equal(view.latest().confirmed, false);
    assert.ok(view.latest().error);
    view.next([{ id: 'recovered' }]);
    assert.equal(view.latest().error, null);
  } finally { view.stop(); }
});

test('closing a view ignores late updates and cleans up its listener', () => {
  const view = fixture();
  view.stop();
  const count = view.states.length;
  view.next([{ id: 'old-account-record' }]);
  view.fail({ code: 'permission-denied' });
  assert.equal(view.states.length, count);
  assert.equal(view.closed(), true);
});

test('listener initialization failures show an error rather than crashing the app', () => {
  const states: CollectionState<any>[] = [];
  const stop = watchCollection(() => { throw { code: 'permission-denied' }; }, state => states.push(state));
  assert.equal(states.at(-1)!.loading, false);
  assert.match(states.at(-1)!.error!, /Нет доступа/);
  stop();
});

test('document IDs and legacy fields survive reading without changing stored records', () => {
  const raw = { id: 'old-id-field', invoice_id: 'INV-2026', extra: { currency: 'KZT' },
    last_updated: { toDate: () => new Date('2026-09-11T10:00:00Z') } };
  const first = normalizeDocument('firestore-document-A', raw);
  const second = normalizeDocument('firestore-document-B', raw);
  assert.equal(first.id, 'firestore-document-A');
  assert.equal(second.id, 'firestore-document-B');
  assert.equal(first.invoice_id, second.invoice_id);
  assert.equal(first.last_updated, '2026-09-11T10:00:00.000Z');
  assert.deepEqual(first.extra, raw.extra);
  assert.equal(raw.id, 'old-id-field');
  assert.equal(typeof raw.last_updated.toDate, 'function');
  assert.equal(normalizeDocument('uid-existing', { uid: 'legacy', role: 'logistics' }, 'uid').uid, 'uid-existing');
  assert.equal(isShipmentDelayed({ id: 'legacy-undated', status: 'In Transit' } as any), false);
});
