/** Shared lifetime and footprint for simulation, room snapshots and rendering. */
export const CRATERS=Object.freeze({cell:.22,max:20,lifetime:26,fade:4,kartRadius:.65});
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export function craterScale(crater,time){
  if(time<crater.at||time+1e-9>=crater.expiresAt)return 0;
  return clamp((crater.expiresAt-time)/CRATERS.fade);
}
export function craterContact(crater,car,time){
  const scale=craterScale(crater,time);if(!scale)return null;
  const radius=(crater.radius+CRATERS.kartRadius)*scale;
  const ax=(car._stepX??car.x)-crater.x,az=(car._stepZ??car.z)-crater.z;
  const dx=car.x-crater.x-ax,dz=car.z-crater.z-az,length=dx*dx+dz*dz;
  const t=length>1e-10?clamp(-(ax*dx+az*dz)/length):0;
  return Math.hypot(ax+dx*t,az+dz*t)<radius?t:null;
}
export class ImpactCraters{
  constructor(){this.records=[];this.contacts=new Map();}
  add(event,state){
    let id,at;
    if(event.type==='robot-missile-impact'){id=event.attackId;at=state.elapsed+event.impactAt-(state.robot?.barrage?.time??state.elapsed);}
    else if(event.type==='robot-strike'){id=`close-${event.attackId}`;at=state.elapsed-Math.max(0,(state.robot?.phaseTime??0)-(event.impactTime??0));}
    else return;
    const {aim,kind,radius}=event;if(!aim||![aim.x,aim.z,radius,at].every(Number.isFinite)||radius<=0||this.records.some(c=>c.id===id))return;
    this.records.push({id,kind,x:aim.x,y:aim.y,z:aim.z,radius:radius*(kind==='slam'?1:1.08),at,expiresAt:at+CRATERS.lifetime});
    if(this.records.length>CRATERS.max)this.records.shift();
  }
  markContact(vehicleId,id){let contacts=this.contacts.get(vehicleId);if(!contacts)this.contacts.set(vehicleId,contacts=new Set());contacts.add(id);}
  update(time,vehicles,onHit){
    for(let i=this.records.length-1;i>=0;i--)if(time+1e-9>=this.records[i].expiresAt)this.records.splice(i,1);
    if(!this.records.length){this.contacts.clear();return;}
    for(const v of vehicles){
      const previous=this.contacts.get(v.id),inside=new Set(),hits=[];
      for(const crater of this.records){
        const radius=(crater.radius+CRATERS.kartRadius)*craterScale(crater,time);if(!radius)continue;
        if(Math.hypot(v.x-crater.x,v.z-crater.z)<radius)inside.add(crater.id);
        const contact=craterContact(crater,v,time);if(contact!==null&&!previous?.has(crater.id))hits.push({crater,contact});
      }
      this.contacts.set(v.id,inside);
      // Protected or already destroyed cars still record their contact, so a
      // restored car or an absorbed hit cannot explode again while leaving.
      if(v.crash||v.grannyBlock||v.respawnProtection>0||v._justRespawned||v.finished||v.dnf)continue;
      hits.sort((a,b)=>a.contact-b.contact);
      for(const hit of hits){onHit(v,hit.crater,hit.contact);if(v.crash)break;}
    }
  }
}
