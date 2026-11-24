import { randomUUID } from 'node:crypto';
import { PlanError } from '../lib/plan-error.js';

export function createPlaceSelections({ now = Date.now, ttlMs = 30 * 60000 } = {}) {
  const entries = new Map();
  const prune = () => { for (const [id, entry] of entries) if (entry.expires <= now()) entries.delete(id); };
  return {
    save(result) { prune(); if (entries.size >= 200) entries.delete(entries.keys().next().value); const id = randomUUID(); entries.set(id, { result: structuredClone(result), expires: now() + ttlMs }); return id; },
    get(id) { prune(); const entry = entries.get(id); if (!entry) throw new PlanError(410, 'SEARCH_EXPIRED', '장소 검색 결과가 만료됐어요. 다시 검색한 뒤 일정에 추가해 주세요.'); return structuredClone(entry.result); },
  };
}
