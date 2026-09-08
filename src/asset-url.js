export const PUBLIC_BUILD=import.meta.env?.MODE==='public';
export function assetUrl(value){return `${import.meta.env?.BASE_URL||'/'}${value.replace(/^\//,'')}`;}

export async function multiplayerEndpoint(){
  if(!PUBLIC_BUILD)return location.origin;
  const invited=new URLSearchParams(location.search).get('server');
  if(invited){try{const url=new URL(invited);if(url.protocol==='https:'&&url.hostname.endsWith('.trycloudflare.com')&&!url.username&&!url.password)return url.origin;}catch{}}
  const response=await fetch(assetUrl('runtime.json'),{cache:'no-store',signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw new Error('联机入口暂未开放，单人比赛仍可体验。');
  const config=await response.json();
  const url=new URL(config.multiplayerOrigin);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('联机服务器配置无效。');
  return url.origin;
}
