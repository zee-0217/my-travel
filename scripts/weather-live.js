import { kstDate } from '../src/services/kma-weather.js';
import { get_weather } from '../src/services/weather.js';

const region = process.argv[2] || '부산';
const date = process.argv[3] || kstDate(new Date());
try {
  const result = await get_weather({ region, date, location: null });
  console.log(JSON.stringify(result, null, 2));
  if (!result.available) console.log('날씨 미확인: 실제 예보가 확인된 것으로 처리하지 않습니다.');
} catch (error) {
  console.error(JSON.stringify({ code: error.code || 'WEATHER_ERROR', message: error.code ? error.message : '날씨 조회 실패' }));
  process.exitCode = 1;
}
