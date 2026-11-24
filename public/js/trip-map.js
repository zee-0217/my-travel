const sdkUrl = 'https://oapi.map.naver.com/openapi/v3/maps.js';
let sdkPromise;
let authFailed = false;
let onAuthenticationFailure = () => {};

export const validPoint = (point) => Boolean(point && Number.isFinite(point.longitude) && Number.isFinite(point.latitude) && Math.abs(point.longitude) <= 180 && Math.abs(point.latitude) <= 90 && (point.longitude !== 0 || point.latitude !== 0));
export function extractDayMapData(day) {
  const markers = (day?.stops || []).flatMap((stop, index) => validPoint(stop.place?.coordinates) ? [{ index, title: stop.title, ...stop.place.coordinates }] : []);
  (day?.lodgings || []).forEach((stay, index) => { if (validPoint(stay.place?.coordinates)) markers.push({ index: (day?.stops?.length || 0) + index, kind: 'lodging', id: stay.id, title: stay.title, ...stay.place.coordinates }); });
  const paths = [...(day?.stops || []), ...(day?.lodgingRoutes || []).map((route) => ({ route }))].flatMap((stop) => {
    const path = stop.route?.path;
    if (!stop.route?.available || !Array.isArray(path) || path.length < 2 || !path.every((point) => Array.isArray(point) && point.length === 2 && validPoint({ longitude: point[0], latitude: point[1] }))) return [];
    return [path];
  });
  return { markers, paths };
}

async function loadSDK() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    const response = await fetch('/api/maps/config', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('지도 설정을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
    const config = await response.json();
    if (!config.enabled || !config.clientId) throw new Error('지도 Client ID가 설정되지 않았어요. 서버의 NAVER_MAPS_CLIENT_ID를 확인해 주세요.');
    return new Promise((resolve, reject) => {
      authFailed = false;
      let finished = false;
      const timer = setTimeout(() => fail(new Error('지도를 불러오는 시간이 길어지고 있어요. 네트워크 상태를 확인해 주세요.')), 15000);
      function fail(error) { if (finished) return; finished = true; clearTimeout(timer); reject(error); }
      window.navermap_authFailure = () => {
        authFailed = true;
        const error = new Error('지도 인증에 실패했어요. NCP에서 Web Dynamic Map 활성화와 현재 주소의 Web 서비스 URL 등록을 확인해 주세요.');
        onAuthenticationFailure(error);
        fail(error);
      };
      // Some SDK builds invoke the callback just before publishing the global Map constructor.
      // Wait for the constructor, not merely for script onload or a namespace object.
      function waitForMap() {
        if (finished) return;
        if (authFailed) return fail(new Error('지도 인증에 실패했어요. Web Dynamic Map과 Web 서비스 URL 설정을 확인해 주세요.'));
        if (typeof window.naver?.maps?.Map !== 'function') { setTimeout(waitForMap, 25); return; }
        finished = true; clearTimeout(timer); resolve(window.naver.maps);
      }
      window.__travelMapReady = () => setTimeout(waitForMap, 0);
      document.querySelector('#naver-maps-sdk')?.remove();
      const script = document.createElement('script');
      script.id = 'naver-maps-sdk'; script.async = true;
      script.src = `${sdkUrl}?${new URLSearchParams({ ncpKeyId: config.clientId, callback: '__travelMapReady' })}`;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.onerror = () => fail(new Error('지도 SDK를 불러오지 못했어요. 네트워크 상태를 확인해 주세요.'));
      script.onload = () => setTimeout(waitForMap, 0);
      document.head.append(script);
    });
  })().catch((error) => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

export function createTripMap({ onSelect }) {
  const container = document.querySelector('#naver-map');
  const placeholder = document.querySelector('#map-placeholder');
  const status = document.querySelector('#map-status');
  const summary = document.querySelector('#map-summary');
  const retry = document.querySelector('#map-retry');
  let map;
  let maps;
  let overlays = [];
  let selected = 0;
  let revision = 0;
  let lastDay;
  let mapMarkers = [];
  const clear = () => { overlays.forEach((item) => { try { maps?.Event.clearInstanceListeners(item); item.setMap(null); } catch { /* A failed SDK must not affect itinerary rendering. */ } }); overlays = []; mapMarkers = []; };
  function fail(error) {
    clear();
    try { map?.destroy?.(); } catch { /* SDK may be partially initialized. */ }
    map = undefined;
    container.hidden = true; placeholder.hidden = false;
    placeholder.textContent = '지도를 표시할 수 없어요';
    status.textContent = error.message;
    status.dataset.state = 'error'; retry.hidden = false;
    container.dataset.state = 'error';
  }
  onAuthenticationFailure = fail;
  function select(index) {
    selected = index;
    try {
      mapMarkers.forEach(({ marker, index: markerIndex }) => marker.setZIndex(markerIndex === index ? 100 : markerIndex + 1));
      const chosen = mapMarkers.find((item) => item.index === index);
      if (chosen && map && container.dataset.state === 'ready') map.panTo(chosen.marker.getPosition());
    } catch { fail(new Error('지도 이동을 완료하지 못했어요. 지도를 다시 불러와 주세요.')); }
  }
  async function update(day) {
    lastDay = day;
    const current = ++revision;
    const data = extractDayMapData(day);
    clear();
    container.dataset.markerCount = '0';
    container.dataset.routeCount = '0';
    summary.textContent = `확인된 장소 ${data.markers.length}개 · 실제 자동차 경로 ${data.paths.length}개`;
    retry.hidden = true;
    if (!data.markers.length) {
      container.hidden = true; placeholder.hidden = false;
      placeholder.textContent = '좌표가 확인된 장소가 아직 없어요';
      status.textContent = '실제 검색 좌표가 있는 장소만 지도에 표시합니다.';
      container.dataset.state = 'empty';
      return;
    }
    status.textContent = 'NAVER 지도를 불러오고 있어요…';
    container.dataset.state = 'loading';
    try {
      maps = await loadSDK();
      if (current !== revision) return;
      if (authFailed) throw new Error('지도 인증에 실패했어요. Web Dynamic Map과 Web 서비스 URL 등록을 확인해 주세요.');
      container.hidden = false; placeholder.hidden = true;
      if (!map) map = new maps.Map(container, { center: new maps.LatLng(data.markers[0].latitude, data.markers[0].longitude), zoom: 12, zoomControl: true });
      const bounds = new maps.LatLngBounds();
      for (const item of data.markers) {
        const position = new maps.LatLng(item.latitude, item.longitude);
        const marker = new maps.Marker({ map, position, title: item.title, icon: { content: `<span class="naver-stop-marker${item.kind === 'lodging' ? ' lodging-map-marker' : ''}">${item.kind === 'lodging' ? '숙' : item.index + 1}</span>`, anchor: new maps.Point(16, 32) } });
        maps.Event.addListener(marker, 'click', () => onSelect(item.index, item));
        mapMarkers.push({ marker, index: item.index }); overlays.push(marker); bounds.extend(position);
      }
      for (const path of data.paths) {
        const positions = path.map(([longitude, latitude]) => new maps.LatLng(latitude, longitude));
        overlays.push(new maps.Polyline({ map, path: positions, strokeColor: '#0877b1', strokeWeight: 5, strokeOpacity: 0.85 }));
        positions.forEach((position) => bounds.extend(position));
      }
      map.setSize(new maps.Size(container.clientWidth, container.clientHeight));
      if (data.markers.length === 1 && !data.paths.length) { map.setCenter(new maps.LatLng(data.markers[0].latitude, data.markers[0].longitude)); map.setZoom(14); }
      else map.fitBounds(bounds, { top: 36, right: 36, bottom: 36, left: 36 });
      container.dataset.state = 'ready';
      container.dataset.markerCount = String(data.markers.length);
      container.dataset.routeCount = String(data.paths.length);
      status.textContent = data.paths.length ? '선택한 날짜의 실제 검색 장소와 조회된 자동차 경로입니다.' : '선택한 날짜의 실제 검색 장소입니다. 조회된 경로 선형이 없어 경로는 그리지 않습니다.';
      status.dataset.state = 'ready';
      mapMarkers.forEach(({ marker, index }) => marker.setZIndex(index === selected ? 100 : index + 1));
    } catch (error) { if (current === revision) fail(error); }
  }
  retry.addEventListener('click', () => {
    clear(); map?.destroy?.(); map = undefined; sdkPromise = undefined; authFailed = false;
    container.replaceChildren();
    void update(lastDay);
  });
  new ResizeObserver(() => {
    if (map && container.dataset.state === 'ready' && !container.hidden && container.clientWidth && container.clientHeight) {
      try { map.setSize(new maps.Size(container.clientWidth, container.clientHeight)); } catch { fail(new Error('지도 크기를 조정하지 못했어요. 지도를 다시 불러와 주세요.')); }
    }
  }).observe(container);
  return { update, select };
}
