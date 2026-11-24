import { env } from '../config/env.js';
import { ToolError, publicToolError } from '../lib/tool-error.js';

// NEW Maps endpoints. Keep Maps credentials separate from API HUB credentials.
export function getMapsConfig() {
  if (!env.naverMaps.clientId.trim() || !env.naverMaps.clientSecret.trim()) {
    throw new ToolError(503, 'MAPS_NOT_CONFIGURED', '자동차 경로 확인 불가: .env의 NAVER_MAPS_CLIENT_ID와 NAVER_MAPS_CLIENT_SECRET을 설정하고 서버를 다시 실행해 주세요.');
  }
  return {
    directions5Url: 'https://maps.apigw.ntruss.com/map-direction/v1/driving',
    geocodingUrl: 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode',
    headers: {
      'x-ncp-apigw-api-key-id': env.naverMaps.clientId.trim(),
      'x-ncp-apigw-api-key': env.naverMaps.clientSecret.trim(),
    },
  };
}

function validatePoint(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point) ||
      !Number.isFinite(point.longitude) || !Number.isFinite(point.latitude) ||
      Math.abs(point.longitude) > 180 || Math.abs(point.latitude) > 90 ||
      (point.longitude === 0 && point.latitude === 0)) {
    throw new ToolError(400, 'INVALID_ROUTE_COORDINATES', '두 장소의 WGS84 소수 경도·위도를 입력해 주세요. 지역 검색의 원본 정수 좌표 대신 정규화된 좌표를 사용해야 해요.');
  }
  return { longitude: point.longitude, latitude: point.latitude };
}

export function validateRouteInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolError(400, 'INVALID_ROUTE_INPUT', '출발 장소와 도착 장소를 입력해 주세요.');
  const { mode = 'driving', option = 'traoptimal' } = input;
  if (typeof mode !== 'string' || mode.length > 30 || !['trafast', 'tracomfort', 'traoptimal', 'traavoidtoll', 'traavoidcaronly'].includes(option)) {
    throw new ToolError(400, 'INVALID_ROUTE_INPUT', '지원하는 자동차 경로 옵션을 입력해 주세요.');
  }
  return { start: validatePoint(input.start), goal: validatePoint(input.goal), mode, option };
}

function unavailable(input, reason, message, providerCode = null) {
  return { source: 'NAVER Maps Directions 5', ...input, available: false, status: 'unavailable', reason, message,
    distanceMeters: null, durationMs: null, distanceKm: null, durationMinutes: null, path: [], providerCode };
}

export function normalizeRoutePath(path) {
  if (!Array.isArray(path) || path.length < 2 || path.length > 50000 || !path.every((point) => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) return [];
  return path.map(([longitude, latitude]) => [longitude, latitude]);
}

export function createRouteLookup({ getConfig = getMapsConfig, fetchImpl = globalThis.fetch } = {}) {
  return async function get_routes(input, { signal } = {}) {
    const request = validateRouteInput(input);
    if (request.mode !== 'driving') return unavailable(request, 'UNSUPPORTED_MODE', '확인 불가: 도보 및 대중교통 경로는 제공하지 않습니다.');
    if (request.start.longitude === request.goal.longitude && request.start.latitude === request.goal.latitude) {
      return unavailable(request, 'SAME_LOCATION', '자동차 경로 확인 불가: 출발지와 도착지가 같습니다.', 1);
    }
    try {
      const config = getConfig();
      const url = new URL(config.directions5Url);
      url.search = new URLSearchParams({
        start: `${request.start.longitude},${request.start.latitude}`,
        goal: `${request.goal.longitude},${request.goal.latitude}`,
        option: request.option, lang: 'ko',
      }).toString();
      const response = await fetchImpl(url, { method: 'GET', headers: { ...config.headers, Accept: 'application/json' },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(15000)]),
      });
      if (response.status === 401 || response.status === 403) throw new ToolError(503, 'MAPS_AUTH_ERROR', '자동차 경로 확인 불가: NAVER Maps 인증 정보와 Directions 5 사용 권한을 확인해 주세요.');
      if (response.status === 429) throw new ToolError(429, 'MAPS_QUOTA_ERROR', '자동차 경로 확인 불가: Directions 5 신청 여부와 호출 한도를 확인해 주세요.');
      if (!response.ok && response.status !== 400) throw new ToolError(502, 'MAPS_UPSTREAM_ERROR', '자동차 경로 확인 불가: NAVER Maps에 연결하지 못했어요.');
      const data = await response.json();
      // Directions documents business failures as HTTP 400, not just 200.
      if ([1, 2, 3, 4, 5].includes(data?.code)) {
        const reasons = { 1: 'SAME_LOCATION', 2: 'NOT_NEAR_ROAD', 3: 'NO_DRIVING_ROUTE', 4: 'NOT_NEAR_ROAD', 5: 'DISTANCE_LIMIT' };
        return unavailable(request, reasons[data.code], '자동차 경로 확인 불가: 해당 두 장소 사이의 자동차 경로를 제공할 수 없습니다.', data.code);
      }
      if (!response.ok || data?.code !== 0 || !Array.isArray(data.route?.[request.option])) {
        throw new ToolError(502, 'INVALID_ROUTE_RESPONSE', '자동차 경로 확인 불가: 경로 응답 형식을 확인할 수 없어요.');
      }
      const routes = data.route[request.option];
      if (!routes.length) return unavailable(request, 'NO_DRIVING_ROUTE', '자동차 경로 확인 불가: 조회된 자동차 경로가 없습니다.', 0);
      const summary = routes[0]?.summary;
      if (!Number.isSafeInteger(summary?.distance) || summary.distance < 0 || !Number.isSafeInteger(summary?.duration) || summary.duration < 0) {
        throw new ToolError(502, 'INVALID_ROUTE_RESPONSE', '자동차 경로 확인 불가: 거리와 시간 정보를 확인할 수 없어요.');
      }
      return { source: 'NAVER Maps Directions 5', ...request, available: true, status: 'available',
        distanceMeters: summary.distance, durationMs: summary.duration,
        distanceKm: summary.distance / 1000, durationMinutes: summary.duration / 60000,
        path: normalizeRoutePath(routes[0].path),
        providerCode: 0, message: '조회 시점 교통 상황을 반영한 자동차 예상 경로입니다. 실제 소요 시간은 달라질 수 있어요.' };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Route lookup cancelled', 'AbortError');
      if (error instanceof SyntaxError) throw new ToolError(502, 'INVALID_ROUTE_RESPONSE', '자동차 경로 확인 불가: 경로 응답을 읽지 못했어요.');
      const safe = publicToolError(error);
      if (safe.code === 'TOOL_UNAVAILABLE') throw new ToolError(502, 'ROUTES_UNAVAILABLE', '자동차 경로 확인 불가: NAVER Maps에 연결하지 못했어요.');
      throw safe;
    }
  };
}

export const get_routes = createRouteLookup();
