import { requestPlaces } from './api.js';
import { selectRoutePlace } from './routes.js';

const form = document.querySelector('#place-search-form');
const keywordInput = document.querySelector('#place-keyword');
const regionInput = document.querySelector('#region');
const results = document.querySelector('#place-results');
const status = document.querySelector('#place-search-status');
const errorBox = document.querySelector('#place-search-error');
const cancelButton = document.querySelector('#place-cancel-button');
const quickButtons = document.querySelectorAll('[data-place-keyword]');
let pending;
let planner;
export function initPlacePlanner(config) { planner = config; refreshPlacePlanner(); }
export function refreshPlacePlanner() {
  document.querySelectorAll('.place-itinerary-controls').forEach((group) => {
    const select = group.querySelector('select'), selected = select.value;
    const trip = planner?.getTrip();
    select.replaceChildren(...(trip?.days || []).map((day, index) => { const option = node('option', '', `${index + 1}일차 · ${day.date}`); option.value = String(index); return option; }));
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
    group.querySelectorAll('button, select, input').forEach((control) => { control.disabled = !trip || Boolean(planner?.isBusy()); });
  });
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function updateRegion() {
  document.querySelector('#place-region-label').textContent = regionInput.value.trim() || '여행 지역을 입력해 주세요';
}
regionInput.addEventListener('input', updateRegion);
document.querySelector('#reset-button').addEventListener('click', () => queueMicrotask(updateRegion));
updateRegion();

function setBusy(busy) {
  form.querySelectorAll('input, button').forEach((control) => { control.disabled = busy; });
  quickButtons.forEach((button) => { button.disabled = busy; });
  cancelButton.hidden = !busy;
  results.setAttribute('aria-busy', String(busy));
  document.querySelector('#place-search-button').textContent = busy ? '검색 중…' : '장소 검색 ↗';
}

function addDetail(list, label, value) {
  const row = node('div', 'place-detail-row');
  row.append(node('dt', '', label), node('dd', '', value || 'API에서 제공하지 않음'));
  list.append(row);
}

function renderPlaces(data) {
  results.replaceChildren();
  status.textContent = `“${data.query}” · NAVER 검색 결과 ${data.returnedCount}개`;
  if (!data.places.length) {
    results.append(node('p', 'place-empty', '검색 결과가 없어요. 지역명이나 키워드를 바꿔 다시 검색해 주세요.'));
    return;
  }
  data.places.forEach((place, index) => {
    const card = node('article', 'place-card');
    card.append(node('span', 'place-result-label', `NAVER SEARCH · ${String(index + 1).padStart(2, '0')}`), node('h4', '', place.name || 'API에서 장소명 미제공'));
    const details = node('dl', 'place-details');
    addDetail(details, '카테고리', place.category);
    addDetail(details, '도로명 주소', place.roadAddress);
    addDetail(details, '지번 주소', place.address);
    const coordinates = place.coordinates;
    const hasCoordinates = Number.isFinite(coordinates?.longitude) && Number.isFinite(coordinates?.latitude);
    addDetail(details, 'WGS84 좌표', hasCoordinates ? `경도 ${coordinates.longitude} / 위도 ${coordinates.latitude}` : '좌표 미제공 또는 형식 확인 필요');
    card.append(details);
    const actions = node('div', 'place-route-actions');
    for (const [slot, label] of [['start', '출발지로 선택'], ['goal', '도착지로 선택']]) {
      const button = node('button', 'outline-button', label);
      button.type = 'button';
      button.disabled = !hasCoordinates;
      button.setAttribute('aria-label', `${place.name || '장소'} ${label}`);
      button.addEventListener('click', () => selectRoutePlace(slot, place));
      actions.append(button);
    }
    card.append(actions);
    const group = node('div', 'place-itinerary-controls');
    const dayLabel = node('label', 'field', '추가할 날짜'), day = node('select'); dayLabel.append(day);
    const timeLabel = node('label', 'field', '방문 시각'), time = node('input'); time.type = 'time'; time.value = '18:00'; timeLabel.append(time);
    const endLabel = node('label', 'field', '종료 시각'), end = node('input'); end.type = 'time'; end.value = '19:00'; endLabel.append(end);
    const add = node('button', 'primary-button place-add-button', '＋ 일정에 추가'); add.type = 'button';
    const feedback = node('p', 'panel-note place-add-feedback'); feedback.setAttribute('role', 'status');
    add.addEventListener('click', async () => {
      if (!planner || planner.isBusy()) return;
      try {
        add.disabled = true; feedback.textContent = '일정에 추가하고 있어요…';
        const result = await planner.addPlace({ place, query: data.query, searchId: data.searchId, searchToken: data.searchToken, index, dayIndex: Number(day.value), time: time.value, endTime: end.value });
        feedback.textContent = result;
      } catch (error) { feedback.textContent = error.message; }
      finally { refreshPlacePlanner(); }
    });
    group.append(dayLabel, timeLabel, endLabel, add, feedback); card.append(group);
    if (coordinates?.raw && (coordinates.raw.mapx !== null || coordinates.raw.mapy !== null)) {
      const raw = node('details', 'place-raw');
      raw.append(node('summary', '', 'API 원본 좌표 보기'), node('p', '', `mapx: ${coordinates.raw.mapx ?? '미제공'} / mapy: ${coordinates.raw.mapy ?? '미제공'}`));
      card.append(raw);
    }
    if (place.link) {
      // Defense in depth: only provider-supplied HTTP(S) links may be opened.
      try {
        const url = new URL(place.link);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
          const link = node('a', 'place-link', '업체 제공 링크 ↗');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          card.append(link);
        }
      } catch { /* Missing or invalid provider links are not replaced with made-up URLs. */ }
    }
    results.append(card);
  });
  refreshPlacePlanner();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending) return;
  const region = regionInput.value.trim();
  const keyword = keywordInput.value.trim();
  if (!region || !keyword) {
    errorBox.textContent = '위의 여행 지역과 아래 검색 키워드를 모두 입력해 주세요.';
    errorBox.hidden = false;
    (region ? keywordInput : regionInput).focus();
    return;
  }
  const controller = new AbortController();
  pending = controller;
  results.replaceChildren();
  errorBox.hidden = true;
  status.textContent = `“${region} ${keyword}” 검색 중…`;
  setBusy(true);
  try {
    const data = await requestPlaces({ region, keyword }, { signal: controller.signal });
    if (!controller.signal.aborted) renderPlaces(data);
  } catch (error) {
    if (controller.signal.aborted) status.textContent = '장소 검색을 취소했어요.';
    else {
      status.textContent = '검색을 완료하지 못했어요.';
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  } finally {
    pending = undefined;
    setBusy(false);
  }
});
quickButtons.forEach((button) => button.addEventListener('click', () => {
  keywordInput.value = button.dataset.placeKeyword;
  form.requestSubmit();
}));
cancelButton.addEventListener('click', () => pending?.abort());
