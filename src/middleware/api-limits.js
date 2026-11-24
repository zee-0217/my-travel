import { env } from '../config/env.js';
import { publicPlanError } from '../lib/plan-error.js';

const increment = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
export function createApiLimits({ redis = null, enabled = env.deployment.vercel || env.nodeEnv === 'production', aiLimit = env.limits.aiPerHour, apiLimit = env.limits.apiPerMinute, namespace = env.redis.namespace, now = Date.now } = {}) {
  const counters = new Map();
  return async (req, res, next) => {
    if (!enabled) return next();
    const ai = req.method === 'POST' && ['/plan', '/plan/', '/plan/revise'].includes(req.path);
    if (!ai && !['/places','/places/','/routes','/weather'].includes(req.path)) return next();
    const seconds = ai ? 3600 : 60, limit = ai ? aiLimit : apiLimit;
    const window = Math.floor(now() / (seconds * 1000)), key = `${namespace}:limit:${ai ? 'ai' : 'api'}:${window}`;
    try {
      let count;
      if (redis) count = await redis.command(['EVAL', increment, '1', key, String(seconds + 1)]);
      else { if (counters.size > 4) counters.clear(); count = (counters.get(key) || 0) + 1; counters.set(key, count); }
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid counter');
      if (count > limit) return res.status(429).set({ 'Retry-After': String(seconds - Math.floor(now() / 1000) % seconds), 'Cache-Control': 'no-store' }).json({ error: { code: 'APP_RATE_LIMIT', message: ai ? '서버의 시간당 AI 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.' : '서버의 API 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.' } });
      next();
    } catch (error) { const safe = publicPlanError(error); res.status(503).set('Cache-Control', 'no-store').json({ error: { code: safe.code, message: safe.message } }); }
  };
}
