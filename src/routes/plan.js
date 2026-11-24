import { Router } from 'express';
import { generateTravelPlan } from '../agents/travel-planner.js';
import { validatePlanInput } from '../agents/plan-schema.js';
import { PlanError, publicPlanError } from '../lib/plan-error.js';
import { env } from '../config/env.js';
import { createPlanStore } from '../services/plan-store.js';
import { createPlaceSelections } from '../services/place-selections.js';
import { rememberPlan } from '../agents/plan-context.js';
import { buildAgentPlan } from '../agents/agent-result.js';
import { validateItinerary, describePlanChanges } from '../agents/validate-itinerary.js';
import { placeCategory, validatePlaceAddition } from '../../public/js/add-place.js';

export function createPlanRouter({ generatePlan = generateTravelPlan, revisePlan = generateTravelPlan, planStore = createPlanStore(), placeSelections = createPlaceSelections() } = {}) {
  const router = Router();
  const handle = (editing) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.agent.timeoutMs + 5000);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try {
      if (!req.is('application/json')) throw new PlanError(415, 'JSON_REQUIRED', 'JSON 형식으로 여행 조건을 보내 주세요.');
      let plan;
      if (editing) {
        const { planId, request, targetDay = null } = req.body || {};
        if (typeof planId !== 'string' || !/^[a-f0-9-]{36}$/.test(planId) || typeof request !== 'string' || !request.trim() || request.trim().length > 1000 || targetDay !== null && (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6)) throw new PlanError(400, 'INVALID_EDIT_INPUT', '현재 일정과 1~1000자의 수정 요청을 보내 주세요.');
        const current = await planStore.get(planId);
        if (!current.context?.draft) throw new PlanError(409, 'PLAN_NOT_EDITABLE', '이 일정의 수정 근거가 없어요. AI 여행 계획을 새로 생성해 주세요.');
        if (targetDay !== null && targetDay >= current.plan.duration) throw new PlanError(400, 'INVALID_EDIT_INPUT', '현재 여행 날짜 안에서 수정 범위를 선택해 주세요.');
        plan = await revisePlan(validatePlanInput(current.plan), { signal: controller.signal, edit: { ...current, request: request.trim(), targetDay } });
      } else {
        plan = await generatePlan(validatePlanInput(req.body), { signal: controller.signal });
      }
      if (!res.destroyed) res.json({ plan: await planStore.save(plan) });
    } catch (error) {
      if (res.destroyed) return;
      const safe = publicPlanError(controller.signal.aborted ? { name: 'TimeoutError' } : error);
      res.status(safe.status).json({ error: { code: safe.code, message: safe.message }, trace: safe.trace || [] });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
  };
  router.post('/', handle(false));
  router.post('/revise', handle(true));
  router.post('/places', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!req.is('application/json')) throw new PlanError(415, 'JSON_REQUIRED', 'JSON 형식으로 보내 주세요.');
      const { planId, searchId, index, dayIndex, time, endTime } = req.body || {};
      if (typeof planId !== 'string' || typeof searchId !== 'string' || !Number.isInteger(index) || index < 0 || index > 4) throw new PlanError(400, 'INVALID_PLACE_SELECTION', '실제 검색 결과와 일정 날짜를 선택해 주세요.');
      const current = await planStore.get(planId), result = await placeSelections.get(searchId), place = result.places[index];
      if (!current.context?.draft) throw new PlanError(409, 'PLAN_NOT_EDITABLE', '이 일정은 직접 수정으로 장소를 추가해 주세요.');
      try { validatePlaceAddition(current.plan, place, { dayIndex, time, endTime }); } catch (error) { throw new PlanError(400, 'INVALID_PLACE_SELECTION', error.message); }
      const draft = structuredClone(current.context.draft), records = new Map(current.context.records), sources = new Map(current.context.sources);
      const callId = `selected-${searchId}`;
      records.set(callId, { name: 'search_places', ok: true, args: {}, result });
      const stops = draft.days[dayIndex].stops;
      stops.push({ title: place.name, time, endTime, category: placeCategory(place), description: '검색 결과에서 직접 선택한 방문 장소입니다.', stay: '직접 지정한 방문 시간', placeRef: { callId, index }, routeCallId: null });
      stops.sort((a,b) => a.time.localeCompare(b.time));
      draft.budgetCallId = null; draft.replanReason = '사용자가 검색 장소를 추가했습니다. 새 이동 구간과 비용은 확인 필요입니다.';
      const plan = buildAgentPlan(JSON.stringify(draft), validatePlanInput(current.plan), records, current.plan.trace || [], [...sources.values()]);
      plan.validation = { ...validateItinerary(plan), replanCount: 0, maxReplans: 0, stopReason: 'MANUAL_PLACE_ADDED', history: [], repairs: [] };
      plan.edit = { reason: draft.replanReason, changes: describePlanChanges(current.plan, plan), changedDays: [dayIndex] };
      rememberPlan(plan, { records, sources, draft });
      res.json({ plan: await planStore.save(plan) });
    } catch (error) { const safe = publicPlanError(error); res.status(safe.status).json({ error: { code: safe.code, message: safe.message } }); }
  });
  return router;
}
