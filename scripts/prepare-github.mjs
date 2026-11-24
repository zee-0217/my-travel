// Local preparation only. A push is a separate explicit command.
import { spawnSync } from 'node:child_process';
const cwd=process.cwd();
function run(program,args,{allowFailure=false}={}) {
  const result=spawnSync(program,args,{encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
  if(result.status!==0&&!allowFailure) throw new Error(`${program} ${args[0]} failed. Check authentication and repository permissions.`);
  return {status:result.status,output:(result.stdout||'').trim()};
}
const git=(args,options)=>run('git',['-c',`safe.directory=${cwd.replaceAll('\\','/')}`,...args],options);
const scan=spawnSync(process.execPath,['scripts/check-secrets.mjs'],{stdio:'inherit'}); if(scan.status!==0)process.exit(1);
const remote='https://github.com/zee-0217/my-travel.git';
const existing=git(['remote','get-url','origin'],{allowFailure:true});
if(existing.status===0&&existing.output!==remote) throw new Error('Existing origin differs; preserve it and review manually.');
if(existing.status!==0)git(['remote','add','origin',remote]);
if(git(['rev-parse','--verify','HEAD'],{allowFailure:true}).status!==0)git(['symbolic-ref','HEAD','refs/heads/main']);
if(git(['config','--get','user.name'],{allowFailure:true}).status!==0||git(['config','--get','user.email'],{allowFailure:true}).status!==0){
  const user=JSON.parse(run('gh',['api','user','--jq','{login:.login,id:.id}']).output);
  if(!/^[a-zA-Z0-9-]+$/.test(user.login)||!Number.isSafeInteger(user.id))throw new Error('Could not determine authenticated GitHub author.');
  if(git(['config','--get','user.name'],{allowFailure:true}).status!==0)git(['config','--local','user.name',user.login]);
  if(git(['config','--get','user.email'],{allowFailure:true}).status!==0)git(['config','--local','user.email',`${user.id}+${user.login}@users.noreply.github.com`]);
}
git(['add','--all']);
const staged=git(['diff','--cached','--name-only']).output.split(/\r?\n/).filter(Boolean);
if(staged.some((file)=>/^\.env(?:\.|$)/.test(file)&&file!=='.env.example'))throw new Error('A secret environment file is staged.');
const after=spawnSync(process.execPath,['scripts/check-secrets.mjs'],{stdio:'inherit'}); if(after.status!==0)process.exit(1);
console.log(JSON.stringify({status:'prepared',branch:git(['branch','--show-current']).output,remote,stagedFiles:staged.length}));
