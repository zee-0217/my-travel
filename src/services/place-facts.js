// This server-owned registry accepts facts checked against official sources only.
// Never fill it from request bodies, LLM prose, or unverified web snippets.
export const verifiedPlaceFacts = [];

export function getVerifiedPlaceFacts(place, date) {
  return verifiedPlaceFacts.find((fact) => fact.name === place?.name && fact.address === (place.roadAddress || place.address) && fact.date === date) || null;
}

export function placeEnvironment(place) {
  // A conservative category-based planning hint, never a verified facility guarantee.
  const category = place?.category || '';
  if (/해수욕장|해변|계곡|수목원|도시공원/.test(category)) return { type: 'outdoor', basis: 'NAVER 검색 카테고리 기반 분류 (시설 상세 확인 필요)' };
  return { type: 'unknown', basis: '실내·실외 유형 확인 필요' };
}
