export const PUBLIC_BUILD=import.meta.env?.MODE==='public';
export function assetUrl(value){return `${import.meta.env?.BASE_URL||'/'}${value.replace(/^\//,'')}`;}

export async function multiplayerEndpoint(){
  if(!PUBLIC_BUILD)return location.origin;
  const invited=new URLSearchParams(location.search).get('server');
  if(invited){try{const url=new URL(invited);if(url.protocol==='https:'&&url.hostname.endsWith('.trycloudflare.com')&&!url.username&&!url.password)return url.origin;}catch{}}
  let config;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(assetUrl('runtime.json'),{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('联机入口暂未开放，单人比赛仍可体验。');
      config=await response.json();break;
    }catch(error){if(attempt===1)throw error;}
  }
  const url=new URL(config.multiplayerOrigin);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('联机服务器配置无效。');
  return url.origin;
}
