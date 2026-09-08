import * as THREE from 'three';
import {GRANNY} from './granny-encounter.js';

const ENTER=.24,RETURN=.65;
const ease=(t,a,b)=>THREE.MathUtils.smootherstep(t,a,b);

/** Only the struck player's camera enters the gag. The race clock keeps the
 * shot frozen on pause and aligned with the pedestrian on network clients. */
export function createGrannyCamera(){
  const startPosition=new THREE.Vector3(),startRotation=new THREE.Quaternion();
  const shotPosition=new THREE.Vector3(),shotTarget=new THREE.Vector3();
  const shotRotation=new THREE.Quaternion(),chaseRotation=new THREE.Quaternion();
  const lookMatrix=new THREE.Matrix4(),forward=new THREE.Vector3(),right=new THREE.Vector3();
  const focus=new THREE.Vector3();
  let hit=null,startFov=68,lastTime=-Infinity;
  const stats={active:false,stage:'driving',hitId:0,crossingId:null};
  function reset(){hit=null;lastTime=-Infinity;stats.active=false;stats.stage='driving';stats.hitId=0;stats.crossingId=null;}
  return {
    stats,focus,reset,
    apply(camera,vehicle,grannyStates,phase,track,chasePosition,chaseTarget,chaseFov){
      const states=Array.isArray(grannyStates)?grannyStates:grannyStates?[grannyStates]:[];
      const granny=states.find(g=>g.phase==='sitting'&&g.targetId===vehicle.id)
        ??states.find(g=>(g.crossingId??0)===hit?.crossingId)??states[0];
      if(!granny||!['racing','paused'].includes(phase)||vehicle.crash||vehicle.finished||vehicle.dnf){reset();return false;}
      if(granny.time<lastTime-1e-6)reset();
      lastTime=granny.time;
      if(granny.phase==='sitting'&&granny.targetId===vehicle.id&&(hit?.id!==granny.hitId||hit?.crossingId!==(granny.crossingId??0))){
        hit={id:granny.hitId,crossingId:granny.crossingId??0,at:granny.at,vehicleId:vehicle.id};
        startPosition.copy(camera.position);startRotation.copy(camera.quaternion);startFov=camera.fov;
        forward.set(Math.sin(vehicle.heading),0,Math.cos(vehicle.heading));right.set(forward.z,0,-forward.x);
        shotTarget.set(granny.front?.x??granny.x,track.y+1.35,granny.front?.z??granny.z).addScaledVector(forward,-.2);
        // Frame her face and the kart's front corner. Choose the shoulder that
        // stays nearer the road centre; portrait gets more breathing room.
        const portrait=Math.max(1,Math.min(1.45,.85/camera.aspect));
        const candidate=side=>shotTarget.clone().addScaledVector(right,side*3.6*portrait).addScaledVector(forward,-3.1*portrait);
        const a=candidate(1),b=candidate(-1);
        shotPosition.copy(Math.abs(track.closest(a.x,a.z).signedDistance)<=Math.abs(track.closest(b.x,b.z).signedDistance)?a:b);
        shotPosition.y=track.y+2.6;
        lookMatrix.lookAt(shotPosition,shotTarget,camera.up);shotRotation.setFromRotationMatrix(lookMatrix);
      }
      if(!hit||hit.vehicleId!==vehicle.id){stats.active=false;stats.stage='driving';return false;}
      const age=Math.max(0,granny.time-hit.at);
      if(age>=GRANNY.blockSeconds+RETURN){stats.active=false;stats.stage='driving';return false;}
      stats.active=true;stats.hitId=hit.id;stats.crossingId=hit.crossingId;stats.age=age;
      const enter=ease(age,0,ENTER),leave=ease(age,GRANNY.blockSeconds,GRANNY.blockSeconds+RETURN);
      stats.stage=leave>0?'returning':enter<1?'entering':'closeup';
      camera.position.lerpVectors(startPosition,shotPosition,enter).lerp(chasePosition,leave);
      lookMatrix.lookAt(chasePosition,chaseTarget,camera.up);chaseRotation.setFromRotationMatrix(lookMatrix);
      camera.quaternion.slerpQuaternions(startRotation,shotRotation,enter).slerp(chaseRotation,leave);
      camera.fov=THREE.MathUtils.lerp(THREE.MathUtils.lerp(startFov,50,enter),chaseFov,leave);
      camera.updateProjectionMatrix();focus.copy(shotTarget).lerp(chaseTarget,leave);
      return true;
    }
  };
}
