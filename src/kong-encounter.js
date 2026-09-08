/** One shared simulation drives Kong in solo games and authoritative rooms. */
export const KONG = Object.freeze({height:8.6,start:.17,wake:3,cruise:23,maxSpeed:43,acceleration:20,warning:.58,reach:6.1,grab:1.15,recovery:1.25,repeatProtection:9});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%1)+1)%1;
const turn=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;

export class KongEncounter {
  constructor({track,onGrab=()=>false,onThrow=()=>{},onEvent=()=>{}}){
    this.track=track;this.onGrab=onGrab;this.onThrow=onThrow;this.onEvent=onEvent;this.recent=new Map();
    const p=track.getPoint(KONG.start),t=track.getTangent(KONG.start);
    this.state={phase:'idle',at:0,time:0,x:p.x,z:p.z,heading:Math.atan2(t.x,t.z),progress:KONG.start,lane:0,speed:0,stride:0,targetId:null,attackId:0,throws:0,aim:{x:p.x,z:p.z}};
  }
  eligible(v){return !v.crash&&!v.grannyBlock&&!v.finished&&!v.dnf&&v.respawnProtection<=0&&(this.recent.get(v.id)||-Infinity)+KONG.repeatProtection<this.state.time;}
  choose(vehicles){
    const s=this.state;
    return vehicles.filter(v=>this.eligible(v)).sort((a,b)=>this.arc(a)-this.arc(b)||a.id-b.id)[0]||null;
  }
  arc(v){return Math.abs(((v.progress-this.state.progress+1.5)%1)-.5)*this.track.length;}
  phase(name){this.state.phase=name;this.state.at=this.state.time;}
  update(dt,vehicles,phase,time){
    if(phase!=='racing')return;
    const s=this.state;s.time=time;
    if(time<KONG.wake)return;
    if(s.phase==='idle')this.phase('chase');
    let target=vehicles.find(v=>v.id===s.targetId);
    if(s.phase==='grab'){
      if(time-s.at>=KONG.grab){this.onThrow(target,s);s.throws++;this.phase('recover');}
      return;
    }
    if(s.phase==='recover'){s.speed=0;if(time-s.at>=KONG.recovery){s.targetId=null;this.phase('chase');}return;}
    if(!target||!this.eligible(target)){target=this.choose(vehicles);s.targetId=target?.id??null;if(s.phase==='windup')this.phase('chase');}
    const delta=target?((target.progress-s.progress+1.5)%1)-.5:.2;
    const direction=delta<0?-1:1;
    const desired=target?clamp(Math.abs(target.speed)+11,27,KONG.maxSpeed):KONG.cruise;
    s.speed+=clamp(direction*desired-s.speed,-KONG.acceleration*dt,KONG.acceleration*dt);
    // Follow the real road rather than cutting through the scanned buildings.
    s.progress=wrap(s.progress+s.speed*dt/this.track.length);
    const p=this.track.getPoint(s.progress),t=this.track.getTangent(s.progress);
    const wantedLane=target?clamp(this.track.closest(target.x,target.z).signedDistance,-1.5,1.5):Math.sin(time*.7)*1.25;
    if(s.phase!=='windup')s.lane+=(wantedLane-s.lane)*(1-Math.exp(-dt*3));
    s.x=p.x+t.z*s.lane;s.z=p.z-t.x*s.lane;
    s.heading=turn(s.heading,Math.atan2(t.x*direction,t.z*direction),1-Math.exp(-dt*5));s.stride+=Math.abs(s.speed)*dt;
    if(!target)return;
    const distance=Math.hypot(target.x-s.x,target.z-s.z);
    if(s.phase==='chase'&&distance<10&&this.arc(target)<11){
      s.aim={x:target.x,z:target.z};s.attackId++;s.aimLane=this.track.closest(target.x,target.z).signedDistance;this.phase('windup');
      this.onEvent('kong-warning',{vehicleId:target.id,attackId:s.attackId,x:s.x,z:s.z});
    }else if(s.phase==='windup'&&time-s.at>=KONG.warning){
      const lane=this.track.closest(target.x,target.z).signedDistance;
      if(distance<=KONG.reach&&Math.abs(lane-s.aimLane)<1.55&&this.eligible(target)&&this.onGrab(target,s)){
        this.recent.set(target.id,time);s.speed=0;s.recoveryKind='throw';this.phase('grab');
      }else{this.recent.set(target.id,time-KONG.repeatProtection+1.8);s.recoveryKind='miss';this.phase('recover');}
    }
  }
}
