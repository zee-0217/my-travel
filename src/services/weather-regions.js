// Representative city locations; they do not describe weather everywhere in a province/island.
const cities = [
  ['서울', 37.5665, 126.9780], ['부산', 35.1796, 129.0756], ['제주', 33.4996, 126.5312], ['서귀포', 33.2541, 126.5601],
  ['강릉', 37.7519, 128.8761], ['속초', 38.2070, 128.5918], ['경주', 35.8562, 129.2247], ['전주', 35.8242, 127.1480], ['여수', 34.7604, 127.6622],
  ['인천', 37.4563, 126.7052], ['대전', 36.3504, 127.3845], ['대구', 35.8714, 128.6014], ['광주', 35.1595, 126.8526], ['울산', 35.5384, 129.3114],
  ['세종', 36.4800, 127.2890], ['수원', 37.2636, 127.0286], ['춘천', 37.8813, 127.7298], ['청주', 36.6424, 127.4890], ['포항', 36.0190, 129.3435], ['목포', 34.8118, 126.3922],
];

export function resolveWeatherLocation(region, location) {
  if (location !== null && location !== undefined) {
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || location.latitude < 33 || location.latitude > 39 || location.longitude < 124 || location.longitude > 132) return null;
    return { latitude: location.latitude, longitude: location.longitude, label: `${region} 지정 좌표`, representative: false };
  }
  if (/경기.*광주|광주.*경기/.test(region)) return null;
  const matches = cities.filter(([name]) => region.includes(name));
  // "제주 서귀포" should select the more specific city, but conflicting city names are ambiguous.
  const specific = matches.filter(([name]) => name !== '제주' || !matches.some(([other]) => other === '서귀포'));
  if (specific.length !== 1) return null;
  const [name, latitude, longitude] = specific[0];
  return { latitude, longitude, label: `${name === '제주' ? '제주시' : name} 대표 지점`, representative: true };
}

// KMA DFS Lambert conformal grid (5 km), not Web Mercator or integer mapx/mapy.
export function toKmaGrid({ latitude, longitude }) {
  const rad = Math.PI / 180;
  const re = 6371.00877 / 5;
  const slat1 = 30 * rad, slat2 = 60 * rad;
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(Math.tan(Math.PI / 4 + slat2 / 2) / Math.tan(Math.PI / 4 + slat1 / 2));
  const sf = Math.pow(Math.tan(Math.PI / 4 + slat1 / 2), sn) * Math.cos(slat1) / sn;
  const ro = re * sf / Math.pow(Math.tan(Math.PI / 4 + 38 * rad / 2), sn);
  const ra = re * sf / Math.pow(Math.tan(Math.PI / 4 + latitude * rad / 2), sn);
  let theta = longitude * rad - 126 * rad;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) };
}
