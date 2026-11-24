import { readFileSync, existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { spawn } from 'node:child_process';

export function runVercel(args, { input, timeoutMs = 120000 } = {}) {
  let entry;
  for (const directory of (process.env.PATH || process.env.Path || '').split(delimiter)) {
    const root = resolve(directory, '../vercel'), metadata = resolve(root, 'package.json');
    if (!existsSync(metadata)) continue;
    const pkg = JSON.parse(readFileSync(metadata,'utf8')), bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.vercel || pkg.bin.vc;
    if (bin) { entry = resolve(root,bin); break; }
  }
  if (!entry) throw new Error('Run this script with: npx --yes --package vercel node scripts/<script>.mjs');
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath,[entry,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr=''; child.stdout.on('data',(chunk)=>{stdout+=chunk;}); child.stderr.on('data',(chunk)=>{stderr+=chunk;});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Vercel CLI timed out.'));},timeoutMs);
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Vercel CLI could not start.'));});
    child.on('close',(code)=>{clearTimeout(timer);resolveResult({code,stdout,stderr});});
    child.stdin.on('error',()=>{}); child.stdin.end(input || '');
  });
}
