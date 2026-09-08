const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** Circular travel, a neutral centre and gentle independent pedal/steering axes. */
export function joystickInput(x,y,radius){
  const length=Math.hypot(x,y),travel=Math.min(length,Math.max(1,radius));
  const dx=length?x/length*travel:0,dy=length?y/length*travel:0;
  const strength=clamp((travel/Math.max(1,radius)-.14)/.86,0,1);
  const axis=v=>Math.sign(v)*Math.pow(clamp((Math.abs(v)-.08)/.92,0,1),1.15);
  return {dx,dy,x:axis(length?x/length*strength:0),y:axis(length?y/length*strength:0)};
}
