import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { PlanError } from '../lib/plan-error.js';
import { getPlanContext } from '../agents/plan-context.js';

export function createStatelessStores({ secret, namespace = 'travel-piece', now = Date.now, ttlMs = 1800000 } = {}) {
  const key = Buffer.from(secret || '', 'base64');
  const aad = Buffer.from(namespace);
  function assertReady() {
    if (key.length !== 32) throw new PlanError(503, 'SESSION_KEY_NOT_CONFIGURED', '배포 환경변수 SESSION_ENCRYPTION_KEY에 32바이트 Base64 암호화 키를 등록해 주세요.');
  }
  function seal(kind, id, data) {
    assertReady();
    const json = Buffer.from(JSON.stringify({ kind, id, expires: now() + ttlMs, data }));
    if (json.length > 8 * 1024 * 1024) throw new PlanError(413, 'SESSION_TOO_LARGE', '일정의 경로 근거가 너무 커요. 기간이나 장소 수를 줄여 주세요.');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(deflateRawSync(json)), cipher.final()]);
    const token = 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
    if (token.length > 1200000) throw new PlanError(413, 'SESSION_TOO_LARGE', '임시 일정 근거가 너무 커요. 기간이나 장소 수를 줄여 주세요.');
    return token;
  }
  function open(kind, id, token) {
    assertReady();
    try {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || typeof token !== 'string' || token.length > 1200000 || !/^v1\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const bytes = Buffer.from(token.slice(3),'base64url'); if (bytes.length < 29) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12)); decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12,28));
      const compressed = Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);
      const payload = JSON.parse(inflateRawSync(compressed,{maxOutputLength:8*1024*1024}).toString('utf8'));
      if (payload.kind !== kind || payload.id !== id || !Number.isFinite(payload.expires) || payload.expires <= now()) throw new Error();
      return payload.data;
    } catch { throw new PlanError(410,kind === 'plan' ? 'PLAN_EXPIRED' : 'SEARCH_EXPIRED','임시 수정·검색 근거가 만료되었거나 유효하지 않아요. 다시 생성·검색해 주세요. 저장된 일정은 직접 수정할 수 있어요.'); }
  }
  return {
    assertReady, redis:null,
    planStore: {
      save(plan) {
        const id=randomUUID(), context=getPlanContext(plan);
        const state=context?{...context,records:[...context.records],sources:[...context.sources]}:null;
        const {sessionToken: _oldToken, planId: _oldId, ...snapshot}=plan;
        return {...snapshot,planId:id,sessionToken:seal('plan',id,{plan:snapshot,context:state})};
      },
      get(id,token) { const entry=open('plan',id,token); if(entry.context)entry.context={...entry.context,records:new Map(entry.context.records),sources:new Map(entry.context.sources)}; return entry; },
    },
    placeSelections: {
      save(result) { const id=randomUUID(); return {searchId:id,searchToken:seal('search',id,result)}; },
      get(id,token) { return open('search',id,token); },
    },
  };
}
