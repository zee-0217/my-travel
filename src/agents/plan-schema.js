import { PlanError } from '../lib/plan-error.js';

const categories = ['맛집', '관광', '자연', '휴식', '쇼핑'];
const invalidInput = () => new PlanError(400, 'INVALID_INPUT', '여행 조건을 확인해 주세요. 지역, 출발일, 1~7일 기간, 1~20명 인원, 1만~1억원 예산이 필요해요.');

export const sameRegionName = (left, right) => {
  const normalize = (value) => String(value).normalize('NFKC').replace(/\s+/g, '').replace(/특별자치도|특별자치시|특별시|광역시/g, '').replace(/[시도]$/, '');
  return normalize(left) === normalize(right);
};

export function addPlanDays(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function validatePlanInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidInput();
  const { region, startDate, duration, travelers, budget, transport, preferences = [], requests = '' } = body;
  const { maxPlacesPerDay = 4, maxTravelMinutesPerLeg = null, maxTravelMinutesPerDay = null } = body;
  const { lodgingMode = 'recommend', lodgingType = 'any', lodgingBudget = null } = body;
  if (!['recommend', 'none'].includes(lodgingMode) || !['any', 'hotel', 'pension', 'guesthouse', 'resort'].includes(lodgingType) || lodgingBudget !== null && (!Number.isInteger(lodgingBudget) || lodgingBudget < 10000 || lodgingBudget > 100000000)) throw new PlanError(400, 'INVALID_INPUT', '숙소 유형과 숙박 총예산을 확인해 주세요. 숙박 예산은 전체 인원·전체 숙박 기간 합계로 1만원 이상 입력하거나 비워 둘 수 있어요.');
  if (!Number.isInteger(maxPlacesPerDay) || maxPlacesPerDay < 1 || maxPlacesPerDay > 6 ||
      ![maxTravelMinutesPerLeg, maxTravelMinutesPerDay].every((value, index) => value === null || Number.isInteger(value) && value >= 5 && value <= (index ? 600 : 180))) throw new PlanError(400, 'INVALID_INPUT', '하루 최대 방문 수는 1~6곳, 구간 이동 제한은 5~180분, 하루 이동 합계 제한은 5~600분으로 입력해 주세요. 이동 제한은 비워 둘 수 있어요.');
  if (typeof region !== 'string' || !region.trim() || region.trim().length > 40 ||
      typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !Number.isFinite(Date.parse(`${startDate}T12:00:00Z`)) || addPlanDays(startDate, 0) !== startDate ||
      startDate < '2000-01-01' || startDate > '2100-12-24' ||
      !Number.isInteger(duration) || duration < 1 || duration > 7 ||
      !Number.isInteger(travelers) || travelers < 1 || travelers > 20 ||
      !Number.isInteger(budget) || budget < 10000 || budget > 100000000 ||
      !['car', 'rental', 'transit'].includes(transport) ||
      !Array.isArray(preferences) || preferences.length > 5 || !preferences.every((item) => categories.includes(item)) ||
      typeof requests !== 'string' || requests.length > 500) throw invalidInput();
  // Explicitly whitelist fields. Client-supplied model, keys, prompts, or tools are ignored.
  if (lodgingBudget !== null && lodgingBudget > budget) throw new PlanError(400, 'INVALID_INPUT', '숙박 예산 상한은 여행 총예산보다 클 수 없어요.');
  return { region: region.trim(), startDate, duration, travelers, budget, transport, preferences: [...new Set(preferences)], requests: requests.trim(), maxPlacesPerDay, maxTravelMinutesPerLeg, maxTravelMinutesPerDay, lodgingMode, lodgingType, lodgingBudget };
}

