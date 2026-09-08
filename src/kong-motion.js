import {KONG_HAND as HAND} from './kong-hand-samples.js';
export function kongHandPose(origin,u,out={}){
  u=Math.max(0,Math.min(1,u));let a=HAND[0],b=HAND.at(-1);
  for(let i=1;i<HAND.length;i++)if(u<=HAND[i][0]){a=HAND[i-1];b=HAND[i];break;}
  const f=(u-a[0])/(b[0]-a[0]),x=a[1]+(b[1]-a[1])*f,y=a[2]+(b[2]-a[2])*f,z=a[3]+(b[3]-a[3])*f;
  const sn=Math.sin(origin.heading),cs=Math.cos(origin.heading);
  out.x=origin.x+cs*x+sn*z;out.z=origin.z-sn*x+cs*z;out.y=y;return out;
}
