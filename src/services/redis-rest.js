import { PlanError } from '../lib/plan-error.js';

export function createRedisRest({ url, token, fetchImpl = globalThis.fetch } = {}) {
  function assertConfigured() {
    let parsed;
    try { parsed = new URL(url); } catch { /* Report only the configuration names. */ }
    if (!token || parsed?.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new PlanError(503, 'SESSION_STORE_NOT_CONFIGURED', '배포 환경에 UPSTASH_REDIS_REST_URL과 UPSTASH_REDIS_REST_TOKEN을 설정해 주세요.');
  }
  return {
    assertConfigured,
    async command(args) {
      assertConfigured();
      try {
        const response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Redis request failed');
        const data = await response.json();
        if (data.error || !Object.hasOwn(data, 'result')) throw new Error('Redis response failed');
        return data.result;
      } catch { throw new PlanError(503, 'SESSION_STORE_UNAVAILABLE', '임시 세션 저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    },
  };
}
