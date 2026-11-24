import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractDayMapData } from '../public/js/trip-map.js';
import { normalizeRoutePath } from '../src/services/naver-maps.js';

test('day map uses actual coordinates and actual available geometry only', () => {
  const path = [[129.1, 35.1], [129.11, 35.11], [129.12, 35.12]];
  const data = extractDayMapData({ stops: [
    { title: '확인 장소', place: { coordinates: { longitude: 129.1, latitude: 35.1 } }, route: { available: true, path } },
    { title: '좌표 없음' },
    { title: '잘못된 좌표', place: { coordinates: { longitude: 1291000000, latitude: 351000000 } }, route: { available: false, path } },
  ] });
  assert.equal(data.markers.length, 1);
  assert.equal(data.markers[0].index, 0);
  assert.deepEqual(data.paths, [path]);
  assert.deepEqual(extractDayMapData({ stops: [{ title: '샘플' }] }), { markers: [], paths: [] });
});

test('missing or invalid polyline never becomes a straight-line fallback', () => {
  for (const path of [undefined, [], [[129, 35]], [[129, 35], [null, 35]], [[129, 35], [181, 35]], [[129, 35], ['129.1', 35]]]) {
    assert.deepEqual(normalizeRoutePath(path), []);
    assert.deepEqual(extractDayMapData({ stops: [{ route: { available: true, path } }] }).paths, []);
  }
  assert.deepEqual(normalizeRoutePath([[129, 35], [129.1, 35.1]]), [[129, 35], [129.1, 35.1]]);
});

test('lodging map adds only verified coordinates and actual selected hotel route geometry', () => {
  const route = { available: true, path: [[129.1, 35.1], [129.11, 35.11]] };
  const data = extractDayMapData({ stops: [{ title: '관광지', place: { coordinates: { longitude: 129.11, latitude: 35.11 } } }], lodgings: [{ id: 'stay-1', title: '검색된 호텔', place: { coordinates: { longitude: 129.1, latitude: 35.1 } } }, { id: 'unknown', title: '미확인 숙소' }], lodgingRoutes: [route, { available: false, path: route.path }] });
  assert.equal(data.markers.length, 2);
  assert.equal(data.markers[1].kind, 'lodging');
  assert.equal(data.markers[1].id, 'stay-1');
  assert.equal(data.markers[1].index, 1);
  assert.deepEqual(data.paths, [route.path]);
});
