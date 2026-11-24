export const destinations = [
  { region: '서울', name: '경복궁', image: '/images/destinations/seoul.jpg', file: 'GyeongbokgungPalace.JPG', author: 'Grayswoodsurrey', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', preferences: ['관광', '맛집'] },
  { region: '전주', name: '한옥마을', image: '/images/destinations/jeonju.jpg', file: 'Jeonju Hanok Maeul 02.jpg', author: 'Bernard Gagnon', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', preferences: ['관광', '맛집'] },
  { region: '여수', name: '돌산대교', image: '/images/destinations/yeosu.jpg', file: 'Dolsan Bridge 20180929 003.jpg', author: 'Mobius6', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', preferences: ['자연', '맛집'] },
  { region: '순천', name: '순천만 정원', image: '/images/destinations/suncheon.jpg', file: 'Panorama of International Garden Exposition Suncheon Bay Korea 2013.jpg', author: 'Donghwan Seong', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', preferences: ['자연', '휴식'] },
  { region: '속초', name: '설악산 울산바위', image: '/images/destinations/sokcho.jpg', file: 'Ulsanbawi.jpg', author: 'Jkp008~commonswiki', license: 'Public domain', licenseUrl: 'https://commons.wikimedia.org/wiki/File:Ulsanbawi.jpg#Licensing', preferences: ['자연', '휴식'] },
  { region: '제주도', name: '성산일출봉', image: '/images/destinations/jeju.jpg', file: 'Hydrangea macrophylla in front of Seongsan Ilchulbong volcano at blue hour in Jeju Island South Korea.jpg', author: 'Basile Morin', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', preferences: ['자연', '휴식'] },
  { region: '부산', name: '해운대 해수욕장', image: '/images/destinations/busan.jpg', file: 'Busan City Haeundae Beach KOGL (01).jpg', author: '부산광역시', license: '공공누리 제1유형', licenseUrl: 'https://www.kogl.or.kr/info/licenseType1.do', preferences: ['맛집', '관광'] },
  { region: '경주', name: '동궁과 월지', image: '/images/destinations/gyeongju.jpg', file: 'Donggung Palace & Wolji Pond, Gyeongju - Donggung2691.jpg', author: 'lumoplank', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', preferences: ['관광', '휴식'] },
  { region: '강릉', name: '경포해변', image: '/images/destinations/gangneung.jpg', file: 'Gyeongpo Beach 1.jpg', author: 'Christophe95', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', preferences: ['자연', '맛집'] },
];

let currentDestination = destinations[0];
export const getCurrentDestination = () => currentDestination;

export function chooseDestination(excludeRegion = null) {
  const pool = destinations.filter((destination) => destination.region !== excludeRegion);
  return pool[Math.floor(Math.random() * pool.length)];
}

export function showDestination(destination) {
  currentDestination = destination;
  const image = document.querySelector('#hero-destination-image');
  image.src = destination.image; image.alt = `${destination.region} ${destination.name}의 실제 풍경`;
  document.querySelector('#hero-destination-name').textContent = `${destination.region} · ${destination.name}`;
  const credit = document.querySelector('#hero-photo-credit');
  credit.href = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(destination.file)}`;
  credit.textContent = `사진 ${destination.author} · ${destination.license}`;
  const license = document.querySelector('#hero-photo-license'); license.href = destination.licenseUrl;
  image.onerror = () => {
    image.onerror = null; image.src = '/images/coastal-trip.svg'; image.alt = '바다와 산 사이를 여행하는 자동차 일러스트';
    document.querySelector('#hero-destination-name').textContent = `${destination.region}로 떠나볼까요?`;
    credit.textContent = '여행 한 조각 · 여행 일러스트'; credit.removeAttribute('href'); license.hidden = true;
  };
  license.hidden = false;
  document.querySelector('#hero-photo-position').textContent = `${destinations.indexOf(destination) + 1} / ${destinations.length}`;
  document.querySelector('#random-trip-hint').textContent = `${destination.region} 여행 조건으로 시작해 보세요`;
}

export function initDestinationCarousel() {
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let hovering = false;
  const frame = document.querySelector('.hero-art');
  const toggle = document.querySelector('#hero-photo-toggle');
  const update = () => { toggle.textContent = paused ? '자동 넘김 재생' : '자동 넘김 일시정지'; toggle.setAttribute('aria-pressed', String(paused)); };
  const next = (direction) => showDestination(destinations[(destinations.indexOf(currentDestination) + direction + destinations.length) % destinations.length]);
  document.querySelector('#hero-photo-prev').addEventListener('click', () => next(-1));
  document.querySelector('#hero-photo-next').addEventListener('click', () => next(1));
  toggle.addEventListener('click', () => { paused = !paused; update(); });
  frame.addEventListener('mouseenter', () => { hovering = true; });
  frame.addEventListener('mouseleave', () => { hovering = false; });
  setInterval(() => { if (!paused && !hovering && !document.hidden && !frame.contains(document.activeElement)) next(1); }, 6500);
  update();
}
