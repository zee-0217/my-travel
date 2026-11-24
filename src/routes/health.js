import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  // This checks the local server, not external API connectivity or credentials.
  res.set('Cache-Control', 'no-store').json({ status: 'ok', stage: 'setup' });
});
