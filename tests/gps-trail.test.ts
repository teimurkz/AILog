import test from 'node:test';
import assert from 'node:assert/strict';
import { splitGpsTrail, type GpsTrailPoint } from '../src/lib/gps-trail.ts';

const point = (seconds: number, lng = 76.89, extra: Partial<GpsTrailPoint> = {}): GpsTrailPoint => ({
  lat: 43.24, lng, timestamp: new Date(Date.UTC(2026, 8, 14) + seconds * 1000).toISOString(), ...extra,
});

test('continuous nearby GPS produces one trail without changing recorded points', () => {
  const history = [point(0), point(30, 76.891), point(60, 76.892)];
  const before = structuredClone(history);
  assert.deepEqual(splitGpsTrail(history), [history]);
  assert.deepEqual(history, before);
});

test('missing city-crossing observations stay disconnected and the new trail continues', () => {
  const history = [point(0), point(30, 76.891), point(90, 76.97), point(120, 76.971)];
  assert.deepEqual(splitGpsTrail(history), [history.slice(0, 2), history.slice(2)]);
});

test('long signal gaps break the trail even when the next point is nearby', () => {
  const history = [point(0), point(30, 76.891), point(600, 76.892), point(630, 76.893)];
  assert.deepEqual(splitGpsTrail(history), [history.slice(0, 2), history.slice(2)]);
});

test('impossible GPS spike is not connected to either adjacent observation', () => {
  const history = [point(0), point(30, 76.891), point(31, 76.899), point(32, 76.891), point(60, 76.892)];
  assert.deepEqual(splitGpsTrail(history), [history.slice(0, 2), [history[2]], history.slice(3)]);
});

test('missing, invalid, duplicate or reversed timestamps cannot fabricate a path', () => {
  for (const timestamp of [undefined, 'invalid', point(0).timestamp, point(-1).timestamp]) {
    const history = [point(0), point(10, 76.891, { timestamp })];
    assert.deepEqual(splitGpsTrail(history), history.map(p => [p]));
  }
});

test('invalid coordinates interrupt the trail; uncertain observations remain isolated', () => {
  const a = point(0), b = point(30, 76.891), c = point(60, 76.892);
  assert.deepEqual(splitGpsTrail([a, point(10, NaN), b, c]), [[a], [b, c]]);
  assert.deepEqual(splitGpsTrail([a, point(10, 76.89, { lat: 91 }), b]), [[a], [b]]);
  const uncertain = point(10, 76.89, { accuracy: 500 });
  assert.deepEqual(splitGpsTrail([a, uncertain, b]), [[a], [uncertain], [b]]);
  assert.deepEqual(splitGpsTrail([]), []);
});
