import assert from 'node:assert/strict';
import { calculate_budget } from '../src/tools/calculate-budget.js';

const items = [
  { category: 'food', label: '2인 식비', amount: 120000, status: 'estimated', source: '사용자가 입력한 예상 금액' },
  { category: 'accommodation', label: '숙박', amount: 180000, status: 'confirmed', source: '테스트용 예약 금액 (실제 예약 아님)' },
  { category: 'transport', label: '주유·주차', amount: 50000, status: 'estimated', source: '사용자가 입력한 예상 금액' },
  { category: 'activities', label: '관광비', amount: null, status: 'unknown' },
];
const partial = calculate_budget({ totalBudget: 500000, items });
assert.equal(partial.pricedSubtotal, 350000);
assert.equal(partial.remainingBudget, null);
assert.equal(partial.remainingAfterPricedItems, 150000);
console.log(JSON.stringify({ case: '관광비 미확인', result: partial }, null, 2));
const complete = calculate_budget({ totalBudget: 500000, items: [...items.slice(0, 3), { category: 'activities', label: '관광비', amount: 30000, status: 'estimated', source: '사용자 예상' }] });
assert.equal(complete.total, 380000);
assert.equal(complete.remainingBudget, 120000);
assert.equal(complete.status, 'estimated');
console.log(JSON.stringify({ case: '추정 관광비 입력 후', result: complete }, null, 2));
