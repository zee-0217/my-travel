import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const cwd = process.cwd();
const git = (args) => spawnSync('git', ['-c', `safe.directory=${cwd.replaceAll('\\','/')}`, ...args], { encoding: 'utf8' });
const listing = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
if (listing.status !== 0) { console.error('Git 작업 폴더에서 실행해 주세요.'); process.exit(1); }
let local = {}; try { local = dotenv.parse(await readFile('.env', 'utf8')); } catch { /* CI has no .env. */ }
const values = Object.entries(local).filter(([name, value]) => /KEY|SECRET|TOKEN|PASSWORD/.test(name) && value.trim().length >= 8).flatMap(([, value]) => {
  const variants = [value.trim(), encodeURIComponent(value.trim())]; try { variants.push(decodeURIComponent(value.trim())); } catch { /* Already raw. */ } return variants;
});
const candidates = [...new Set(listing.stdout.split('\0').filter(Boolean))];
const findings = [];
for (const file of candidates) {
  if (/(^|\/)(?:\.env(?:\..+)?|\.envrc)$/.test(file) && file !== '.env.example') { findings.push({ file, reason: '환경 비밀 파일 포함' }); continue; }
  if (/(?:^|\/)(?:\.vercel|\.aws|\.local-preview|node_modules)\//.test(file) || /\.(?:pem|key|har|zip)$/.test(file)) { findings.push({ file, reason: '비공개·생성 파일 포함' }); continue; }
  const bytes = await readFile(resolve(cwd, file)); if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  if (values.some((secret) => text.includes(secret))) findings.push({ file, reason: '로컬 인증값과 일치하는 내용 발견' });
  const matches = text.match(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/g) || [];
  if (matches.some((value) => !/test|example|placeholder|fixture/i.test(value))) findings.push({ file, reason: 'OpenAI 키 형태 발견' });
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.push({ file, reason: '개인키 형태 발견' });
}
const example = dotenv.parse(await readFile('.env.example','utf8'));
if (Object.entries(example).some(([key,value]) => /API_KEY|SERVICE_KEY|CLIENT_ID|CLIENT_SECRET|REST_TOKEN|REST_URL/.test(key) && value)) findings.push({ file: '.env.example', reason: '인증 설정 예시 값은 비워야 함' });
const ignored = git(['check-ignore', '--no-index', '.env', '.env.production', '.vercel/project.json', '.local-preview/preview.png']);
if (ignored.status !== 0 || ignored.stdout.trim().split(/\r?\n/).length < 4) findings.push({ file: '.gitignore', reason: '비밀·로컬 파일 제외 규칙 확인 필요' });
console.log(JSON.stringify({ status: findings.length ? 'failed' : 'passed', checkedFiles: candidates.length, checkedLocalSecretValues: values.length, findings }));
if (findings.length) process.exitCode = 1;
