export class PlanError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Never forward upstream error messages, headers, prompts, or stack traces.
export function publicPlanError(error) {
  if (error instanceof PlanError) return error;
  if (error?.name === 'APIConnectionTimeoutError' || error?.name === 'TimeoutError') {
    return new PlanError(504, 'AI_TIMEOUT', 'AI 응답 시간이 길어지고 있어요. 잠시 후 다시 시도해 주세요.');
  }
  if (error?.status === 401 || error?.status === 403) {
    return new PlanError(503, 'AI_AUTH_ERROR', '서버의 OpenAI 인증 설정이나 사용 권한을 확인해 주세요.');
  }
  if (error?.status === 429) {
    return new PlanError(429, 'AI_RATE_LIMIT', 'OpenAI 요청 한도나 사용 가능 잔액을 확인하고 잠시 후 다시 시도해 주세요.');
  }
  if (error?.status === 400 || error?.status === 404) {
    return new PlanError(503, 'AI_MODEL_ERROR', 'OPENAI_MODEL이 Responses API와 구조화된 출력을 지원하는지, 계정에서 사용할 수 있는지 확인해 주세요.');
  }
  let cause = error;
  for (let depth = 0; cause && depth < 5; depth++, cause = cause.cause) {
    if (['EACCES', 'EPERM'].includes(cause.code)) return new PlanError(503, 'AI_CONNECTION_BLOCKED', '개발 서버의 외부 API 통신이 차단됐어요. 서버 실행 환경의 네트워크 권한·방화벽·프록시를 확인해 주세요. API 키를 바꾸는 것만으로 해결되지 않을 수 있습니다.');
    if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'].includes(cause.code)) return new PlanError(502, 'AI_CONNECTION_ERROR', '서버에서 OpenAI에 연결하지 못했어요. 인터넷 연결·프록시·방화벽을 확인하고 다시 시도해 주세요.');
  }
  return new PlanError(502, 'AI_UNAVAILABLE', 'AI 여행 계획을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
}
