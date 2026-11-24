import { requestRoute } from './api.js';

const selected = { start: null, goal: null };
const button = document.querySelector('#route-search-button');
const cancel = document.querySelector('#route-cancel-button');
const result = document.querySelector('#route-result');
let pending;

function renderSelection() {
  for (const slot of ['start', 'goal']) document.querySelector(`#route-${slot}`).textContent = selected[slot]?.name || '검색 결과에서 선택해 주세요';
  button.disabled = Boolean(pending) || !selected.start || !selected.goal;
  button.textContent = pending ? '자동차 경로 확인 중…' : '자동차 경로 확인 ↗';
  cancel.hidden = !pending;
}

export function selectRoutePlace(slot, place) {
  if (!['start', 'goal'].includes(slot) || !Number.isFinite(place.coordinates?.longitude) || !Number.isFinite(place.coordinates?.latitude)) return;
  pending?.abort();
  selected[slot] = { name: place.name || '장소명 미제공', longitude: place.coordinates.longitude, latitude: place.coordinates.latitude };
  result.textContent = '두 장소를 고른 뒤 자동차 경로를 확인해 주세요.';
  result.classList.remove('route-unavailable');
  renderSelection();
}

button.addEventListener('click', async () => {
  if (pending || !selected.start || !selected.goal) return;
  const controller = new AbortController();
  pending = controller;
  renderSelection();
  result.textContent = 'NAVER Maps에서 자동차 경로를 조회하고 있어요…';
  result.classList.remove('route-unavailable');
  try {
    const route = await requestRoute({ start: selected.start, goal: selected.goal, mode: 'driving' }, { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (!route.available) {
      result.textContent = route.message || '자동차 경로 확인 불가';
      result.classList.add('route-unavailable');
    } else {
      result.textContent = `자동차 ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(route.distanceKm)} km · 예상 약 ${Math.ceil(route.durationMinutes)}분. 조회 시점 교통 상황에 따라 달라질 수 있어요.`;
    }
  } catch (error) {
    result.textContent = controller.signal.aborted ? '경로 조회를 취소했어요.' : error.message;
    result.classList.toggle('route-unavailable', !controller.signal.aborted);
  } finally {
    pending = undefined;
    renderSelection();
  }
});
cancel.addEventListener('click', () => pending?.abort());
renderSelection();
