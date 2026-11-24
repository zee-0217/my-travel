import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateItinerary, describePlanChanges } from '../src/agents/validate-itinerary.js';

const date = '2026-11-24';
const input = { budget: 300000, maxPlacesPerDay: 2, maxTravelMinutesPerLeg: 30, maxTravelMinutesPerDay: 60 };
const hours = () => ({ status: 'confirmed', date, sourceUrl: 'https://example.com/official', checkedAt: '2026-11-24T00:00:00Z', intervals: [{ open: '09:00', close: '18:00' }] });
const stop = (time = '10:00', endTime = '11:00') => ({ title: '검증 장소', time, endTime, openingHours: hours(), environment: { type: 'indoor', basis: '공식 안내 확인' } });
const plan = () => ({ budgetCalculation: { pricedSubtotal: 200000, total: 200000, unknownCount: 0, status: 'confirmed' }, days: [{ date, weather: { available: true, rainExpected: false, indoorSuggested: false }, stops: [stop()] }] });
const codes = (value) => validateItinerary(value, input).issues.map((issue) => issue.code);

test('fully known valid plans pass without mutating inputs; missing evidence stays confirmation required', () => {
  const value = plan(), copy = structuredClone(value);
  assert.equal(validateItinerary(value, input).status, 'passed');
  assert.deepEqual(value, copy);
  value.budgetCalculation = null;
  value.days[0].weather = null;
  value.days[0].stops[0].openingHours = null;
  value.days[0].stops[0].endTime = null;
  assert.equal(validateItinerary(value, input).status, 'needs_confirmation');
  assert.ok(codes(value).includes('BUDGET_UNKNOWN'));
  assert.ok(codes(value).includes('OPENING_HOURS_UNKNOWN'));
  assert.equal(validateItinerary(value, input).problemCount, 0);
});

test('confirmed and estimated overspending are distinct, even if other prices remain unknown', () => {
  const value = plan(); value.budgetCalculation.pricedSubtotal = 310000;
  assert.equal(validateItinerary(value, input).issues[0].severity, 'error');
  value.budgetCalculation.status = 'incomplete'; value.budgetCalculation.total = null; value.budgetCalculation.unknownCount = 2;
  assert.equal(validateItinerary(value, input).issues[0].severity, 'warning');
  assert.ok(codes(value).includes('BUDGET_UNKNOWN'));
});

test('count, interval overlap, nested/nonadjacent conflicts, midnight and boundary cases are computed', () => {
  const value = plan(); value.days[0].stops = [stop('09:00', '15:00'), stop('10:00', '11:00'), stop('12:00', '13:00')];
  assert.ok(codes(value).includes('TOO_MANY_PLACES'));
  assert.equal(validateItinerary(value, input).issues.filter((issue) => issue.code === 'TIME_OVERLAP').length, 2);
  value.days[0].stops = [stop('09:00', '10:00'), stop('10:00', '11:00')];
  assert.ok(!codes(value).includes('TIME_OVERLAP'));
  value.days[0].stops[1].time = '09:00';
  value.days[0].stops[0].endTime = null;
  assert.ok(codes(value).includes('TIME_OVERLAP'));
  value.days[0].stops = [stop('09:00', '11:00'), stop('10:00', null)];
  assert.ok(codes(value).includes('TIME_OVERLAP'));
  value.days[0].stops = [stop('23:00', '01:00')];
  assert.ok(codes(value).includes('INVALID_VISIT_INTERVAL'));
});

test('actual driving duration checks per-leg/day limits and schedule feasibility; unknown is never zero', () => {
  const value = plan(); value.days[0].stops = [stop('09:00', '10:00'), stop('10:20', '11:00'), stop('14:00', '15:00')];
  value.days[0].stops[0].route = { available: true, durationMs: 31 * 60000 };
  value.days[0].stops[1].route = { available: true, durationMs: 30 * 60000 };
  for (const code of ['LONG_DRIVE', 'LONG_DAILY_DRIVE', 'TRAVEL_TIME_CONFLICT']) assert.ok(codes(value).includes(code));
  value.days[0].stops[0].route = { available: false, durationMs: null };
  assert.ok(codes(value).includes('ROUTES_UNKNOWN'));
  assert.ok(!codes(value).includes('TRAVEL_TIME_CONFLICT'));
  value.days[0].stops[1].route.durationMs = 61 * 60000;
  assert.ok(validateItinerary(value, { ...input, maxTravelMinutesPerLeg: null }).issues.some((issue) => issue.code === 'LONG_DRIVE' && issue.defaultLimit));
});

test('date-specific confirmed hours support split shifts and closed days; unverified hours remain unknown', () => {
  const value = plan();
  value.days[0].stops[0].openingHours.intervals = [{ open: '09:00', close: '10:30' }, { open: '13:00', close: '18:00' }];
  assert.ok(codes(value).includes('OPENING_HOURS_CONFLICT'));
  value.days[0].stops[0].openingHours.intervals = [];
  assert.ok(codes(value).includes('OPENING_HOURS_CONFLICT'));
  value.days[0].stops[0].openingHours.date = '2026-11-25';
  assert.ok(codes(value).includes('OPENING_HOURS_UNKNOWN'));
  assert.ok(!codes(value).includes('OPENING_HOURS_CONFLICT'));
  value.days[0].stops[0].openingHours = { ...hours(), sourceUrl: 'javascript:alert(1)' };
  assert.ok(codes(value).includes('OPENING_HOURS_UNKNOWN'));
});

test('rainy outdoor visits conflict; shifting to fully provided dry hours clears warning; sparse hours stay unknown', () => {
  const value = plan(); const day = value.days[0];
  day.stops[0].environment = { type: 'outdoor', basis: '검색 카테고리' };
  day.weather = { available: true, rainExpected: true, indoorSuggested: true, hourly: [{ time: '10:00', precipitationTypeCode: 1, precipitationProbabilityPct: 80 }, { time: '14:00', precipitationTypeCode: 0, precipitationProbabilityPct: 10 }] };
  assert.ok(codes(value).includes('WEATHER_PLACE_CONFLICT'));
  day.stops[0].time = '14:00'; day.stops[0].endTime = '15:00';
  assert.ok(!codes(value).includes('WEATHER_PLACE_CONFLICT'));
  day.stops[0].endTime = '17:00';
  assert.ok(codes(value).includes('WEATHER_PLACE_CONFLICT'));
  day.weather.rainExpected = false; day.weather.indoorSuggested = false;
  assert.ok(codes(value).includes('WEATHER_TIME_UNKNOWN'));
  day.stops[0].environment.type = 'unknown';
  assert.ok(codes(value).includes('PLACE_TYPE_UNKNOWN'));
});

test('change summaries report actual time/place/count changes and never claim unknown evidence resolved', () => {
  const before = plan(), after = plan(); after.days[0].stops[0].title = '실내 대안'; after.days[0].stops[0].time = '14:00';
  assert.equal(describePlanChanges(before, after).length, 2);
  assert.equal(describePlanChanges(before, before).length, 0);
});
