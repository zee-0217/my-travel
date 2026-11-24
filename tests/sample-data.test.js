import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSampleTrip, addDays } from '../public/js/sample-data.js';

const input = { region: '강릉', startDate: '2026-12-31', duration: 3, travelers: 2, budget: 800000, transport: 'car', preferences: ['자연', '휴식'], requests: '' };

test('multi-day itinerary crosses years and keeps costs consistent', () => {
  const trip = createSampleTrip(input);
  assert.deepEqual(trip.days.map((day) => day.date), ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.ok(trip.days.every((day) => day.stops.length === 4));
  assert.equal(trip.total, trip.costs.reduce((sum, cost) => sum + cost.amount, 0));
  assert.equal(trip.remaining, input.budget - trip.total);
  assert.equal(trip.total, 655000);
});

test('day trips have no accommodation and low budgets visibly exceed the limit', () => {
  const trip = createSampleTrip({ ...input, duration: 1, budget: 10000, travelers: 5, transport: 'rental' });
  assert.equal(trip.costs[0].amount, 0);
  assert.equal(trip.costs[2].amount, 190000);
  assert.ok(trip.remaining < 0);
});

test('unknown destinations and empty preferences still produce explicit samples', () => {
  const trip = createSampleTrip({ ...input, region: '  단양  ', preferences: [], requests: '<script>sample</script>' });
  assert.equal(trip.region, '단양');
  assert.equal(trip.knownRegion, false);
  assert.equal(trip.isSample, true);
  assert.match(trip.days[0].stops[0].title, /^단양/);
  assert.equal(trip.requests, '<script>sample</script>');
  assert.equal(createSampleTrip({ ...input, preferences: ['쇼핑'] }).days[0].stops[0].category, '쇼핑');
});

test('invalid dates and numeric inputs fail rather than silently producing a plan', () => {
  for (const change of [{ startDate: '2026-02-30' }, { duration: 0 }, { duration: 8 }, { travelers: 1.5 }, { budget: NaN }, { transport: 'unknown' }, { region: ' ' }]) {
    assert.throws(() => createSampleTrip({ ...input, ...change }));
  }
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});
