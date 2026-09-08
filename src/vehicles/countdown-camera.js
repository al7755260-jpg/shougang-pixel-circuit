import * as THREE from 'three';

const smooth = x => { x=THREE.MathUtils.clamp(x,0,1); return x*x*(3-2*x); };
const EXIT_START=2.2,EXIT_DURATION=1.4;
export const COUNTDOWN_HANDOFF_SECONDS=EXIT_START+EXIT_DURATION-3;
const shots = [
  {from:[2.4,1.05,3.4],to:[1.8,1.25,3.1],look:[0,.70,.45],label:'车头与前轮'},
  {from:[3.3,1.3,.25],to:[2.8,1.7,-.25],look:[0,.90,-.10],label:'侧面与座舱'},
  {from:[2.4,1.4,-3.2],to:[1.7,2.1,-4.0],look:[0,.75,-.55],label:'车尾与喷口'},
];
export function countdownShot(countdown,raceElapsed=0) {
  const elapsed=THREE.MathUtils.clamp(3-countdown,0,3)+Math.max(0,raceElapsed),index=Math.min(2,Math.floor(elapsed));
  const shot=shots[index],t=smooth(elapsed-index);
  return {index,label:shot.label,position:shot.from.map((v,i)=>THREE.MathUtils.lerp(v,shot.to[i],t)),target:shot.look,
    // Zero velocity and acceleration at both ends of the pull-back. The same
    // curve spans GO, so handing over to driving never truncates the final shot.
    fov:42,exit:THREE.MathUtils.smootherstep(elapsed,EXIT_START,EXIT_START+EXIT_DURATION)};
}
export function createCountdownCamera() {
  const local=new THREE.Vector3(),target=new THREE.Vector3(),base=new THREE.Vector3(),yaw=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0);
  return {
    apply(camera,vehicle,countdown,roadY,chasePosition,chaseTarget,chaseFov,raceElapsed=0) {
      const shot=countdownShot(countdown,raceElapsed);
      yaw.setFromAxisAngle(axis,vehicle.heading); base.set(vehicle.x,roadY,vehicle.z);
      local.fromArray(shot.position);
      // Portrait framing keeps the whole selected vehicle inside the viewport.
      const portrait=Math.max(1,Math.min(1.55,1/camera.aspect)); local.x*=portrait; local.z*=portrait;
      local.applyQuaternion(yaw).add(base);target.fromArray(shot.target).applyQuaternion(yaw).add(base);
      camera.position.copy(local).lerp(chasePosition,shot.exit);
      target.lerp(chaseTarget,shot.exit); camera.lookAt(target);
      camera.fov=THREE.MathUtils.lerp(shot.fov,chaseFov,shot.exit); camera.updateProjectionMatrix();
      return shot;
    }
  };
}
