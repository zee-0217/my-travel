// Secrets go only through child stdin to Vercel; no command-line values or logs.
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { runVercel } from './vercel-cli.mjs';
import { randomBytes } from 'node:crypto';

if (!process.argv.includes('--apply')) { console.log('Register the local .env server settings in the linked my-travel Vercel project: add --apply'); process.exit(0); }
const project=JSON.parse(await readFile('.vercel/project.json','utf8'));
if(project.projectName!=='my-travel') throw new Error('Link the intended my-travel project first.');
const local=dotenv.parse(await readFile('.env','utf8'));
const names=['OPENAI_API_KEY','OPENAI_MODEL','NAVER_API_HUB_CLIENT_ID','NAVER_API_HUB_CLIENT_SECRET','NAVER_MAPS_CLIENT_ID','NAVER_MAPS_CLIENT_SECRET','KMA_API_KEY','KMA_SERVICE_KEY','TOUR_API_KEY','WEATHER_FREE_FALLBACK','AGENT_MAX_ITERATIONS','AGENT_MAX_TOOL_CALLS','AGENT_MAX_REPLANS','AGENT_TIMEOUT_MS','AI_REQUESTS_PER_HOUR','API_REQUESTS_PER_MINUTE','SESSION_ENCRYPTION_KEY'];
const defaults={WEATHER_FREE_FALLBACK:'true',AGENT_MAX_ITERATIONS:'8',AGENT_MAX_TOOL_CALLS:'16',AGENT_MAX_REPLANS:'2',AGENT_TIMEOUT_MS:'240000',AI_REQUESTS_PER_HOUR:'30',API_REQUESTS_PER_MINUTE:'120'};
for(const name of names){
  const value=(local[name]||defaults[name]||(name==='SESSION_ENCRYPTION_KEY'?randomBytes(32).toString('base64'):'')).trim(); if(!value)continue;
  const type=/KEY|SECRET|CLIENT_ID/.test(name)?'secret':'config';
  const result=await runVercel(['env','add',name,'--environment','preview,production','--type',type,'--yes','--project','my-travel'],{input:value});
  if(result.code!==0){console.error(JSON.stringify({name,status:'failed',message:'Vercel 변수 등록 실패. 기존 값·프로젝트 권한을 확인해 주세요. 값은 출력하지 않습니다.'}));process.exit(1);}
  console.log(JSON.stringify({name,type,status:'registered',environments:['preview','production']}));
}
