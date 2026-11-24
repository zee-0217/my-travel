import { Router } from 'express';
import { search_places } from '../services/naver-api-hub.js';
import { publicPlacesError } from '../lib/places-error.js';
import { createPlaceSelections } from '../services/place-selections.js';
import { PlanError } from '../lib/plan-error.js';

export function createPlacesRouter({ searchPlaces = search_places, placeSelections = createPlaceSelections() } = {}) {
  const router = Router();
  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try {
      const result = await searchPlaces({
        region: req.query.region, keyword: req.query.keyword,
        display: req.query.display === undefined ? 5 : typeof req.query.display === 'string' ? Number(req.query.display) : NaN,
        sort: req.query.sort === undefined ? 'random' : req.query.sort,
      }, { signal: controller.signal });
      if (!res.destroyed) { const selection = await placeSelections.save(result); res.json({ ...result, ...(typeof selection === 'string' ? {searchId:selection} : selection) }); }
    } catch (error) {
      if (res.destroyed) return;
      const safe = error instanceof PlanError ? error : publicPlacesError(error);
      res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
    } finally {
      res.off('close', onClose);
    }
  });
  return router;
}
