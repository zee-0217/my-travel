import { Router } from 'express';
import { get_routes } from '../services/naver-maps.js';
import { get_weather } from '../services/weather.js';
import { calculate_budget } from '../tools/calculate-budget.js';
import { ToolError, publicToolError } from '../lib/tool-error.js';

export function createTravelToolsRouter({ getRoutes = get_routes, calculateBudget = calculate_budget, getWeather = get_weather } = {}) {
  const router = Router();
  for (const [path, tool, resultKey] of [['/routes', getRoutes, 'route'], ['/budget', calculateBudget, 'budget'], ['/weather', getWeather, 'weather']]) {
    router.post(path, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const controller = new AbortController();
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', onClose);
      try {
        if (!req.is('application/json')) throw new ToolError(415, 'JSON_REQUIRED', 'JSON 형식으로 입력해 주세요.');
        const result = await tool(req.body, { signal: controller.signal });
        if (!res.destroyed) res.json({ [resultKey]: result });
      } catch (error) {
        if (res.destroyed) return;
        const safe = publicToolError(error);
        res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
      } finally {
        res.off('close', onClose);
      }
    });
  }
  return router;
}
