import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createGameServer} from '../server.mjs';

// Only the built game and its multiplayer endpoint are served by this process.
const runtimeDir=path.join(process.env.LOCALAPPDATA,'ShougangPixelCircuit');
const executable=path.join(runtimeDir,'tools','cloudflared.exe');
if(!fs.existsSync(executable))throw new Error('请先使用“启动外网联机.ps1”准备分享工具。');
const publicConfig=JSON.parse(fs.readFileSync(new URL('../public-client.json',import.meta.url),'utf8'));
const app=createGameServer({port:Number(process.argv[2]||4199),publicPage:publicConfig.pageUrl});
const address=await app.listen();
const infoFile=path.join(runtimeDir,'share-session.json');
let publicOrigin='',connected=false,stopping=false;
const tunnel=spawn(executable,['tunnel','--no-autoupdate','--protocol','http2','--url',`http://127.0.0.1:${address.port}`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
function save(status){
  fs.mkdirSync(runtimeDir,{recursive:true});
  fs.writeFileSync(infoFile,JSON.stringify({pid:process.pid,tunnelPid:tunnel.pid,port:address.port,origin:status==='ready'?publicOrigin:'',status,updatedAt:new Date().toISOString()},null,2));
}
save('connecting');
let logTail='';
function readLog(chunk){
  process.stdout.write(chunk);
  logTail=(logTail+chunk.toString()).slice(-6000);
  const match=logTail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if(match)publicOrigin=match[0];
  if(logTail.includes('Registered tunnel connection'))connected=true;
  if(publicOrigin&&connected&&app.multiplayer.publicOrigin!==publicOrigin){app.multiplayer.setPublicOrigin(publicOrigin);save('ready');}
}
tunnel.stdout.on('data',readLog);tunnel.stderr.on('data',readLog);
tunnel.on('error',error=>{process.stderr.write(`${error.message}\n`);app.multiplayer.setPublicOrigin('');save('error');});
tunnel.on('exit',()=>{app.multiplayer.setPublicOrigin('');save(stopping?'stopped':'error');});
async function stop(){if(stopping)return;stopping=true;tunnel.kill();save('stopped');await app.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
process.stdout.write(`Local game: http://127.0.0.1:${address.port}/?multiplayer=1\n`);
