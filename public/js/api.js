export async function getServerHealth() {
  const response = await fetch('/api/health', {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('Server health check failed.');
  return response.json();
}

export async function requestRoute(conditions, { signal } = {}) {
  try {
    const response = await fetch('/api/routes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(conditions),
      cache: 'no-store', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(22000)]),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || '자동차 경로 확인 불가: 잠시 후 다시 시도해 주세요.');
    if (typeof data.route?.available !== 'boolean') throw new Error('자동차 경로 확인 불가: 경로 응답 형식을 확인해 주세요.');
    return data.route;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.name === 'TimeoutError') throw new Error('자동차 경로 확인 불가: 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.');
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('자동차 경로 확인 불가: 서버와 네트워크 상태를 확인해 주세요.');
    throw error;
  }
}

export async function requestPlaces({ region, keyword }, { signal } = {}) {
  try {
    const query = new URLSearchParams({ region, keyword, display: '5' });
    const response = await fetch(`/api/places?${query}`, {
      cache: 'no-store',
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(20000)]),
    });
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
      throw new Error('장소 검색 응답을 읽지 못했어요. 다시 검색해 주세요.');
    }
    if (!response.ok) throw new Error(data.error?.message || '장소 검색에 실패했어요. 다시 검색해 주세요.');
    if (!Array.isArray(data.places)) throw new Error('장소 검색 결과의 형식이 올바르지 않아요.');
    return data;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.name === 'TimeoutError') throw new Error('장소 검색 시간이 길어지고 있어요. 잠시 후 다시 검색해 주세요.');
    if (error instanceof TypeError) throw new Error('검색 서버에 연결할 수 없어요. 개발 서버와 네트워크 상태를 확인해 주세요.');
    throw error;
  }
}

export const requestTravelPlan = (conditions, options) => requestPlan('/api/plan', conditions, options);
export const requestPlanEdit = (changes, options) => requestPlan('/api/plan/revise', changes, options);
export const requestAddPlace = (selection, options) => requestPlan('/api/plan/places', selection, options);

async function requestPlan(endpoint, conditions, { signal } = {}) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conditions), cache: 'no-store',
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(610_000)]),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(error.name === 'TimeoutError' ? '응답을 기다리는 시간이 길어졌어요. 잠시 후 다시 시도해 주세요.' : '서버에 연결할 수 없어요. 개발 서버와 네트워크 상태를 확인해 주세요.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('서버 응답을 읽지 못했어요. 서버 상태를 확인한 뒤 다시 시도해 주세요.'); }
  if (!response.ok) {
    const error = new Error(data.error?.message || '여행 계획을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    error.code = data.error?.code;
    error.trace = data.trace || [];
    throw error;
  }
  if (!data.plan || !Array.isArray(data.plan.days) || data.plan.days.length === 0) throw new Error('여행 일정이 비어 있어요. 다시 시도해 주세요.');
  return data.plan;
}
