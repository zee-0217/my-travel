// Keep a visible explanation when JavaScript modules cannot initialize.
const startup = document.querySelector('#app-startup');
const generateButton = document.querySelector('#generate-button');
if (location.protocol === 'file:') {
  startup.textContent = 'HTML 파일을 직접 열면 API와 JavaScript 모듈을 사용할 수 없어요. http://localhost:3000 에서 접속해 주세요.';
} else {
  import('/js/app.js').then(() => {
    generateButton.disabled = false;
    startup.hidden = true;
    document.documentElement.dataset.appReady = 'true';
  }).catch(() => {
    startup.textContent = '화면을 준비하지 못했어요. 개발 서버가 실행 중인지 확인하고 Ctrl+Shift+R로 새로고침해 주세요. 접속 주소는 http://localhost:3000 입니다.';
    startup.setAttribute('role', 'alert');
    generateButton.disabled = true;
    generateButton.textContent = '화면 초기화 실패 · 새로고침 필요';
    document.documentElement.dataset.appReady = 'false';
  });
}
