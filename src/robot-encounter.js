import {ROBOT_SITE} from './robot-config.js';
import {RobotBarrage} from './robot-barrage.js';

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const wrap=t=>((t%1)+1)%1;
const WARNING_SECONDS=1.6;

/** A deterministic encounter clock; rendering never chooses targets or hits. */
export class RobotEncounter {
  constructor({track,seed=1337,kartRadius=1.55,position=ROBOT_SITE,onEvent=()=>{},onHit=()=>{}}={}){
    this.track=track;this.width=track.width||10;this.seed=seed>>>0;this.kartRadius=kartRadius;
    this.position=position;this.onEvent=onEvent;this.onHit=onHit;
    this.reset();
  }

  reset(){
    // A separate stream preserves the existing AI and item random sequences.
    this._rng=(this.seed^0x9e3779b9)>>>0;this._hitIds=new Set();this._impactFired=false;
    const near=this.track.closest(this.position.x,this.position.z);
    const p=this.track.getPoint(near.t);
    this.barrage=new RobotBarrage({track:this.track,position:this.position,kartRadius:this.kartRadius,onEvent:this.onEvent,onHit:this.onHit});
    this.state={phase:'idle',kind:'slam',attackId:0,targetId:null,
      aim:Object.freeze({x:p.x,y:p.y??this.track.y??0,z:p.z}),radius:2,
      phaseTime:0,phaseDuration:0,cooldown:.8,position:this.position,
      triggerRadius:42,reach:45,impactFraction:.35,impactTime:.098,impacted:false,barrage:this.barrage.state};
    return this.state;
  }

  update(dt,vehicles,phase='racing'){
    if(phase!=='racing'||!Number.isFinite(dt)||dt<=0)return this.state;
    dt=Math.min(dt,.25);const state=this.state;
    this.barrage.update(dt,vehicles);
    state.phaseTime+=dt;
    if(state.phase==='idle'){
      state.cooldown=Math.max(0,state.cooldown-dt);
      if(state.cooldown>0)return state;
      const candidates=vehicles.filter(v=>!v.finished&&!v.dnf&&!v.crash&&Number.isFinite(v.x)&&Number.isFinite(v.z)&&Math.hypot(v.x-this.position.x,v.z-this.position.z)<=state.triggerRadius);
      if(candidates.length)this._warn(candidates[Math.floor(this._random()*candidates.length)]);
    }else if(state.phase==='warning'){
      if(state.phaseTime+1e-9>=state.phaseDuration){
        state.phase='strike';state.phaseTime=0;state.phaseDuration=state.kind==='slam'?.28:.42;
      }
    }else if(state.phase==='strike'){
      if(state.phaseTime+1e-9>=state.impactTime){
        if(!this._impactFired){this._impactFired=true;state.impacted=true;this._event('robot-strike');}
        if(state.phaseTime<=state.phaseDuration+1e-9)this._hitVehicles(vehicles);
      }
      if(state.phaseTime+1e-9>=state.phaseDuration){state.phase='recover';state.phaseTime=0;state.phaseDuration=.8;}
    }else if(state.phase==='recover'&&state.phaseTime+1e-9>=state.phaseDuration){
      state.phase='idle';state.phaseTime=0;state.phaseDuration=0;state.cooldown=6+this._random()*3;
    }
    return state;
  }

  _warn(target){
    const state=this.state,near=this.track.closest(target.x,target.z),tangent=this.track.getTangent(near.t);
    state.kind=this._random()<.5?'slam':'pulse';state.attackId++;state.targetId=target.id;
    state.radius=Math.min(2,this.width*.23);
    state.impactFraction=state.kind==='slam'?.35:.55;
    state.impactTime=(state.kind==='slam'?.28:.42)*state.impactFraction;state.impacted=false;
    // Commit to one side: the opposite edge remains wide enough for the whole
    // kart envelope. The warning circle never seals the entire carriageway.
    const side=Math.abs(near.signedDistance)>.35?Math.sign(near.signedDistance):(this._random()<.5?-1:1);
    const lane=side*Math.max(0,Math.min(2.2,this.width/2-state.radius-.15));
    const velocityX=Number.isFinite(target._vx)?target._vx:Math.sin(target.heading)*target.speed;
    const velocityZ=Number.isFinite(target._vz)?target._vz:Math.cos(target.heading)*target.speed;
    let lead=clamp((velocityX*tangent.x+velocityZ*tangent.z)*WARNING_SECONDS,-14,48);
    let aim;
    for(let attempt=0;attempt<26;attempt++){
      const t=wrap(near.t+lead/this.track.length),p=this.track.getPoint(t),d=this.track.getTangent(t);
      const length=Math.hypot(d.x,d.z)||1;
      aim={x:p.x+d.z/length*lane,y:p.y??this.track.y??0,z:p.z-d.x/length*lane};
      if(Math.hypot(aim.x-this.position.x,aim.z-this.position.z)<=state.reach||Math.abs(lead)<.001)break;
      lead=Math.sign(lead)*Math.max(0,Math.abs(lead)-2);
    }
    // Deliberately never update this object again during warning/strike.
    state.aim=Object.freeze(aim);state.phase='warning';state.phaseTime=0;
    state.phaseDuration=WARNING_SECONDS;state.cooldown=0;this._hitIds.clear();this._impactFired=false;
    this._event('robot-warning');
  }

  _hitVehicles(vehicles){
    const state=this.state;
    for(const v of vehicles){
      if(v.finished||v.dnf||v.crash||v.respawnProtection>0||this._hitIds.has(v.id)||!Number.isFinite(v.x)||!Number.isFinite(v.z))continue;
      if(Math.hypot(v.x-state.aim.x,v.z-state.aim.z)>state.radius+this.kartRadius)continue;
      this._hitIds.add(v.id);this.onHit(v,state);
    }
  }

  _event(type){const s=this.state;this.onEvent(type,{attackId:s.attackId,kind:s.kind,targetId:s.targetId,aim:{...s.aim},radius:s.radius,phaseDuration:s.phaseDuration,impactFraction:s.impactFraction,impactTime:s.impactTime});}
  _random(){this._rng=(Math.imul(this._rng,1664525)+1013904223)>>>0;return this._rng/4294967296;}
}
