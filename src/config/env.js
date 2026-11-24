import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve from the project root, independently of the working directory.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const port = Number(process.env.PORT || 3000);
function agentInteger(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

// Server-side only. Never serialize this object in a response or log it.
export const env = Object.freeze({
  deployment: Object.freeze({ vercel: process.env.VERCEL === '1' }),
  limits: Object.freeze({ aiPerHour: agentInteger('AI_REQUESTS_PER_HOUR', 30, 1, 10000), apiPerMinute: agentInteger('API_REQUESTS_PER_MINUTE', 120, 1, 10000) }),
  redis: Object.freeze({ url: (process.env.UPSTASH_REDIS_REST_URL || '').trim(), token: (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim(), namespace: process.env.SESSION_NAMESPACE || `travel-piece-${process.env.VERCEL_ENV || 'local'}` }),
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port,
  weather: Object.freeze({ apiKey: (process.env.KMA_API_KEY || '').trim(), serviceKey: (process.env.KMA_SERVICE_KEY || '').trim(), freeFallback: process.env.WEATHER_FREE_FALLBACK !== 'false' }),
  tourism: Object.freeze({ serviceKey: (process.env.TOUR_API_KEY || '').trim() }),
  agent: Object.freeze({
    maxReplans: agentInteger('AGENT_MAX_REPLANS', 2, 0, 4),
    maxIterations: agentInteger('AGENT_MAX_ITERATIONS', 8, 1, 12),
    maxToolCalls: agentInteger('AGENT_MAX_TOOL_CALLS', 16, 1, 30),
    timeoutMs: agentInteger('AGENT_TIMEOUT_MS', 240000, 1000, process.env.VERCEL === '1' ? 270000 : 600000),
  }),
  openai: Object.freeze({
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || '',
  }),
  naverApiHub: Object.freeze({
    clientId: process.env.NAVER_API_HUB_CLIENT_ID || '',
    clientSecret: process.env.NAVER_API_HUB_CLIENT_SECRET || '',
  }),
  naverMaps: Object.freeze({
    clientId: process.env.NAVER_MAPS_CLIENT_ID || '',
    clientSecret: process.env.NAVER_MAPS_CLIENT_SECRET || '',
  }),
});

export function requireSettings(settings, names) {
  const missing = names.filter((name) => !settings[name]?.trim());
  if (missing.length) {
    throw new Error(`Required server configuration is missing: ${missing.join(', ')}`);
  }
}
