import { ToolError } from '../lib/tool-error.js';

const categoryLabels = { food: '식비', accommodation: '숙박비', transport: '교통비', activities: '관광비', other: '기타' };
const requiredCategories = ['food', 'accommodation', 'transport', 'activities'];
const validMoney = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000000;
const invalid = () => new ToolError(400, 'INVALID_BUDGET_INPUT', '예산과 금액은 0 이상의 원 단위 정수로 입력해 주세요. 가격 상태는 confirmed, estimated, unknown이며 미확인 금액은 null이어야 합니다.');

// Pure synchronous function: no network, environment, storage, SDK, or price inference.
export function calculate_budget(input) {
  if (!input || !validMoney(input.totalBudget) || !Array.isArray(input.items) || input.items.length > 200) throw invalid();
  const items = input.items.map((item) => {
    if (!item || !Object.hasOwn(categoryLabels, item.category) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 150) throw invalid();
    const status = item.status ?? (item.amount === null || item.amount === undefined ? 'unknown' : 'estimated');
    if (!['confirmed', 'estimated', 'unknown'].includes(status) ||
        (status === 'unknown' ? item.amount !== null && item.amount !== undefined : !validMoney(item.amount)) ||
        (item.source !== undefined && (typeof item.source !== 'string' || item.source.length > 250))) throw invalid();
    // 'confirmed' is the caller's assertion. It requires a source; this function does not verify a receipt.
    if (status === 'confirmed' && !item.source?.trim()) throw invalid();
    return { category: item.category, label: item.label.trim(), amount: status === 'unknown' ? null : item.amount,
      status, source: item.source?.trim() || null };
  });
  // An omitted category is unknown, never silently free. Day trips should supply confirmed/estimated 0 lodging.
  for (const category of requiredCategories) {
    if (!items.some((item) => item.category === category)) items.push({ category, label: `${categoryLabels[category]} 미입력`, amount: null, status: 'unknown', source: null });
  }
  const confirmedTotal = items.filter((item) => item.status === 'confirmed').reduce((sum, item) => sum + item.amount, 0);
  const estimatedTotal = items.filter((item) => item.status === 'estimated').reduce((sum, item) => sum + item.amount, 0);
  const unknownCount = items.filter((item) => item.status === 'unknown').length;
  const pricedSubtotal = confirmedTotal + estimatedTotal;
  const status = unknownCount ? 'incomplete' : items.some((item) => item.status === 'estimated') ? 'estimated' : 'confirmed';
  const categories = Object.entries(categoryLabels).filter(([category]) => items.some((item) => item.category === category)).map(([category, label]) => {
    const group = items.filter((item) => item.category === category);
    const subtotal = group.reduce((sum, item) => sum + (item.amount ?? 0), 0);
    const hasUnknown = group.some((item) => item.status === 'unknown');
    return { category, label, pricedSubtotal: subtotal, total: hasUnknown ? null : subtotal,
      status: hasUnknown ? 'incomplete' : group.some((item) => item.status === 'estimated') ? 'estimated' : 'confirmed' };
  });
  return { currency: 'KRW', totalBudget: input.totalBudget, items, categories, confirmedTotal, estimatedTotal, unknownCount, pricedSubtotal,
    total: unknownCount ? null : pricedSubtotal,
    remainingBudget: unknownCount ? null : input.totalBudget - pricedSubtotal,
    remainingAfterPricedItems: input.totalBudget - pricedSubtotal,
    status, overBudget: pricedSubtotal > input.totalBudget ? true : unknownCount ? null : false,
    message: unknownCount ? '미확인 가격이 있어 전체 비용과 최종 잔여 예산은 미확인입니다. 금액이 입력된 항목까지만 합산했습니다.'
      : status === 'estimated' ? '추정치가 포함된 예상 합계와 예상 잔여 예산입니다.' : '입력자가 확인한 금액을 기준으로 계산했습니다.' };
}
