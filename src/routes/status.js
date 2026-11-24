import { Router } from 'express';
import { env } from '../config/env.js';

export function serviceConfiguration(config = env) {
  return { checked: 'configuration_only', services: [
    ...(config.deployment?.vercel || config.redis?.url || config.redis?.token ? [{ id: 'sessions', name: '서버 임시 세션 · Redis', configured: Boolean(config.redis?.url && config.redis?.token), message: 'Vercel의 채팅 수정·검색 장소 추가에는 UPSTASH_REDIS_REST_URL과 UPSTASH_REDIS_REST_TOKEN이 필요합니다. 여행 일정 저장은 계속 브라우저 localStorage를 사용합니다.' }] : []),
    { id: 'tourism', name: '한국관광공사 공식 운영정보·숙박 참고 요금', configured: Boolean(config.tourism?.serviceKey?.trim()), message: '무료 TourAPI 활용 신청 후 TOUR_API_KEY를 설정하세요. 실시간 실요금·남은 객실은 제공하지 않습니다.' },
    { id: 'openai', name: 'OpenAI 일정 생성·수정', configured: Boolean(config.openai.apiKey.trim() && config.openai.model.trim()), message: 'OPENAI_API_KEY와 OPENAI_MODEL · 실제 인증·잔액·모델 권한은 요청할 때 확인합니다.' },
    { id: 'places', name: 'NAVER API HUB 장소·숙소 검색', configured: Boolean(config.naverApiHub.clientId.trim() && config.naverApiHub.clientSecret.trim()), message: '지역 검색 사용 권한과 API HUB 전용 Client ID·Secret이 필요합니다.' },
    { id: 'maps', name: 'NAVER Maps 지도·자동차 경로', configured: Boolean(config.naverMaps.clientId.trim() && config.naverMaps.clientSecret.trim()), message: 'Directions 5와 Web Dynamic Map 활성화 및 현재 사이트의 배포 도메인(로컬은 http://localhost:3000) 서비스 URL 등록이 필요합니다.' },
    { id: 'weather', name: '기상청·무료 대체 날씨 예보', configured: Boolean(config.weather.apiKey.trim() || config.weather.serviceKey.trim() || config.weather.freeFallback), message: '기상청 실패·범위 밖 날짜는 Open-Meteo로 대체합니다. 무료 대체는 비상업용이며 WEATHER_FREE_FALLBACK=false로 끌 수 있습니다. 최대 16일 이후는 미확인입니다.' },
  ] };
}
export const statusRouter = Router();
statusRouter.get('/', (_req, res) => res.set('Cache-Control', 'no-store').json(serviceConfiguration()));
