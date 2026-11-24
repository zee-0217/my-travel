export class PlacesError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function publicPlacesError(error) {
  if (error instanceof PlacesError) return error;
  if (error?.name === 'TimeoutError') {
    return new PlacesError(504, 'PLACES_TIMEOUT', '장소 검색 응답이 늦어지고 있어요. 잠시 후 다시 검색해 주세요.');
  }
  return new PlacesError(502, 'PLACES_UNAVAILABLE', '장소 검색에 연결하지 못했어요. 잠시 후 다시 검색해 주세요.');
}
