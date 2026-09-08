export const GRANNY=Object.freeze({progress:.09,height:2.65,walkSpeed:9.25,blockSeconds:2,standSeconds:.28,cooldown:9,hitRadius:1.65});
export const GRANNY_CROSSINGS=Object.freeze([
  {id:0,progress:GRANNY.progress,name:'西侧街道'},
  {id:1,progress:.42,name:'北侧展馆大道'},
  {id:2,progress:.64,name:'东侧直道'},
].map(Object.freeze));
export const granniesForState=state=>state.grannies??(state.granny?[state.granny]:[]);

/** Match each pedestrian by crossing, including when network packet order changes. */
export function interpolateGrannies(from,to,t,time){
  const mix=(a,b)=>a+(b-a)*t;
  return to.map(gb=>{
    const ga=from.find(g=>(g.crossingId??0)===(gb.crossingId??0))??gb,phase=t<1?ga:gb;
    return {...phase,time,x:mix(ga.x,gb.x),z:mix(ga.z,gb.z),stride:mix(ga.stride,gb.stride),
      heading:ga.heading+Math.atan2(Math.sin(gb.heading-ga.heading),Math.cos(gb.heading-ga.heading))*t};
  });
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
/** Swept relative motion prevents fast karts tunnelling through the crossing. */
export function crossingContact(car,from,to){
  const ax=(car._stepX??car.x)-from.x,az=(car._stepZ??car.z)-from.z;
  const dx=car.x-to.x-ax,dz=car.z-to.z-az,l=dx*dx+dz*dz;
  const t=l>1e-10?clamp(-(ax*dx+az*dz)/l,0,1):0;
  return Math.hypot(ax+dx*t,az+dz*t)<=GRANNY.hitRadius?t:null;
}
export class GrannyEncounter{
  constructor({track,crossing=GRANNY_CROSSINGS[0],onHit=()=>false,onEvent=()=>{}}){
    this.track=track;this.onHit=onHit;this.onEvent=onEvent;this.progress=crossing.progress;this.center=track.getPoint(this.progress);
    const tangent=track.getTangent(this.progress);this.normal={x:tangent.z,z:-tangent.x};this.edge=track.width/2+1.5;
    const direction=crossing.id%2?-1:1,lane=-direction*this.edge,p=this.point(lane);
    this.state={crossingId:crossing.id,progress:this.progress,phase:'waiting',at:0,time:0,nextAt:.7+crossing.id*.65,x:p.x,z:p.z,heading:Math.atan2(this.normal.x*direction,this.normal.z*direction),lane,direction,stride:0,hitId:0,targetId:null,hits:0};
  }
  point(lane){return {x:this.center.x+this.normal.x*lane,z:this.center.z+this.normal.z*lane};}
  setPhase(phase){this.state.phase=phase;this.state.at=this.state.time;}
  update(dt,vehicles,phase,time){
    if(phase!=='racing')return;const s=this.state;s.time=time;
    if(s.phase==='waiting'){
      if(time<s.nextAt)return;
      const approaching=vehicles.some(v=>!v.crash&&!v.grannyBlock&&!v.finished&&!v.dnf&&((this.progress-v.progress+1)%1)*this.track.length<36);
      if(!approaching&&time-s.nextAt<18)return;
      s.lane=-s.direction*this.edge;Object.assign(s,this.point(s.lane));s.heading=Math.atan2(this.normal.x*s.direction,this.normal.z*s.direction);s.targetId=null;this.setPhase('crossing');return;
    }
    if(s.phase==='sitting'){
      const age=time-s.at;
      const approach=smooth(age/.13),leave=smooth((age-(GRANNY.blockSeconds-GRANNY.standSeconds))/GRANNY.standSeconds);
      s.x=s.hitFrom.x+(s.front.x-s.hitFrom.x)*approach+(s.clear.x-s.front.x)*leave;
      s.z=s.hitFrom.z+(s.front.z-s.hitFrom.z)*approach+(s.clear.z-s.front.z)*leave;
      if(age+1e-9>=GRANNY.blockSeconds){this.onEvent('granny-clear',{vehicleId:s.targetId,crossingId:s.crossingId,hitId:s.hitId});this.setPhase('returning');s.returnFrom={x:s.x,z:s.z};s.returnTo=this.point(s.direction*this.edge);s.returnDuration=Math.max(.1,Math.hypot(s.returnTo.x-s.x,s.returnTo.z-s.z)/GRANNY.walkSpeed);s.heading=Math.atan2(s.returnTo.x-s.x,s.returnTo.z-s.z);}
      return;
    }
    if(s.phase==='returning'){
      const u=clamp((time-s.at)/s.returnDuration,0,1);s.x=s.returnFrom.x+(s.returnTo.x-s.returnFrom.x)*u;s.z=s.returnFrom.z+(s.returnTo.z-s.returnFrom.z)*u;s.stride+=GRANNY.walkSpeed*dt;
      if(u>=1){s.direction*=-1;s.nextAt=time+GRANNY.cooldown;this.setPhase('waiting');}return;
    }
    const old={x:s.x,z:s.z};s.lane+=s.direction*GRANNY.walkSpeed*dt;Object.assign(s,this.point(s.lane));s.stride+=GRANNY.walkSpeed*dt;
    const contacts=[];
    for(const v of vehicles){
      if(v.crash||v.grannyBlock||v.finished||v.dnf||Math.abs(v.speed)<.8)continue;
      const contact=crossingContact(v,old,s);if(contact!==null)contacts.push({v,contact});
    }
    contacts.sort((a,b)=>a.contact-b.contact||a.v.id-b.v.id);
    for(const {v,contact} of contacts)if(this.onHit(v,s,contact)){
      s.hitFrom={x:s.x,z:s.z};s.hitId++;s.hits++;s.targetId=v.id;s.heading=v.heading+Math.PI;
      const fx=Math.sin(v.heading),fz=Math.cos(v.heading),side=s.direction;
      s.front={x:v.x+fx*2.25,z:v.z+fz*2.25};s.clear={x:s.front.x+fz*side*2.7,z:s.front.z-fx*side*2.7};
      this.setPhase('sitting');this.onEvent('granny-hit',{vehicleId:v.id,crossingId:s.crossingId,hitId:s.hitId,x:v.x,z:v.z});return;
    }
    if(Math.abs(s.lane)>=this.edge&&s.lane*s.direction>0){s.direction*=-1;s.nextAt=time+GRANNY.cooldown;this.setPhase('waiting');}
  }
}
