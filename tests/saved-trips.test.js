import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSavedTripStore, SAVED_TRIPS_KEY, exportTrip } from '../public/js/saved-trips.js';
import { editSavedTrip } from '../public/js/saved-trips-ui.js';
import { createSampleTrip } from '../public/js/sample-data.js';

const makeTrip = () => ({ ...createSampleTrip({ region: '부산', startDate: '2026-12-01', duration: 2, travelers: 2, budget: 500000, preferences: ['자연'], transport: 'car', requests: '' }), isSample: false, title: '부산 여행' });
function setup() {
  const data = new Map(); let count = 0;
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const options = { storage, makeId: () => `saved-${++count}`, now: () => new Date(Date.UTC(2026, 10, 24, 3, 0, ++count)).toISOString() };
  return { data, storage, options, store: createSavedTripStore(options) };
}
test('saved plans survive a new store instance, support overwrite/copies/delete and preserve independent snapshots', () => {
  const { options, store } = setup(), trip = makeTrip();
  const first = store.save(trip); trip.days[0].stops[0].title = 'caller mutation';
  const reloaded = createSavedTripStore(options); assert.notEqual(reloaded.get(first.id).plan.days[0].stops[0].title, 'caller mutation');
  const edited = { ...first.plan, title: '수정된 부산' };
  const updated = reloaded.save(edited, first.id); assert.equal(updated.createdAt, first.createdAt); assert.notEqual(updated.updatedAt, first.updatedAt);
  assert.equal(reloaded.list().length, 1); assert.equal(reloaded.list()[0].plan.title, '수정된 부산');
  reloaded.save(edited); assert.equal(reloaded.list().length, 2);
  reloaded.remove(first.id); assert.equal(reloaded.list().length, 1); assert.throws(() => reloaded.get(first.id));
});
test('storage and JSON contain itinerary data without credentials, private context or session identifiers', () => {
  const { store, data } = setup(), trip = makeTrip();
  Object.assign(trip, { apiKey: 'root-secret', planId: 'session-private', context: { secret: 'server-private' }, requests: 'OPENAI_API_KEY=sk-testcredential123456789' });
  trip.days[0].stops[0].place = { name: '장소', apiKey: 'nested-secret', headers: { Authorization: 'auth-secret' }, link: 'https://user:pass@example.com/place?serviceKey=url-secret&view=map#token-secret' };
  trip.trace = [{ tool: 'search_places', summary: '검색 성공', args: { apiKey: 'args-secret' }, callId: 'private-call' }];
  const entry = store.save(trip), text = data.get(SAVED_TRIPS_KEY), exported = exportTrip(trip);
  for (const secret of ['root-secret','session-private','server-private','nested-secret','auth-secret','url-secret','token-secret','args-secret','private-call','sk-testcredential123456789']) { assert.ok(!text.includes(secret), secret); assert.ok(!exported.includes(secret), secret); }
  assert.equal(entry.plan.trace[0].tool, 'search_places'); assert.equal(entry.plan.days[0].stops[0].place.link, 'https://example.com/place?view=map');
  assert.equal(JSON.parse(exported).title, trip.title); assert.equal(trip.apiKey, 'root-secret');
});
test('malformed data, unavailable storage, sample saves and quota failures preserve previous data', () => {
  const { store, data, storage } = setup(); store.save(makeTrip()); const before = data.get(SAVED_TRIPS_KEY);
  const full = createSavedTripStore({ storage: { getItem: storage.getItem, setItem: () => { throw new Error('QuotaExceededError'); } } });
  assert.throws(() => full.save(makeTrip()), /저장/); assert.equal(data.get(SAVED_TRIPS_KEY), before);
  assert.throws(() => store.save({ ...makeTrip(), isSample: true }));
  data.set(SAVED_TRIPS_KEY, '{broken'); assert.throws(() => store.save(makeTrip()), /기존 데이터/); assert.equal(data.get(SAVED_TRIPS_KEY), '{broken');
  assert.throws(() => createSavedTripStore({ storage: { getItem: () => { throw new Error(); } } }).list(), /저장소/);
});
test('manual edits revalidate overlapping times and preserve places, route evidence and the original plan', () => {
  const trip = makeTrip();
  const stops = trip.days.flatMap((day) => day.stops.map((stop) => ({ time: stop.time, endTime: '', personalNote: '' })));
  stops[0] = { time: '10:00', endTime: '13:00', personalNote: '여유 있게 보기' }; stops[1] = { time: '12:00', endTime: '14:00', personalNote: '' };
  const result = editSavedTrip(trip, { title: '직접 다듬은 부산', personalNote: '우산 챙기기', stops });
  assert.equal(result.title, '직접 다듬은 부산'); assert.equal(result.days[0].stops[0].personalNote, '여유 있게 보기');
  assert.ok(result.validation.issues.some((issue) => issue.code === 'TIME_OVERLAP')); assert.equal(result.validation.stopReason, 'LOCAL_EDIT');
  assert.equal(trip.title, '부산 여행'); assert.equal(trip.days[0].stops[0].endTime, undefined);
  assert.deepEqual(result.days[0].stops.map((stop) => stop.title), trip.days[0].stops.map((stop) => stop.title));
  stops[0].endTime = '09:00'; assert.throws(() => editSavedTrip(trip, { title: '부산', personalNote: '', stops }), /종료 시각/);
});
