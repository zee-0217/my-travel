export const SAVED_TRIPS_KEY = 'travel-piece.saved-trips.v1';
const maxBytes = 4 * 1024 * 1024;
const fields = ['source','isSample','region','startDate','duration','travelers','budget','preferences','transport','requests','maxPlacesPerDay','maxTravelMinutesPerLeg','maxTravelMinutesPerDay','lodgingMode','lodgingType','lodgingBudget','title','summary','days','costs','lodgings','total','remaining','budgetCalculation','budgetNote','warnings','trace','sources','disclaimer','validation','replanReason','personalNote','localEditedAt'];
const privateKey = /(?:api.?key|auth.?key|service.?key|client.?secret|password|credential|authorization|access.?token|refresh.?token|secret|^token$|^planId$|^callId$|^args$|^arguments$|^draft$|^records$|^context$|^headers$|^env$)/i;
const redactText = (value) => value.replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, '[민감정보 제외]').replace(/\b(?:OPENAI_API_KEY|KMA_API_KEY|KMA_SERVICE_KEY|TOUR_API_KEY|NAVER_\w*(?:SECRET|ID)|api[_-]?key|authKey|serviceKey|client[_-]?secret|password|access[_-]?token)\s*[=:]\s*[^\s,;"'<>]+/gi, '[민감정보 제외]');

function clean(value, depth = 0) {
  if (depth > 24) throw new Error('일정 데이터가 너무 복잡해 저장할 수 없어요.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const withoutUrlSecrets = value.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
      try {
        const url = new URL(raw); url.username = ''; url.password = '';
        for (const key of [...url.searchParams.keys()]) if (privateKey.test(key) || /^(?:key|signature)$/i.test(key)) url.searchParams.delete(key);
        url.hash = ''; return url.href;
      } catch { return '[주소 제외]'; }
    });
    return redactText(withoutUrlSecrets);
  }
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKey.test(key) && !['__proto__','prototype','constructor'].includes(key)).map(([key, item]) => [key, clean(item, depth + 1)]));
  return null;
}

export function snapshotTrip(trip, { allowSample = false } = {}) {
  const copy = clean(Object.fromEntries(fields.filter((key) => Object.hasOwn(trip || {}, key)).map((key) => [key, trip[key]])));
  if (!(copy.isSample === false || allowSample && copy.isSample === true) || !Array.isArray(copy.days) || copy.days.length < 1 || copy.days.length > 7 || copy.duration !== copy.days.length || typeof copy.region !== 'string' || !Array.isArray(copy.costs) || !Array.isArray(copy.preferences) || !['car','rental','transit'].includes(copy.transport)) throw new Error('생성한 AI 여행 일정만 저장할 수 있어요.');
  for (const day of copy.days) {
    if (!day || typeof day.date !== 'string' || !Array.isArray(day.stops) || !day.stops.length || day.stops.length > 12) throw new Error('저장된 일정의 날짜 정보를 확인할 수 없어요.');
    for (const stop of day.stops) if (!stop || !['title','time','description','stay','category','transfer'].every((key) => typeof stop[key] === 'string')) throw new Error('저장된 방문 장소 정보를 확인할 수 없어요.');
  }
  return copy;
}

export function exportTrip(trip) {
  return JSON.stringify(snapshotTrip(trip, { allowSample: true }), null, 2);
}

export function createSavedTripStore({ storage = globalThis.localStorage, now = () => new Date().toISOString(), makeId = () => globalThis.crypto.randomUUID() } = {}) {
  function list() {
    let raw;
    try { raw = storage.getItem(SAVED_TRIPS_KEY); } catch { throw new Error('브라우저 저장소를 사용할 수 없어요. 저장 권한을 확인하거나 JSON으로 내보내 주세요.'); }
    if (raw === null) return [];
    try {
      if (raw.length * 2 > maxBytes) throw new Error();
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.trips) || data.trips.length > 30) throw new Error();
      const seen = new Set();
      return data.trips.map((entry) => {
        if (!entry || typeof entry.id !== 'string' || entry.id.length > 80 || seen.has(entry.id) || !Number.isFinite(Date.parse(entry.createdAt)) || !Number.isFinite(Date.parse(entry.updatedAt))) throw new Error();
        seen.add(entry.id); return { id: entry.id, createdAt: entry.createdAt, updatedAt: entry.updatedAt, plan: snapshotTrip(entry.plan) };
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch { throw new Error('저장된 여행 목록을 읽지 못했어요. 기존 데이터는 유지했습니다. 다른 브라우저 탭의 일정이나 JSON 파일을 확인해 주세요.'); }
  }
  function write(trips) {
    const raw = JSON.stringify({ version: 1, trips });
    if (raw.length * 2 > maxBytes) throw new Error('저장 용량이 부족해요. 기존 일정을 JSON으로 내보낸 뒤 필요 없는 일정을 삭제해 주세요.');
    try { storage.setItem(SAVED_TRIPS_KEY, raw); } catch { throw new Error('저장하지 못했어요. 브라우저 저장 권한·용량을 확인하거나 JSON으로 내보내 주세요.'); }
  }
  return {
    list,
    get(id) { const entry = list().find((item) => item.id === id); if (!entry) throw new Error('이 일정이 삭제되었어요. 저장 목록을 다시 확인해 주세요.'); return entry; },
    save(trip, id = null) {
      const plan = snapshotTrip(trip), trips = list(), previous = id ? trips.find((entry) => entry.id === id) : null;
      if (id && !previous) throw new Error('기존 저장 일정이 삭제되었어요. 새 일정으로 저장해 주세요.');
      if (!id && trips.length >= 30) throw new Error('일정은 최대 30개까지 저장할 수 있어요. 필요 없는 일정을 삭제해 주세요.');
      const stamp = now(), entry = { id: previous?.id || makeId(), createdAt: previous?.createdAt || stamp, updatedAt: stamp, plan };
      write([entry, ...trips.filter((item) => item.id !== entry.id)]); return structuredClone(entry);
    },
    remove(id) { write(list().filter((entry) => entry.id !== id)); },
  };
}
