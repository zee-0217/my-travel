import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { PlanError } from '../lib/plan-error.js';
import { getPlanContext } from '../agents/plan-context.js';
import { createPlanStore } from './plan-store.js';
import { createPlaceSelections } from './place-selections.js';
import { createRedisRest } from './redis-rest.js';

const validId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
export function createSharedStores(redis, { namespace = 'travel-piece', ttlSeconds = 1800 } = {}) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace)) throw new Error('Invalid session namespace.');
  const key = (kind, id) => `${namespace}:${kind}:${id}`;
  const load = async (kind, id, code, message) => {
    if (!validId(id)) throw new PlanError(410, code, message);
    const raw = await redis.command(['GET', key(kind, id)]);
    if (!raw) throw new PlanError(410, code, message);
    try { return JSON.parse(raw); } catch { throw new PlanError(503, 'SESSION_STORE_INVALID', '저장된 세션을 읽지 못했어요. 새 일정을 생성해 주세요.'); }
  };
  return {
    redis,
    assertReady: () => redis.assertConfigured(),
    planStore: {
      async save(plan) {
        const context = getPlanContext(plan), planId = randomUUID();
        const serialized = context ? { ...context, records: [...context.records], sources: [...context.sources] } : null;
        await redis.command(['SET', key('plan', planId), JSON.stringify({ plan, context: serialized }), 'EX', ttlSeconds]);
        return { ...plan, planId };
      },
      async get(id) {
        const entry = await load('plan', id, 'PLAN_EXPIRED', '일정 수정 세션이 만료됐어요. 저장된 일정은 브라우저에서 열거나 직접 수정할 수 있어요.');
        if (entry.context) entry.context = { ...entry.context, records: new Map(entry.context.records), sources: new Map(entry.context.sources) };
        return entry;
      },
    },
    placeSelections: {
      async save(result) { const id = randomUUID(); await redis.command(['SET', key('search', id), JSON.stringify(result), 'EX', ttlSeconds]); return id; },
      get(id) { return load('search', id, 'SEARCH_EXPIRED', '장소 검색 결과가 만료됐어요. 다시 검색해 주세요.'); },
    },
  };
}

export function createRuntimeStores(config = env) {
  if (config.deployment.vercel || config.redis.url || config.redis.token) return createSharedStores(createRedisRest(config.redis), { namespace: config.redis.namespace });
  return { planStore: createPlanStore(), placeSelections: createPlaceSelections(), assertReady() {}, redis: null };
}
