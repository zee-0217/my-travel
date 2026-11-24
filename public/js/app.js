import { createSampleTrip, addDays, formatDate, money, transportLabels } from './sample-data.js';
import { requestTravelPlan, requestPlanEdit, requestAddPlace } from './api.js';
import { initPlacePlanner, refreshPlacePlanner } from './places.js';
import { appendLocalPlace } from './add-place.js';
import { createTripMap, validPoint } from './trip-map.js';
import { initRegionPicker } from './region-picker.js';
import { renderServiceStatus } from './service-status.js';
import { initSavedTrips, downloadSavedTrip } from './saved-trips-ui.js';
import { chooseDestination, showDestination, getCurrentDestination, initDestinationCarousel } from './travel-inspiration.js';
import { parseMoney, initMoneyInputs, formatMoneyInputs } from './money-input.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#trip-form');
let trip;
let activeDay = 0;
let toastTimer;
let pendingRequest;
let previousTrip;
let previousActiveDay = 0;
let chatMessages = [];
let selectedLodgingId = null;
let elapsedTimer;
let savedTripsUi;
let loadedSavedAt = null;
let queuedPlaces = [];
let previousQueuedPlaces = [];
const tripMap = createTripMap({ onSelect: (index, item) => item?.kind === 'lodging' ? selectLodging(item.id) : selectStop(index) });

function renderTrace(trace = []) {
  $('#agent-log').replaceChildren(...trace.map((entry, index) => {
    const row = element('li');
    row.dataset.status = entry.status;
    row.append(element('span', 'log-step', `CALL ${index + 1} · ${entry.executed === false ? '실행 전 거부' : entry.status === 'cancelled' ? '취소' : entry.status === 'success' ? '완료' : entry.status === 'unavailable' ? '확인 불가' : '오류'}`), element('h4', '', entry.tool), element('p', '', entry.summary));
    return row;
  }));
  if (!trace.length) $('#agent-log').append(element('li', 'muted', '이 요청에서는 실행된 Tool이 없습니다.'));
}

// All user-provided text is inserted as text, never as HTML.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);
}

function readForm() {
  const values = new FormData(form);
  return {
    region: values.get('region'), startDate: values.get('startDate'),
    duration: Number(values.get('duration')), travelers: Number(values.get('travelers')),
    budget: parseMoney(values.get('budget')), transport: values.get('transport'),
    preferences: values.getAll('preferences'), requests: values.get('requests'),
    maxPlacesPerDay: Number(values.get('maxPlacesPerDay') || 4),
    maxTravelMinutesPerLeg: values.get('maxTravelMinutesPerLeg') ? Number(values.get('maxTravelMinutesPerLeg')) : null,
    maxTravelMinutesPerDay: values.get('maxTravelMinutesPerDay') ? Number(values.get('maxTravelMinutesPerDay')) : null,
    lodgingMode: values.get('lodgingMode'), lodgingType: values.get('lodgingType'), lodgingBudget: Number(values.get('duration')) > 1 && values.get('lodgingMode') !== 'none' && values.get('lodgingBudget') ? parseMoney(values.get('lodgingBudget')) : null,
  };
}

function selectStop(index) {
  $('#timeline').querySelectorAll('.timeline-item').forEach((node, i) => node.classList.toggle('is-selected', index === i));
  $('#map-markers').querySelectorAll('button').forEach((node, i) => node.setAttribute('aria-pressed', String(index === i)));
  const stop = trip.days[activeDay].stops[index];
  $('#map-selection').textContent = `${index + 1}. ${stop.title} · ${stop.time} · ${stop.stay}`;
  tripMap.select(index);
}

function renderDay() {
  const day = trip.days[activeDay];
  $('#day-tabs').querySelectorAll('button').forEach((button, index) => {
    button.setAttribute('aria-selected', String(index === activeDay));
    button.tabIndex = index === activeDay ? 0 : -1;
  });
  $('#day-panel').setAttribute('aria-labelledby', `day-tab-${activeDay}`);
  $('#day-kicker').textContent = `DAY ${String(activeDay + 1).padStart(2, '0')} · ${formatDate(day.date)}`;
  $('#day-title').textContent = day.title;
  $('#day-transport').textContent = `${transportLabels[trip.transport]} 중심 · ${day.stops.length}개 장소`;
  const weather = day.weather;
  const weatherBox = $('#day-weather');
  weatherBox.replaceChildren();
  weatherBox.dataset.risk = weather?.available && weather.indoorSuggested ? 'rain' : 'neutral';
  weatherBox.append(element('strong', '', weather?.available ? weather.rainExpected === true ? '☂ 비 예보 · 실내 대안 권장' : weather.indoorSuggested ? '☂ 강수 대비 실내 대안 권장' : '날씨 예보 확인' : '날씨 미확인'));
  if (weather?.available) {
    const details = [weather.location?.label, weather.precipitationProbabilityMax == null ? '강수확률 미제공' : `제공 시간대 최대 강수확률 ${weather.precipitationProbabilityMax}%`, weather.temperatureRangeC ? `제공 시간대 기온 ${weather.temperatureRangeC.min}~${weather.temperatureRangeC.max}°C` : '기온 미제공'].filter(Boolean);
    weatherBox.append(element('p', '', details.join(' · ')));
    weatherBox.append(element('p', 'weather-note', `발표 ${weather.issuedAt?.replace('T', ' ').replace(':00+09:00', ' KST') || '시각 미확인'} · 미제공 시간대는 미확인${weather.location?.representative ? ' · 지역 전체를 대표하는 예보가 아닙니다.' : ''}`));
    if (weather.indoorSuggested) weatherBox.append(element('p', 'weather-note', '실내 권장은 강수 예보 또는 최대 강수확률 60% 이상을 기준으로 한 계획 제안입니다. 장소의 실내 여부는 상세 안내를 확인해 주세요.'));
  } else weatherBox.append(element('p', '', weather?.message || (trip.isSample ? '미리보기에서는 날씨 API를 호출하지 않습니다.' : '이 날짜의 날씨 도구가 호출되지 않았습니다.')));
  if (['https://apihub.kma.go.kr/apiList.do?seqApi=10', 'https://open-meteo.com/en/docs'].includes(weather?.source?.url)) {
    const link = element('a', '', `출처: ${weather.source.name}`); link.href = weather.source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; weatherBox.append(link);
  }
  if (weather?.fallback) weatherBox.append(element('p', 'weather-note', weather.fallback.message));
  const limits = day.travelConstraints;
  $('#day-constraints').textContent = trip.isSample ? '이동시간 제한은 실제 경로 조회 후 확인할 수 있어요.' : limits ? `${trip.maxPlacesPerDay || 4}곳 이내 · 구간 제한 ${trip.maxTravelMinutesPerLeg == null ? '미지정' : `${trip.maxTravelMinutesPerLeg}분`} · 하루 합계 제한 ${trip.maxTravelMinutesPerDay == null ? '미지정' : `${trip.maxTravelMinutesPerDay}분`} · ${limits.status === 'exceeded' ? '⚠ 실제 이동시간이 제한을 초과해요.' : limits.unknownLegs ? `미조회 ${limits.unknownLegs}구간 · 제한 충족 여부 미확인` : `확인된 구간 합계 ${limits.knownDurationMinutes}분${trip.maxTravelMinutesPerLeg != null || trip.maxTravelMinutesPerDay != null ? ' · 제한 이내' : ''}`}` : '이동시간 제한 확인 정보가 없습니다.';
  $('#day-constraints').classList.toggle('limit-exceeded', limits?.status === 'exceeded');
  $('#timeline').replaceChildren();
  $('#map-markers').replaceChildren();
  day.stops.forEach((stop, index) => {
    const row = element('li', 'timeline-item');
    row.append(element('span', 'stop-number', index + 1));
    const detail = element('div', 'stop-detail');
    const top = element('div', 'stop-topline');
    top.append(element('span', 'stop-time', `${stop.time}${stop.endTime ? `~${stop.endTime}` : ''}`), element('span', 'stop-category', stop.category));
    detail.append(top, element('h5', 'stop-title', stop.title), element('span', 'reason-label', '추천 이유'), element('p', 'stop-description', stop.description), element('p', 'stop-meta', stop.stay));
    if (stop.place) {
      detail.append(element('p', 'stop-address', stop.place.roadAddress || stop.place.address || '주소 미제공'));
      const source = element('div', 'place-provenance');
      source.append(element('span', '', `출처: ${stop.place.source?.name || 'NAVER API HUB 지역 검색'}${stop.place.source?.query ? ` · 검색어: ${stop.place.source.query}` : ''}`));
      if (stop.place.link) {
        try {
          const url = new URL(stop.place.link);
          if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
            const link = element('a', '', '검색 결과 업체 웹사이트');
            link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; source.append(link);
          }
        } catch { /* Invalid upstream links are omitted. */ }
      }
      detail.append(source);
      const hours = stop.openingHours;
      if (hours) {
        detail.append(element('p', 'stop-meta', `공식 등록 운영시간: ${hours.text} · 휴무: ${hours.restText || '미제공'}`));
        detail.append(element('p', 'panel-note', `${hours.status === 'confirmed' ? '명확한 정규 운영시간으로 일정 검증에 반영' : '복잡한 운영 규칙 · 방문시간 적합성 확인 필요'} · ${hours.note || ''}`));
        appendTourSource(detail, { url: hours.sourceUrl, checkedAt: hours.checkedAt });
      }
      if (!trip.isSample) detail.append(detailsButton(`${stop.title}의 ${day.date} 공식 영업시간과 휴무를 확인해 줘. 필요한 충돌 수정 외에 나머지 일정은 유지해 줘.`, activeDay));
    } else detail.append(element('p', 'place-unverified', trip.isSample ? '샘플 일정 · 실제 검색 전' : '장소 검색 미확인 · Agent 제안'));
    if (stop.personalNote) detail.append(element('p', 'request-note', `나의 메모: ${stop.personalNote}`));
    if (index < day.stops.length - 1) detail.append(element('div', 'travel-leg', stop.transfer));
    row.append(detail);
    $('#timeline').append(row);
    const marker = element('button', 'map-stop-button');
    marker.type = 'button';
    marker.setAttribute('aria-label', `${index + 1}번 장소: ${stop.title}`);
    marker.append(element('span', '', index + 1));
    marker.addEventListener('click', () => selectStop(index));
    $('#map-markers').append(marker);
  });
  selectStop(0);
  const stays = (trip.lodgings?.candidates || []).filter((stay) => stay.nightIndexes.some((night) => night === activeDay || night + 1 === activeDay));
  const chosen = stays.find((stay) => stay.id === selectedLodgingId);
  void tripMap.update({ ...day, lodgings: stays.map((stay) => ({ id: stay.id, title: stay.name, place: stay.place })), lodgingRoutes: chosen?.comparisons.filter((item) => item.dayIndex === activeDay).map((item) => item.route).filter(Boolean) || [] });
}

function renderTrip() {
  refreshPlacePlanner();
  savedTripsUi?.refreshControls();
  $('#saved-plan-notice').hidden = !loadedSavedAt && !trip.localEditedAt;
  $('#saved-plan-notice').textContent = trip.localEditedAt ? '직접 수정한 저장 일정입니다. JavaScript 검증을 다시 적용했으며, API 재조회나 자동 재계획은 실행하지 않았어요.' : loadedSavedAt ? `저장된 일정 · ${new Date(loadedSavedAt).toLocaleString('ko-KR')} 기준입니다. 예보·요금·경로는 저장 시점의 자료이며 최신 정보는 다시 확인해 주세요.` : '';
  $('#personal-trip-note').hidden = !trip.personalNote;
  $('#personal-trip-note').textContent = trip.personalNote ? `나의 여행 메모: ${trip.personalNote}` : '';
  renderValidation();
  renderChat();
  renderLodgings();
  const duration = trip.duration === 1 ? '당일치기' : `${trip.duration - 1}박 ${trip.duration}일`;
  $('#results-title').textContent = trip.title || (trip.region === '강릉' ? '바다 바람 따라, 강릉으로' : `${trip.region}, 우리 취향으로 채우는 여행`);
  $('#result-source').textContent = trip.isSample ? 'SAMPLE' : 'AI PLAN';
  $('#result-notice').textContent = trip.isSample ? '생성 전 미리보기입니다. 샘플 장소와 금액이며 추가 요청은 반영되지 않았어요. AI 여행 계획 만들기를 눌러 나만의 일정을 받아보세요.' : trip.disclaimer;
  $('#ai-summary').hidden = !trip.summary;
  $('#ai-summary').textContent = trip.summary || '';
  $('#plan-warnings').hidden = !trip.warnings?.length;
  $('#plan-warnings').replaceChildren(...(trip.warnings || []).map((warning) => element('li', '', warning)));
  $('#budget-source').textContent = trip.isSample ? '전체 인원 · 샘플' : trip.total === null ? '전체 인원 · 미확인' : '전체 인원 · 도구 계산';
  $('#log-source').textContent = trip.isSample ? '미리보기' : loadedSavedAt ? '저장된 기록' : trip.edit ? '수정 완료' : '생성 완료';
  $('#log-description').textContent = trip.isSample ? '현재 표시된 샘플의 구성 흐름입니다. AI 생성은 버튼을 눌렀을 때 실행됩니다.' : loadedSavedAt ? '저장 당시의 실제 Tool 실행 기록입니다. 다시 열기·직접 수정은 Tool을 새로 호출하지 않습니다.' : '최근 Agent 요청에서 실제로 호출된 도구와 실행 결과입니다. 호출하지 않은 도구는 표시하지 않습니다.';
  $('#trip-summary').textContent = `${formatDate(trip.startDate, true)} 출발 · ${duration} · ${trip.travelers}명 · ${transportLabels[trip.transport]} · 총예산 ${money(trip.budget)}`;
  $('#itinerary-count').textContent = `${trip.duration}일의 작은 여정`;
  $('#day-tabs').replaceChildren();
  trip.days.forEach((day, index) => {
    const tab = element('button', 'day-tab', `DAY ${index + 1}`);
    tab.type = 'button';
    tab.id = `day-tab-${index}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'day-panel');
    tab.append(element('span', '', formatDate(day.date)));
    tab.addEventListener('click', () => { activeDay = index; renderDay(); });
    tab.addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      activeDay = event.key === 'Home' ? 0 : event.key === 'End' ? trip.duration - 1 : (activeDay + (event.key === 'ArrowRight' ? 1 : -1) + trip.duration) % trip.duration;
      renderDay();
      $(`#day-tab-${activeDay}`).focus();
    });
    $('#day-tabs').append(tab);
  });
  activeDay = 0;
  renderDay();

  $('#estimated-total').textContent = trip.total === null ? '미확인' : money(trip.total);
  $('#budget-remaining').textContent = trip.remaining === null ? `최종 잔여 예산 미확인${trip.budgetCalculation ? ` · 입력 금액 합계 ${money(trip.budgetCalculation.pricedSubtotal)}` : ''}` : trip.remaining >= 0 ? `잔여 예산 ${money(trip.remaining)}` : `총예산보다 ${money(-trip.remaining)} 초과해요`;
  $('#budget-remaining').classList.toggle('over-budget', trip.remaining < 0);
  const percent = trip.total === null ? 0 : Math.round(trip.total / trip.budget * 100);
  $('#budget-percent').textContent = trip.total === null ? '미확인' : `${percent}%`;
  const color = trip.remaining < 0 ? '#b17a50' : '#159bd6';
  $('#budget-donut').style.background = `conic-gradient(${color} ${Math.min(percent, 100) * 3.6}deg, #e3f2fb 0deg)`;
  $('#budget-list').replaceChildren(...trip.costs.map((cost) => {
    const row = element('tr');
    const status = cost.status === 'confirmed' ? '확인 금액' : cost.status === 'unknown' || cost.amount === null ? '미확인' : trip.isSample ? '샘플 추정' : '추정치';
    row.append(element('th', '', cost.label), element('td', '', cost.amount === null ? '미확인' : money(cost.amount)), element('td', 'price-status', status));
    return row;
  }));
  $('#budget-table-limit').textContent = money(trip.budget);
  $('#budget-table-total').textContent = trip.total === null ? '미확인' : money(trip.total);
  $('#budget-table-remaining').textContent = trip.remaining === null ? '미확인' : money(trip.remaining);
  $('#budget-footnote').textContent = trip.budgetNote || '샘플 추정 금액입니다. 실제 견적이 아닙니다.';

  const logs = trip.isSample ? [
    ['여행 조건 정리', `${trip.region} · ${duration} · ${trip.travelers}명. ${trip.preferences.join(', ') || '균형 잡힌 여행'} 취향을 확인했어요.`],
    ['샘플 장소 선택', trip.knownRegion ? '미리 준비한 지역별 장소 예시를 선택했어요. 실제 검색은 하지 않았어요.' : '등록된 지역 샘플이 없어 일반적인 장소 유형으로 구성했어요.'],
    ['날짜별 일정 구성', `${trip.duration}일 동안 하루 ${trip.days[0].stops.length}개 샘플 장소를 배치했어요. 샘플 장소는 순환하며 반복될 수 있어요.`],
    ['예산 확인', trip.total === null ? '검색 장소를 추가해 비용과 잔여 예산은 다시 확인해야 합니다.' : `샘플 단가로 합산한 비용은 ${money(trip.total)}. ${trip.remaining >= 0 ? '설정한 예산 이내예요.' : '예산 조정이 필요해요.'}`],
  ] : [];
  $('#agent-log').replaceChildren(...logs.map(([title, description], index) => {
    const row = element('li');
    row.append(element('span', 'log-step', `STEP 0${index + 1} · ${trip.isSample ? '샘플' : '완료'}`), element('h4', '', title), element('p', '', description));
    return row;
  }));
  if (!trip.isSample) renderTrace(trip.trace || []);
  $('#agent-sources').replaceChildren(...(trip.sources || []).map((source) => {
    const row = element('li');
    try {
      const url = new URL(source.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return row;
      const link = element('a', '', source.title || url.hostname);
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      row.append(link);
    } catch { /* Ignore invalid links. */ }
    return row;
  }));
  $('#agent-sources-section').hidden = !trip.sources?.length;
  $('#agent-source-count').textContent = `${trip.sources?.length || 0}개`;
  const citedSources = (trip.sources || []).filter((source) => source.cited);
  $('#summary-sources').replaceChildren(...citedSources.map((source, index) => {
    const link = element('a', '', `[${index + 1}] ${source.title}`);
    try {
      const url = new URL(source.url);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) { link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    } catch { /* Ignore invalid citations. */ }
    return link;
  }));
  $('#summary-sources').hidden = !citedSources.length;
  $('#request-note').hidden = !trip.requests;
  $('#request-note').textContent = `추가 요청 메모: ${trip.requests}\n${trip.isSample ? '미리보기에는 추가 요청이 반영되지 않습니다.' : 'AI에 전달한 요청입니다. 실제 반영 여부는 일정을 확인해 주세요.'}`;
}

function appendTourSource(container, source) {
  if (!source?.url || !source.checkedAt) return;
  try {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || url.hostname !== 'www.data.go.kr' || url.username || url.password) return;
    const link = element('a', 'panel-note', `출처: 한국관광공사 TourAPI · 조회 ${new Date(source.checkedAt).toLocaleString('ko-KR')}`);
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; container.append(link);
  } catch { /* Omit invalid provenance. */ }
}

function detailsButton(request, dayIndex) {
  const button = element('button', 'text-button public-info-button', '공식 공개정보 확인 요청'); button.type = 'button';
  button.disabled = !trip.planId;
  if (!trip.planId) button.title = '새 AI 일정을 생성하면 공식 정보를 다시 조회할 수 있어요.';
  button.addEventListener('click', () => {
    if (pendingRequest || trip.isSample || !trip.planId) return;
    $('#chat-request').value = request; $('#chat-day').value = dayIndex === null ? '' : String(dayIndex);
    $('#chat-request').focus(); $('#chat-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    notify('채팅 요청을 확인하고 보내면 공식 정보를 조회해요.');
  });
  return button;
}

function renderLodgings() {
  const data = trip.lodgings;
  const candidates = data?.candidates || [];
  if (!candidates.some((candidate) => candidate.id === selectedLodgingId)) selectedLodgingId = null;
  $('#lodging-status').textContent = trip.isSample ? '실제 검색 전' : data?.status === 'not_needed' ? '추천 제외' : candidates.length ? `${candidates.length}곳 비교` : '숙소 미확인';
  $('#lodging-planning').textContent = `여행 총예산 ${money(trip.budget)} · 숙박 상한 ${trip.lodgingBudget == null ? '미지정' : money(trip.lodgingBudget)} · 전체 인원 ${trip.travelers}명 · ${Math.max(0, trip.duration - 1)}박`;
  $('#lodging-note').textContent = trip.isSample ? '미리보기에서는 숙소나 요금을 만들지 않습니다. AI 여행 계획 생성 후 실제 검색 후보를 표시해요.' : `${data?.note || '이전 형식의 일정입니다. 채팅으로 숙소 추천을 요청해 주세요.'} ${(data?.warnings || []).join(' ')}`;
  $('#lodging-selection').textContent = '';
  $('#lodging-candidates').replaceChildren(...candidates.map((stay) => {
    const card = element('article', 'lodging-card'); card.dataset.stayId = stay.id;
    card.append(element('h4', '', stay.name), element('p', 'lodging-address', stay.place.roadAddress || stay.place.address || '주소 미제공'), element('p', '', `${stay.checkInDate} 체크인 ~ ${stay.checkOutDate} 체크아웃 · 추천 ${stay.nightIndexes.map((night) => `${night + 1}일차 밤`).join(', ')}`), element('p', '', stay.reason));
    const price = stay.price.status === 'confirmed' ? `확인된 후보 기간 숙박비 ${money(stay.price.totalAmount)} · 전체 인원 기준` : '숙박 요금 미확인';
    card.append(element('p', 'lodging-price', `${price} · ${stay.availability?.message || '예약 가능 여부 미확인'}`));
    if (stay.publishedRates?.length) {
      const published = element('details', 'published-rates'); published.append(element('summary', '', '공식 등록 참고 요금표 · 실요금 아님'));
      published.append(element('p', 'panel-note', '선택 날짜·인원·객실 조건의 견적이 아닙니다. 예산 합계에 포함하지 않습니다.'));
      const table = element('table', 'budget-table'); table.append(element('caption', '', '객실별 공개 참고 요금 (KRW)'));
      const body = element('tbody'); stay.publishedRates.forEach((rate) => { const row = element('tr'); row.append(element('th', '', `${rate.roomName} · ${rate.label}`), element('td', '', money(rate.amount))); body.append(row); }); table.append(body); published.append(table); card.append(published);
    }
    if (stay.facilities) card.append(element('p', 'panel-note', `공식 체크인 ${stay.facilities.checkInText || '미제공'} / 체크아웃 ${stay.facilities.checkOutText || '미제공'} · 시설 등록 객실 수 ${stay.facilities.roomCountText || '미제공'} (남은 객실 수 아님)`));
    if (stay.tourismSource) appendTourSource(card, stay.tourismSource);
    card.append(detailsButton(`${stay.name}의 ${stay.checkInDate} 숙소 공개정보를 확인해 줘. 공개 참고 요금표와 실제 요금·객실 재고를 구분하고 기존 관광 일정은 유지해 줘.`, null));
    const budgetLabels = { unknown: '요금 미확인으로 예산 적합성 확인 필요', within_lodging_cap: '후보 기간 금액은 숙박 상한 이내 · 다른 숙박 기간·비용은 별도 확인', over_lodging_cap: '확인된 숙박비가 숙박 예산 상한을 초과합니다.', over_total_budget: '확인된 숙박비가 여행 총예산을 초과합니다.', total_budget_only: '숙박비만 총예산과 비교 가능 · 전체 여행 예산 충족 여부는 확인 필요' };
    card.append(element('p', 'panel-note', budgetLabels[stay.budgetFit] || budgetLabels.unknown));
    if (stay.meanStraightLineMeters != null) card.append(element('p', '', `관련 일정 장소까지 평균 직선거리 ${(stay.meanStraightLineMeters / 1000).toFixed(2)} km · 좌표 계산, 도로거리 아님`));
    const wrapper = element('div', 'lodging-table-wrap'); const table = element('table', 'budget-table lodging-table');
    table.append(element('caption', '', `${stay.name}에서 일정 장소까지 자동차 이동 비교`));
    const head = element('thead'); const header = element('tr'); ['연결된 일정 장소', '직선거리', '자동차 거리·시간'].forEach((label) => { const cell = element('th', '', label); cell.scope = 'col'; header.append(cell); }); head.append(header); table.append(head);
    const body = element('tbody');
    stay.comparisons.forEach((item) => {
      const row = element('tr'); const target = element('th'); target.scope = 'row'; const button = element('button', 'text-button', `${item.dayIndex + 1}일차 · ${item.name}`); button.type = 'button'; button.addEventListener('click', () => { activeDay = item.dayIndex; renderDay(); selectStop(item.stopIndex); $('#day-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); target.append(button);
      row.append(target, element('td', '', item.straightLineMeters == null ? '미확인' : `${(item.straightLineMeters / 1000).toFixed(2)} km`), element('td', '', item.durationMs == null ? '확인 불가' : `${(item.distanceMeters / 1000).toFixed(2)} km · 약 ${Math.ceil(item.durationMs / 60000)}분`)); body.append(row);
    });
    table.append(body); wrapper.append(table); card.append(wrapper);
    if (!stay.comparisons.length) card.append(element('p', 'panel-note', '좌표가 확인된 일정 장소가 없어 거리·이동시간 비교는 확인 필요입니다.'));
    card.append(element('p', 'panel-note', `출처: ${stay.place.source.name} · 검색어: ${stay.place.source.query}`));
    stay.publicSources.forEach((source) => card.append(element('p', 'panel-note', `추가 공개 자료: ${source.title} (웹 검색 출처 목록 참고)`)));
    if (stay.bookingLink) {
      try { const url = new URL(stay.bookingLink.url); if (url.protocol === 'https:' && !url.username && !url.password) { const link = element('a', 'outline-button', '확인된 공식 예약 페이지'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link, element('p', 'panel-note', `링크 확인: ${stay.bookingLink.checkedAt} · 객실·요금·예약 가능 여부 보장 아님`)); } } catch { /* Omit invalid links. */ }
    } else card.append(element('p', 'panel-note', '공식 예약 페이지 미확인 · 예약 링크를 제공하지 않습니다.'));
    const actions = element('div', 'lodging-actions');
    const locate = element('button', 'outline-button', '지도에서 비교'); locate.type = 'button'; locate.addEventListener('click', () => selectLodging(stay.id));
    const revise = element('button', 'text-button', '이 숙소 주변으로 일정 다듬기'); revise.type = 'button'; revise.addEventListener('click', () => { $('#chat-request').value = `${stay.name} (${stay.place.roadAddress || stay.place.address || '검색된 숙소'})를 숙박 후보로 고려해 주변 동선을 다듬어 줘. 숙소는 예약된 것이 아니고 요금과 예약 가능 여부가 미확인이면 그대로 표시해 줘.`; $('#chat-day').value = ''; $('#chat-request').focus(); $('#chat-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    revise.disabled = !trip.planId;
    if (!trip.planId) revise.title = '새 AI 일정을 생성한 뒤 요청할 수 있어요. 저장 목록에서는 직접 수정할 수 있어요.';
    actions.append(locate, revise); card.append(actions); return card;
  }));
}

function selectLodging(id) {
  const candidate = trip.lodgings?.candidates.find((stay) => stay.id === id);
  if (!candidate) return;
  if (!validPoint(candidate.place.coordinates)) { notify('숙소 좌표가 미확인이라 지도에서 표시할 수 없어요.'); return; }
  selectedLodgingId = id; activeDay = candidate.nightIndexes[0]; renderDay();
  $('#lodging-selection').textContent = `${candidate.name}의 위치와 조회된 숙소 → 일정 장소 경로를 비교하고 있어요. 숙소를 예약하거나 확정한 상태가 아닙니다.`;
  $('#map-selection').textContent = `숙소 후보: ${candidate.name}`;
  $('#map-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderValidation() {
  const report = trip.validation;
  $('#validation-status').textContent = !report ? '검증 전' : report.problemCount ? '남은 문제 있음' : report.confirmationCount ? '확인 필요' : '검증 통과';
  $('#validation-summary').textContent = !report ? (trip.isSample ? '샘플 미리보기입니다. AI가 일정을 생성하면 실제 근거로 검증해요.' : '검증 결과가 없는 이전 형식의 일정입니다.') : `자동 재계획 ${report.replanCount}/${report.maxReplans}회 · 남은 문제 ${report.problemCount}개 · 확인 필요 ${report.confirmationCount}개${report.stopReason === 'REPLAN_LIMIT' ? ' · 재계획 횟수 한도 도달' : report.stopReason === 'AGENT_LIMIT' ? ' · 전체 실행 한도 도달' : report.stopReason === 'REPLAN_ERROR' ? ' · 재계획 중 오류: 마지막 검증 일정 표시' : ''}`;
  const issueNode = (issue) => {
    const row = element('li', `validation-issue ${issue.severity}`);
    const location = issue.dayIndex == null ? '전체 여행' : `${issue.dayIndex + 1}일차${issue.stopIndex == null ? '' : ` ${issue.stopIndex + 1}번 장소`}`;
    row.append(element('strong', '', `${issue.severity === 'unknown' ? '확인 필요' : issue.severity === 'warning' ? '주의' : '문제'} · ${location}`), element('p', '', issue.message));
    if (issue.intervals) row.append(element('p', '', `영업 구간: ${issue.intervals.length ? issue.intervals.map((interval) => `${interval.open}~${interval.close}`).join(', ') : '확인된 휴무일'}`));
    if (issue.classification) row.append(element('p', '', `유형 근거: ${issue.classification}`));
    if (issue.sourceUrl) {
      try {
        const url = new URL(issue.sourceUrl);
        if (url.protocol === 'https:' && !url.username && !url.password) {
          const link = element('a', '', '영업시간 확인 출처'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link);
        }
      } catch { /* Invalid links are not rendered. */ }
    }
    return row;
  };
  $('#validation-issues').replaceChildren(...(report?.issues || []).filter((issue) => issue.actionable).map(issueNode));
  const unknownIssues = (report?.issues || []).filter((issue) => !issue.actionable);
  $('#validation-confirmations').hidden = !unknownIssues.length;
  $('#validation-confirmation-count').textContent = String(unknownIssues.length);
  $('#validation-unknown').replaceChildren(...unknownIssues.map(issueNode));
  $('#validation-repairs').replaceChildren(...(report?.repairs || []).map((repair) => {
    const section = element('div', 'validation-repair');
    section.append(element('h4', '', `${repair.attempt}차 일정 수정`), element('p', '', `수정 이유: ${repair.reasons.join(' ')}`));
    if (repair.modelReason) section.append(element('p', '', `Agent 설명: ${repair.modelReason}`));
    section.append(element('p', '', repair.changes.length ? repair.changes.join(' / ') : '장소·방문 시각의 변경을 확인하지 못했습니다. 남은 검증 결과를 확인해 주세요.'));
    return section;
  }));
  const history = report?.history?.slice(0, -1) || [];
  $('#validation-history').hidden = !history.length;
  $('#validation-attempts').replaceChildren(...history.map((attempt) => {
    const section = element('div', 'validation-attempt');
    section.append(element('h4', '', attempt.attempt ? `${attempt.attempt}차 수정안 검증` : '최초 일정 검증'));
    const list = element('ul');
    list.append(...attempt.issues.filter((issue) => issue.actionable).map((issue) => element('li', '', `${issue.dayIndex == null ? '전체' : `${issue.dayIndex + 1}일차`} · ${issue.message}`)));
    section.append(list); return section;
  }));
}

function renderChat() {
  $('#chat-messages').replaceChildren(...chatMessages.map((message) => {
    const row = element('li', `chat-message chat-${message.role}`);
    row.append(element('strong', '', message.role === 'user' ? '나의 요청' : '여행 Agent'), element('p', '', message.text));
    if (message.changes?.length) { const list = element('ul'); list.append(...message.changes.map((change) => element('li', '', change))); row.append(list); }
    return row;
  }));
  const selected = $('#chat-day').value;
  $('#chat-day').replaceChildren(element('option', '', '요청에 맞는 날짜만 · 자동 선택'));
  $('#chat-day').firstElementChild.value = '';
  trip.days.forEach((day, index) => { const option = element('option', '', `${index + 1}일차 · ${formatDate(day.date)}`); option.value = String(index); $('#chat-day').append(option); });
  $('#chat-day').value = selected;
  if ($('#chat-day').selectedIndex < 0) $('#chat-day').value = '';
  updateChatState();
}

function updateChatState() {
  const enabled = !trip?.isSample && Boolean(trip?.planId);
  $('#chat-form').querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = !enabled || Boolean(pendingRequest); });
  $('#undo-edit').disabled = !previousTrip || Boolean(pendingRequest);
  $('#chat-status').textContent = pendingRequest ? '요청을 처리하고 있어요. 완료 후 수정하거나 되돌릴 수 있어요.' : enabled ? '현재 표시된 일정이 수정 대상입니다. 수정 후 다시 검증하며, 확인되지 않은 정보는 확인 필요로 남겨요.' : 'AI 여행 계획을 생성한 뒤 대화로 수정할 수 있어요.';
  if (!pendingRequest && !trip?.isSample && !trip?.planId) $('#chat-status').textContent = '불러온 일정은 저장 목록의 ‘직접 수정’으로 방문 시각·메모를 바꿀 수 있어요. AI로 장소를 변경하려면 위에 복원된 여행 조건으로 새 일정을 생성해 주세요.';
}

function resetChat() {
  previousQueuedPlaces = [];
  previousTrip = undefined; previousActiveDay = 0; chatMessages = []; $('#chat-request').value = ''; $('#chat-error').hidden = true; $('#chat-day').value = '';
}

$('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pendingRequest || trip.isSample || !trip.planId) return;
  const request = $('#chat-request').value.trim();
  if (!request || request.length > 1000) return;
  const targetDay = $('#chat-day').value === '' ? null : Number($('#chat-day').value);
  const before = structuredClone(trip);
  const beforeDay = activeDay;
  const controller = new AbortController(); pendingRequest = controller;
  chatMessages.push({ role: 'user', text: request });
  $('#chat-error').hidden = true;
  renderChat(); setBusy(true, true);
  $('#chat-cancel').hidden = false; $('#chat-cancel').disabled = false;
  try {
    const updated = await requestPlanEdit({ planId: before.planId, sessionToken: before.sessionToken, request, targetDay }, { signal: controller.signal });
    if (controller.signal.aborted) return;
    previousTrip = before; previousActiveDay = beforeDay; trip = updated;
    chatMessages.push({ role: 'agent', text: updated.edit?.reason || '요청을 반영한 일정을 검증했어요.', changes: updated.edit?.changes?.length ? updated.edit.changes : ['장소·시간·조건의 변경을 확인하지 못했어요. 검증 결과를 확인해 주세요.'] });
    $('#chat-request').value = '';
    renderTrip(); activeDay = targetDay ?? updated.edit?.changedDays?.[0] ?? beforeDay; renderDay(); notify('요청에 맞춰 일정을 수정했어요.');
  } catch (error) {
    const message = controller.signal.aborted ? '수정을 취소했어요. 이전 일정을 유지합니다.' : error.message;
    chatMessages.push({ role: 'agent', text: message });
    if (!controller.signal.aborted) { $('#chat-error').textContent = message; $('#chat-error').hidden = false; renderTrace(error.trace || []); $('#log-source').textContent = '수정 실패'; }
    renderChat();
  } finally {
    pendingRequest = undefined; $('#chat-cancel').hidden = true; setBusy(false);
  }
});
$('#chat-cancel').addEventListener('click', () => pendingRequest?.abort());
$('#undo-edit').addEventListener('click', () => {
  if (pendingRequest || !previousTrip) return;
  trip = previousTrip; previousTrip = undefined;
  queuedPlaces = previousQueuedPlaces;
  chatMessages.push({ role: 'agent', text: '직전 수정을 되돌렸어요. 수정 전 일정과 검증 결과를 복원했습니다.' });
  $('#chat-error').hidden = true; renderTrip(); activeDay = previousActiveDay; renderDay(); notify('직전 수정 전 일정으로 돌아왔어요.');
});

function generate() {
  try { trip = createSampleTrip(readForm()); renderTrip(); return true; }
  catch (error) { notify(error.message); return false; }
}

function setDefaultDate() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('#start-date').min = today;
  $('#start-date').value = addDays(today, 7);
}

function setBusy(busy, editing = false) {
  refreshPlacePlanner();
  $('#random-trip-button').disabled = busy;
  savedTripsUi?.refreshControls();
  clearInterval(elapsedTimer);
  if (busy) {
    const started = Date.now();
    const tick = () => { $('#generation-elapsed').textContent = `진행 ${Math.floor((Date.now() - started) / 1000)}초 · 검색·경로 조회에 수분이 걸릴 수 있어요. 아래 취소 버튼으로 중단할 수 있습니다.`; };
    tick(); elapsedTimer = setInterval(tick, 1000);
  } else $('#generation-elapsed').textContent = '';
  updateChatState();
  form.querySelectorAll('input, select, textarea, button').forEach((control) => { control.disabled = busy; });
  $('#reset-button').disabled = busy;
  $('#download-button').disabled = busy;
  $('#generation-status').hidden = !busy;
  $('#results').setAttribute('aria-busy', String(busy));
  $('#generate-button').textContent = busy ? editing ? '일정 수정 중…' : '여행 계획 생성 중…' : '✦ AI 여행 계획 만들기 ↗';
  $('#chat-submit').textContent = busy && editing ? '일정 수정 중…' : '일정 수정하기';
  $('#generation-status p').replaceChildren(document.createTextNode(editing ? '변경 요청을 반영하고 일정을 다시 검증하고 있어요.' : '취향에 맞는 여행을 계획하고 있어요.'), element('small', '', '보통 수십 초가 걸릴 수 있어요. 잠시만 기다려 주세요.'));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pendingRequest) return;
  const conditions = readForm();
  if (!conditions.region.trim()) { $('#region-custom').focus(); notify('여행 지역을 입력해 주세요.'); return; }
  $('#form-feedback').hidden = true;
  const controller = new AbortController();
  pendingRequest = controller;
  $('#generation-error').hidden = true;
  setBusy(true);
  try {
    let result = await requestTravelPlan(conditions, { signal: controller.signal });
    if (controller.signal.aborted) return;
    const notAdded = [];
    for (const selection of queuedPlaces) {
      if (result.days[selection.dayIndex]?.stops.some((stop) => stop.place?.name === selection.place.name && (stop.place.roadAddress || stop.place.address) === (selection.place.roadAddress || selection.place.address))) continue;
      try { result = await requestAddPlace({ ...selection, place: undefined, query: undefined, planId: result.planId, sessionToken: result.sessionToken }, { signal: controller.signal }); }
      catch (error) { if (controller.signal.aborted) throw error; notAdded.push(`${selection.place.name}: ${error.message}`); }
    }
    queuedPlaces = [];
    if (notAdded.length) result.warnings = [...(result.warnings || []), `미리 선택한 장소 중 추가되지 않은 항목: ${notAdded.join(' / ')}`];
    trip = result;
    loadedSavedAt = null;
    savedTripsUi?.detach();
    resetChat();
    renderTrip();
    notify('AI가 만든 여행 계획이 준비됐어요.');
    $('#results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  } catch (error) {
    if (controller.signal.aborted) { notify('여행 계획 생성을 취소했어요.'); }
    else {
      $('#error-message').textContent = error.message;
      $('#generation-error').hidden = false;
      $('#generation-error').scrollIntoView({ behavior: 'instant', block: 'center' });
      renderTrace(error.trace || []);
      $('#log-source').textContent = '요청 실패';
      $('#log-description').textContent = '실패한 최근 요청의 Tool 실행 기록입니다. 이전 여행 일정은 유지됩니다.';
    }
  } finally {
    pendingRequest = undefined;
    setBusy(false);
  }
});
$('#retry-button').addEventListener('click', () => { if (!pendingRequest) form.requestSubmit(); });
$('#cancel-button').addEventListener('click', () => pendingRequest?.abort());
$('#reset-button').addEventListener('click', () => {
  if (pendingRequest) return;
  $('#generation-error').hidden = true;
  form.reset();
  queuedPlaces = [];
  loadedSavedAt = null;
  savedTripsUi?.detach();
  syncRegion();
  resetChat();
  setDefaultDate();
  generate();
  notify('기본 여행 조건과 샘플 일정으로 돌아왔어요.');
});
$('#download-button').addEventListener('click', () => {
  try { downloadSavedTrip(trip); notify(`${trip.isSample ? '샘플 ' : ''}일정을 JSON 파일로 내보냈어요.`); }
  catch (error) { notify(error.message); }
});

form.addEventListener('invalid', (event) => {
  $('#form-feedback').hidden = false;
  const control = event.target;
  const label = control.labels?.[0]?.textContent.trim() || control.getAttribute('aria-label') || '입력 항목';
  $('#form-feedback').textContent = `${label}: ${control.validationMessage}`;
}, true);
form.addEventListener('input', () => { $('#form-feedback').hidden = true; });
$('#refresh-services').addEventListener('click', () => { void renderServiceStatus(); });

$('#random-trip-button').addEventListener('click', () => {
  if (pendingRequest) return;
  const destination = getCurrentDestination();
  const pick = (values) => values[Math.floor(Math.random() * values.length)];
  const duration = pick([2, 3, 4]), travelers = pick([1, 2, 3, 4]);
  const date = new Date(Date.now() + (pick([3, 5, 7, 10, 14]) * 24 + 9) * 3600000).toISOString().slice(0, 10);
  const conditions = { region: destination.region, 'start-date': date, duration, travelers, budget: duration * travelers * pick([100000, 130000, 160000]), transport: pick(['car', 'rental']), 'max-places': pick([3, 4]), 'max-leg': 60, 'max-day': 180, 'lodging-mode': 'recommend', 'lodging-type': pick(['any', 'hotel', 'pension']), 'lodging-budget': '', requests: '' };
  for (const [id, value] of Object.entries(conditions)) $(`#${id}`).value = value;
  formatMoneyInputs();
  $('#region').dispatchEvent(new Event('input', { bubbles: true }));
  form.querySelectorAll('[name="preferences"]').forEach((input) => { input.checked = destination.preferences.includes(input.value); });
  $('#form-feedback').hidden = true;
  showDestination(destination);
  $('#random-trip-hint').textContent = `${destination.region} · ${duration - 1}박 ${duration}일 · ${travelers}명, 준비됐어요!`;
  notify(`${destination.region} 여행 조건을 채웠어요. 확인 후 AI 여행 계획 만들기를 눌러 주세요.`);
  $('#trip-form').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  $('#region-select').focus({ preventScroll: true });
});

const syncRegion = initRegionPicker();
showDestination(chooseDestination());
initDestinationCarousel();
initMoneyInputs();
setDefaultDate();
if (!generate()) throw new Error('초기 화면을 구성하지 못했습니다.');
initPlacePlanner({ getTrip: () => trip, isBusy: () => Boolean(pendingRequest), addPlace: async (selection) => {
  const candidate = appendLocalPlace(trip, selection.place, selection.query, selection);
  const before = structuredClone(trip), beforeDay = activeDay;
  const controller = new AbortController(); pendingRequest = controller; setBusy(true, true);
  try {
    let updated = candidate;
    if (trip.planId && selection.searchId) {
      try { updated = await requestAddPlace({ planId: trip.planId, sessionToken: trip.sessionToken, searchId: selection.searchId, searchToken: selection.searchToken, index: selection.index, dayIndex: selection.dayIndex, time: selection.time, endTime: selection.endTime }, { signal: controller.signal }); }
      catch (error) { if (!['PLAN_EXPIRED', 'PLAN_NOT_EDITABLE'].includes(error.code)) throw error; }
    }
    previousQueuedPlaces = structuredClone(queuedPlaces);
    if (trip.isSample) queuedPlaces.push(selection);
    previousTrip = before; previousActiveDay = beforeDay;
    trip = updated; renderTrip(); activeDay = selection.dayIndex; renderDay();
    notify(`${selection.place.name}을 ${selection.dayIndex + 1}일차에 추가했어요.`);
    return trip.isSample ? '미리보기에 추가했어요. AI 일정을 생성할 때 이 장소도 반영합니다.' : '일정·지도·검증을 갱신했어요. 변경사항 저장으로 보관할 수 있어요. 새 이동시간과 비용은 확인 필요입니다.';
  } finally { pendingRequest = undefined; setBusy(false); }
} });
savedTripsUi = initSavedTrips({ getTrip: () => trip, isBusy: () => Boolean(pendingRequest), notify, loadTrip: (plan, savedAt) => {
  trip = plan; loadedSavedAt = savedAt; selectedLodgingId = null; resetChat();
  queuedPlaces = [];
  const values = { region: plan.region, 'start-date': plan.startDate, duration: plan.duration, travelers: plan.travelers, budget: plan.budget, transport: plan.transport, requests: plan.requests || '', 'max-places': plan.maxPlacesPerDay || 4, 'max-leg': plan.maxTravelMinutesPerLeg ?? '', 'max-day': plan.maxTravelMinutesPerDay ?? '', 'lodging-mode': plan.lodgingMode || 'recommend', 'lodging-type': plan.lodgingType || 'any', 'lodging-budget': plan.lodgingBudget ?? '' };
  for (const [id, value] of Object.entries(values)) $(`#${id}`).value = value;
  formatMoneyInputs();
  $('#region').dispatchEvent(new Event('input', { bubbles: true }));
  form.querySelectorAll('[name="preferences"]').forEach((input) => { input.checked = plan.preferences.includes(input.value); });
  renderTrip(); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
} });
void renderServiceStatus();
