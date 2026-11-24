export class ToolError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function publicToolError(error) {
  if (error instanceof ToolError) return error;
  if (error?.name === 'TimeoutError') return new ToolError(504, 'ROUTES_TIMEOUT', '자동차 경로 확인 불가: 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.');
  return new ToolError(502, 'TOOL_UNAVAILABLE', '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
}
