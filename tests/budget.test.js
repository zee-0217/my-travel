import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculate_budget } from '../src/tools/calculate-budget.js';

const items = [
  { category: 'food', label: '식비', amount: 100000, status: 'confirmed', source: '테스트 영수증' },
  { category: 'accommodation', label: '숙박비', amount: 200000, status: 'confirmed', source: '테스트 예약서' },
  { category: 'transport', label: '교통비', amount: 50000, status: 'estimated' },
  { category: 'activities', label: '관광비', amount: 30000, status: 'estimated' },
];

test('calculate_budget sums all categories and distinguishes confirmed and estimated amounts', () => {
  const result = calculate_budget({ totalBudget: 500000, items });
  assert.equal(result.confirmedTotal, 300000);
  assert.equal(result.estimatedTotal, 80000);
  assert.equal(result.total, 380000);
  assert.equal(result.remainingBudget, 120000);
  assert.equal(result.status, 'estimated');
  assert.equal(result.overBudget, false);
  assert.equal(result.categories.find((row) => row.category === 'transport').status, 'estimated');
});

test('unknown prices stay null and cannot imply a final remaining budget', () => {
  const result = calculate_budget({ totalBudget: 500000, items: [...items.slice(0, 3), { category: 'activities', label: '관광비', amount: null, status: 'unknown' }] });
  assert.equal(result.pricedSubtotal, 350000);
  assert.equal(result.total, null);
  assert.equal(result.remainingBudget, null);
  assert.equal(result.remainingAfterPricedItems, 150000);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.overBudget, null);
  assert.equal(result.items[3].amount, null);
});

test('omitted categories stay unknown; explicit zero and wholly confirmed budgets work', () => {
  const empty = calculate_budget({ totalBudget: 0, items: [] });
  assert.equal(empty.unknownCount, 4);
  assert.equal(empty.total, null);
  const confirmed = calculate_budget({ totalBudget: 300000, items: items.map((item) => ({ ...item, status: 'confirmed', source: '사용자 확인', amount: item.category === 'accommodation' ? 0 : item.amount })) });
  assert.equal(confirmed.total, 180000);
  assert.equal(confirmed.remainingBudget, 120000);
  assert.equal(confirmed.status, 'confirmed');
  const implicit = calculate_budget({ totalBudget: 300000, items: items.map(({ status, ...item }) => item) });
  assert.equal(implicit.status, 'estimated');
  assert.equal(implicit.confirmedTotal, 0);
});

test('overspending is detected even before unknown prices are resolved', () => {
  const result = calculate_budget({ totalBudget: 100000, items: items.slice(0, 2) });
  assert.equal(result.total, null);
  assert.equal(result.overBudget, true);
  assert.equal(result.remainingAfterPricedItems, -200000);
  const full = calculate_budget({ totalBudget: 100000, items });
  assert.equal(full.remainingBudget, -280000);
});

test('invalid money/status/source is rejected without changing caller data', () => {
  const original = structuredClone(items);
  calculate_budget({ totalBudget: 500000, items });
  assert.deepEqual(items, original);
  for (const changed of [{ amount: -1 }, { amount: '1000' }, { amount: 1.5 }, { amount: NaN }, { status: 'unknown', amount: 1000 }, { status: 'confirmed', source: '' }, { status: 'free' }, { category: '__proto__' }]) {
    assert.throws(() => calculate_budget({ totalBudget: 500000, items: [{ ...items[0], ...changed }] }), (error) => error.code === 'INVALID_BUDGET_INPUT');
  }
  assert.throws(() => calculate_budget({ totalBudget: -1, items }));
});
