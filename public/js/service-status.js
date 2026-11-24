export async function renderServiceStatus() {
  const container = document.querySelector('#service-status-list');
  const note = document.querySelector('#service-status-note');
  try {
    const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (!Array.isArray(data.services)) throw new Error('Invalid response');
    const missing = data.services.filter((service) => !service.configured).length;
    document.querySelector('#service-status-count').textContent = missing ? `· ${missing}개 설정 필요` : '· 인증 설정 있음';
    container.replaceChildren(...data.services.map((service) => {
      const item = document.createElement('li'); item.className = 'service-status-item';
      const title = document.createElement('strong'); title.textContent = service.name;
      const state = document.createElement('span'); state.textContent = service.configured ? '인증 설정 있음 · 실제 호출 시 확인' : '연결 설정 필요'; state.className = service.configured ? 'service-ready' : 'service-missing';
      const description = document.createElement('p'); description.textContent = service.message;
      item.append(title, state, description); return item;
    }));
    note.textContent = '서버에 로드된 설정 여부입니다. API 성공을 보장하는 연결 검사가 아니며, 이 표시 자체로 유료 API를 호출하지 않습니다. .env를 바꾼 뒤에는 서버를 재시작해 주세요.';
  } catch {
    document.querySelector('#service-status-count').textContent = '· 확인 필요';
    note.textContent = '서버 설정 상태를 불러오지 못했어요. http://localhost:3000 접속과 개발 서버 실행 상태를 확인해 주세요.';
  }
}
