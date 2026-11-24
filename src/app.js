import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { healthRouter } from './routes/health.js';
import { createPlanRouter } from './routes/plan.js';
import { createPlacesRouter } from './routes/places.js';
import { createTravelToolsRouter } from './routes/travel-tools.js';
import { createMapsConfigRouter } from './routes/maps-config.js';
import { env } from './config/env.js';
import { statusRouter } from './routes/status.js';
import { createRuntimeStores } from './services/runtime-stores.js';
import { createApiLimits } from './middleware/api-limits.js';

export function createApp(options = {}) {
  const stores = options.runtimeStores || createRuntimeStores();
  options = { ...stores, ...options };
  const app = express();
  const developmentMapScripts = env.nodeEnv === 'production' ? [] : ['http://oapi.map.naver.com', 'http://*.map.naver.net'];
  const developmentMapResources = env.nodeEnv === 'production' ? [] : ['http://oapi.map.naver.com', 'http://*.naver.net', 'http://*.pstatic.net'];
  app.disable('x-powered-by');
  app.use(helmet({
    // Local development uses HTTP. Revisit HTTPS policy when deploying.
    strictTransportSecurity: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: { directives: {
      upgradeInsecureRequests: env.nodeEnv === 'production' ? [] : null,
      scriptSrc: ["'self'", 'https://oapi.map.naver.com', 'https://*.map.naver.net', 'https://ssl.pstatic.net', ...developmentMapScripts],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.pstatic.net', 'https://*.naver.com', 'https://*.naver.net', 'https://*.ntruss.com', ...developmentMapResources],
      connectSrc: ["'self'", 'https://*.naver.com', 'https://*.pstatic.net', 'https://*.naver.net', 'https://*.ntruss.com', 'https://kr-col-ext.nelo.navercorp.com', ...developmentMapResources],
    } },
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/health', healthRouter);
  app.use('/api/status', statusRouter);
  app.use('/api', options.apiLimits || createApiLimits({ redis: stores.redis }));
  app.use(['/api/plan', '/api/places'], (_req, res, next) => {
    try { stores.assertReady(); next(); }
    catch (error) { res.status(503).set('Cache-Control', 'no-store').json({ error: { code: error.code, message: error.message } }); }
  });
  app.use('/api/plan', createPlanRouter(options));
  app.use('/api/places', createPlacesRouter(options));
  app.use('/api/maps/config', createMapsConfigRouter(options));
  app.use('/api', createTravelToolsRouter(options));

  // Only public/ is exposed; .env and backend sources stay outside the web root.
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), {
    dotfiles: 'deny',
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
  }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  app.use((error, req, res, _next) => {
    const status = error.status === 400 || error.status === 413 ? error.status : 500;
    // Never return stack traces, upstream responses, or credentials.
    if (['/api/plan', '/api/plan/revise', '/api/plan/places', '/api/routes', '/api/budget', '/api/weather'].includes(req.path.replace(/\/$/, ''))) {
      const message = status === 413 ? '입력 내용이 너무 커요. 추가 요청을 줄여 주세요.'
        : status === 400 ? '올바른 JSON 형식으로 요청해 주세요.'
          : '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.';
      return res.status(status).set('Cache-Control', 'no-store').json({
        error: { code: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'INVALID_REQUEST', message },
      });
    }
    res.status(status).json({ error: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'INVALID_REQUEST' });
  });
  return app;
}

export const app = createApp();
export default app;
