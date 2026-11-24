import { randomUUID } from 'node:crypto';
import { getPlanContext } from '../agents/plan-context.js';
import { PlanError } from '../lib/plan-error.js';

export function createPlanStore({ ttlMs = 30 * 60000, maxEntries = 40, now = Date.now } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 200) throw new Error('Invalid plan store limits.');
  const entries = new Map();
  const prune = () => { for (const [key, value] of entries) if (value.expiresAt <= now()) entries.delete(key); };
  return {
    save(plan) {
      prune();
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      const planId = randomUUID();
      entries.set(planId, { plan: structuredClone(plan), context: getPlanContext(plan), expiresAt: now() + ttlMs });
      return { ...plan, planId };
    },
    get(planId) {
      prune();
      const entry = entries.get(planId);
      if (!entry) throw new PlanError(410, 'PLAN_EXPIRED', '일정 수정 세션이 만료되었어요. 여행 계획을 새로 생성해 주세요.');
      // Callers may adjust a new candidate, but cannot overwrite stored undo snapshots.
      return { plan: structuredClone(entry.plan), context: entry.context };
    },
  };
}
