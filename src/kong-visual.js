import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from './asset-url.js';
import {KONG} from './kong-encounter.js';

/** One skinned Rodin mesh, four baked poses and a fixed pool of voxel dust. */
export function createKongVisual(track){
  const group=new THREE.Group();group.name='赛道狂奔 · 像素金刚';group.visible=false;
  const body=new THREE.Group();group.add(body);
  const warning=new THREE.Mesh(new THREE.RingGeometry(1.5,1.75,24),new THREE.MeshBasicMaterial({color:0xff9849,transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
  warning.rotation.x=-Math.PI/2;warning.visible=false;group.add(warning);
  const dust=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x938774,roughness:1,transparent:true,opacity:.4,depthWrite:false}),48);
  dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);dust.frustumCulled=false;dust.count=0;group.add(dust);
  const dummy=new THREE.Object3D();let loading,mixer,actions={},model;
  const stats={loaded:false,phase:'idle',throws:0,meshCount:0,animationSource:'Blender contact rig'};
  function load(){
    return loading??=new GLTFLoader().loadAsync(assetUrl('/assets/kong/kong.glb')).then(gltf=>{
      model=gltf.scene;body.add(model);model.name='Rodin 银背金刚';
      model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;o.material.envMapIntensity=1.25;stats.meshCount++;}});
      mixer=new THREE.AnimationMixer(model);
      for(const clip of gltf.animations){const name=clip.name.split('|').at(-1);actions[name]=mixer.clipAction(clip);actions[name].play();actions[name].paused=true;actions[name].setEffectiveWeight(0);}
      for(const name of ['Idle','Run','Grab','Throw'])if(!actions[name])throw new Error('金刚动作缺失：'+name);
      stats.loaded=true;return stats;
    }).catch(error=>{loading=null;throw error;});
  }
  function update(s){
    group.visible=!!s&&!!mixer;if(!s||!mixer)return;
    Object.assign(stats,{phase:s.phase,throws:s.throws,x:s.x,z:s.z});
    body.position.set(s.x,track.y+.015,s.z);body.rotation.y=s.heading;
    const age=Math.max(0,s.time-s.at),weights={Idle:0,Run:0,Grab:0,Throw:0};
    let grab=0,throwTime=0;
    if(s.phase==='grab'){weights.Grab=1;grab=Math.min(1,age/KONG.grab);}
    else if(s.phase==='windup'){const f=THREE.MathUtils.smoothstep(age,0,KONG.warning*.85);weights.Run=1-f;weights.Grab=f;}
    else if(s.phase==='recover'){const f=THREE.MathUtils.smoothstep(age,.5,KONG.recovery);weights[s.recoveryKind==='miss'?'Grab':'Throw']=1-f;weights.Idle=f;throwTime=Math.min(age,.6333);}
    else if(s.phase==='chase'){weights.Run=1;}
    else weights.Idle=1;
    for(const [name,a] of Object.entries(actions)){
      a.setEffectiveWeight(weights[name]||0);
      const duration=a.getClip().duration;
      const first=1/30,span=duration-first;
      a.time=first+(name==='Grab'?grab*span:name==='Throw'?Math.min(throwTime,span-.0001):name==='Run'?(s.stride/14*span)%span:s.time%span);
    }
    mixer.update(0);body.updateMatrixWorld(true);
    warning.visible=s.phase==='windup';
    if(warning.visible){warning.position.set(s.aim.x,track.y+.095,s.aim.z);warning.scale.setScalar(1+.15*Math.sin(age*25));}
    let count=0;
    if(s.phase==='chase'||s.phase==='windup'){
      const sn=Math.sin(s.heading),cs=Math.cos(s.heading);
      for(let i=0;i<32;i++){
        const life=(s.stride/4+i/32)%1,side=i%2?1:-1,r=life*1.8;
        const x=side*(1+r)+(Math.sin(i*12.8))*.35,z=-life*3;
        dummy.position.set(s.x+cs*x+sn*z,track.y+.06+life*.8,s.z-sn*x+cs*z);
        dummy.scale.setScalar((1-life)*(.12+i%4*.045));dummy.rotation.set(i,life*3,i*2);dummy.updateMatrix();dust.setMatrixAt(count++,dummy.matrix);
      }
    }
    dust.count=count;dust.instanceMatrix.needsUpdate=true;
  }
  return {group,load,update,stats};
}
