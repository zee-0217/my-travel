import OpenAI from 'openai';
import { env, requireSettings } from '../config/env.js';
import { PlanError } from '../lib/plan-error.js';

let client;

// Lazy initialization lets the scaffold run without credentials.
// The SDK stays on the server; initialization never exposes credentials.
export function getOpenAIClient() {
  if (!env.openai.apiKey.trim() || !env.openai.model.trim()) {
    throw new PlanError(503, 'AI_NOT_CONFIGURED', '서버 .env에 OPENAI_API_KEY와 OPENAI_MODEL을 설정한 뒤 서버를 다시 실행해 주세요.');
  }
  client ??= new OpenAI({ apiKey: env.openai.apiKey.trim(), timeout: 90_000, maxRetries: 0 });
  return client;
}

export function getOpenAIModel() {
  requireSettings(env.openai, ['model']);
  return env.openai.model.trim();
}
