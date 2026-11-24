import { Router } from 'express';
import { env } from '../config/env.js';

// Web SDK authentication uses a public identifier. Never expose Client Secret.
export function createMapsConfigRouter({ publicMapsClientId = env.naverMaps.clientId.trim() } = {}) {
  const router = Router();
  router.get('/', (_req, res) => res.set('Cache-Control', 'no-store').json({
    enabled: Boolean(publicMapsClientId), clientId: publicMapsClientId,
    sdkUrl: 'https://oapi.map.naver.com/openapi/v3/maps.js', authParameter: 'ncpKeyId',
  }));
  return router;
}
