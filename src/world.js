import * as THREE from 'three';
import {assetUrl} from './asset-url.js';
import {createDaylightScenery} from './daylight-scenery.js';
import {createRoad} from './track.js';
import {createTrackProps} from './voxel-assets.js';
import {loadVoxelEnvironment} from './voxel-environment.js';
import {createParkRobot} from './robot-visual.js';
import {createKongVisual} from './kong-visual.js';
import {createGrannyVisual} from './granny-visual.js';
import {GRANNY_CROSSINGS} from './granny-encounter.js';
import {createSkyTraffic} from './sky-traffic.js';
import {createCameraOcclusion} from './camera-occlusion.js';
import {createGaussianOcclusion} from './gaussian-occlusion.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRoadReflection} from './road-reflection.js';

export function createWorld(renderer,track) {
  const occlusion=createCameraOcclusion(),gaussianOcclusion=new WeakMap();
  const scene=new THREE.Scene();scene.background=new THREE.Color('#b9c2cb');scene.fog=new THREE.Fog('#bfc7ca',230,1050);
  scene.matrixAutoUpdate=false;
  const hemi=new THREE.HemisphereLight(0xdce5ef,0x766c5c,.18);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffe4bc,2.4),sunDirection=new THREE.Vector3(-.7,.48,-.6).normalize();
  sun.name='PV warm sky sun';sun.castShadow=true;scene.add(sun,sun.target);
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-72,right:72,top:72,bottom:-72,near:1,far:450});
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias=-.00012;sun.shadow.normalBias=.045;sun.shadow.radius=2.2;
  sun.shadow.autoUpdate=false;
  let shadowTime=-Infinity,shadowInterval=1/30,shadowSize=2048;
  const fill=new THREE.DirectionalLight(0xc3d4e3,.55);fill.position.set(75,60,80);scene.add(fill);
  // The default solid pixel park does not load the Gaussian renderer or workers.
  // Once requested, keep a single renderer for quick, safe visual comparisons.
  let spark=null,sparkModule=null;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),new THREE.MeshStandardMaterial({color:0x565b55,roughness:.94,metalness:0}));ground.rotation.x=-Math.PI/2;ground.position.y=-1.4;ground.name='城市远地';ground.receiveShadow=true;scene.add(ground);
  const road=createRoad(track);scene.add(road);
  road.traverse(object=>{object.updateMatrix();object.matrixAutoUpdate=false;});
  const props=createTrackProps(THREE,track);for(const item of props.items)item.visible=false;scene.add(props.group);
  const city=createDaylightScenery(track);scene.add(city.group);
  city.group.traverse(o=>{if(o.isMesh&&o.material?.isMeshStandardMaterial){o.castShadow=true;o.receiveShadow=true;}});
  occlusion.attach(props.group);occlusion.attach(city.group);
  const skyTraffic=createSkyTraffic();scene.add(skyTraffic.group);
  const robot=createParkRobot();scene.add(robot.group);
  const kong=createKongVisual(track);scene.add(kong.group);
  const grannies=GRANNY_CROSSINGS.map(spec=>createGrannyVisual(track,spec));
  for(const granny of grannies)scene.add(granny.group);
  const granny=grannies[0];
  road.userData.impactMaterials=grannies.map(view=>view.markings.material);
  robot.group.traverse(o=>{if(o.isMesh&&!o.material?.transparent){o.castShadow=true;o.receiveShadow=true;}});
  const reflection=createRoadReflection({renderer,scene,road,track,
    beforeRender(){const value=occlusion.uniforms.enabled.value;occlusion.uniforms.enabled.value=0;return value;},
    afterRender(value){if(value!==undefined)occlusion.uniforms.enabled.value=value;}});
  const cloudMotion=[];let pvAssets=null,activeVoxel=null,film=true;
  async function loadPVAssets(){
    if(pvAssets)return pvAssets;
    pvAssets=Promise.all([
      new HDRLoader().setDataType(THREE.FloatType).loadAsync(assetUrl('/assets/pv/blender-pv-sky.hdr')),
      new GLTFLoader().loadAsync(assetUrl('/assets/pv/blender-voxel-clouds.glb')),
      fetch(assetUrl('/assets/pv/pv-scene.json')).then(r=>{if(!r.ok)throw new Error('PV lighting manifest unavailable');return r.json();})
    ]).then(([hdr,gltf,manifest])=>{
      hdr.mapping=THREE.EquirectangularReflectionMapping;
      // Keep the original sky for the background, but separate its tiny solar
      // disc from the diffuse/specular environment. A real shadow-casting sun
      // supplies that direct light without PMREM spreading it over the road.
      const pixels=hdr.image.data.slice();
      for(let i=0;i<pixels.length;i+=4){const peak=Math.max(pixels[i],pixels[i+1],pixels[i+2]);if(peak>16){const factor=(16+16*(1-Math.exp(-(peak-16)/16)))/peak;pixels[i]*=factor;pixels[i+1]*=factor;pixels[i+2]*=factor;}}
      const lightingHDR=new THREE.DataTexture(pixels,hdr.image.width,hdr.image.height,THREE.RGBAFormat,THREE.FloatType);
      lightingHDR.mapping=THREE.EquirectangularReflectionMapping;lightingHDR.colorSpace=THREE.LinearSRGBColorSpace;lightingHDR.flipY=hdr.flipY;lightingHDR.needsUpdate=true;
      const pmrem=new THREE.PMREMGenerator(renderer);const env=pmrem.fromEquirectangular(lightingHDR);pmrem.dispose();lightingHDR.dispose();
      scene.environment=env.texture;scene.environmentIntensity=.85;scene.background=hdr;
      scene.backgroundIntensity=1;scene.backgroundBlurriness=0;
      // The HDR already contains Blender's World strength. Never multiply it twice.
      city.group.traverse(o=>{if(o.isMesh&&o.material?.isShaderMaterial)o.visible=false;});
      gltf.scene.name='Blender 原场景 · 14 朵体素云';scene.add(gltf.scene);
      for(const spec of manifest.clouds){const object=gltf.scene.getObjectByName(spec.name);if(object){object.receiveShadow=true;cloudMotion.push({object,origin:object.position.clone(),velocity:new THREE.Vector3(...spec.driftPerSecond)});}}
      if(manifest.environmentSun?.directionThreeAtZeroRotation)sunDirection.fromArray(manifest.environmentSun.directionThreeAtZeroRotation).normalize();
      scene.userData.blenderSource=manifest.source;scene.userData.cloudCount=cloudMotion.length;
      return manifest;
    }).catch(error=>{pvAssets=null;throw error;});
    return pvAssets;
  }
  let environment=null,loadToken=0,gaussianAsset=null,gaussianQuality=null,voxelAbort=null,gaussianQueue=Promise.resolve();
  const voxelAssets=new Map();
  function activate(next,style){
    if(environment&&environment!==next)scene.remove(environment);
    environment=next;scene.add(next);
    if(spark){
      spark.autoUpdate=style==='gaussian';spark.enableDriveLod=style==='gaussian';
      if(style==='gaussian')scene.add(spark);else scene.remove(spark);
    }
  }
  async function loadEnvironment(quality='pixel',onProgress=()=>{},style='voxel',voxelQuality='original') {
    const token=++loadToken;
    voxelAbort?.abort();voxelAbort=null;
    await Promise.all([loadPVAssets(),kong.load(),...grannies.map(view=>view.load())]);
    if(token!==loadToken)return false;
    if(style==='voxel'){
      let voxelAsset=voxelAssets.get(voxelQuality);
      if(!voxelAsset){
        const abort=new AbortController();voxelAbort=abort;
        const candidate=await loadVoxelEnvironment({signal:abort.signal,quality:voxelQuality,onProgress:p=>{if(token===loadToken)onProgress(p);}});
        if(token!==loadToken){candidate.dispose();return false;}
        occlusion.attach(candidate.group);
        voxelAsset=candidate;voxelAssets.set(voxelQuality,candidate);voxelAbort=null;
      }
      activeVoxel=voxelAsset;activate(voxelAsset.group,'voxel');
      return {environmentStyle:'voxel',numVoxels:voxelAsset.meta.totalVoxels,quality,voxelQuality,voxelSize:voxelAsset.meta.voxel?.size??voxelAsset.meta.voxelSize};
    }
    activeVoxel=null;
    sparkModule??=import('@sparkjsdev/spark').catch(error=>{sparkModule=null;throw error;});
    const sparkExports=await sparkModule;
    const {SparkRenderer,SplatMesh}=sparkExports;
    if(token!==loadToken)return false;
    const run=async()=>{
    if(token!==loadToken)return false;
    if(!spark)spark=new SparkRenderer({renderer,maxStdDev:2.4,minAlpha:.035,maxPixelRadius:160,sortRadial:true,lodSplatCount:350000,autoUpdate:false});
    if(gaussianAsset&&gaussianQuality===quality){activate(gaussianAsset,'gaussian');onProgress(1);return {numSplats:gaussianAsset.numSplats,environmentStyle:'gaussian',quality};}
    const url=assetUrl(quality==='original'?'/assets/shougang-hq.ply':'/assets/shougang.splat');
    const next=new SplatMesh({url,lod:true,nonLod:true,onProgress:e=>{if(token===loadToken)onProgress(e.total?e.loaded/e.total:0);}});
    next.rotation.x=Math.PI;next.scale.setScalar(120);next.position.y=90.48;
    next.recolor.setRGB(1,1,1);
    try{await next.initialized;}catch(error){next.dispose();throw error;}
    if(token!==loadToken){next.dispose();return false;}
    gaussianOcclusion.set(next,createGaussianOcclusion(sparkExports,next,occlusion.uniforms));
    const previous=gaussianAsset;gaussianAsset=next;gaussianQuality=quality;
    next.name='首钢园 · 原始实景 Gaussian';activate(next,'gaussian');
    previous?.dispose();
    return {numSplats:next.numSplats,environmentStyle:'gaussian',quality};
    };
    const result=gaussianQueue.then(run,run);gaussianQueue=result.catch(()=>{});return result;
  }
  function update(time,robotState,kongState,grannyStates){props.animate(time);city.animate(time);skyTraffic.animate(time);robot.update(robotState,time);kong.update(kongState);
    const states=Array.isArray(grannyStates)?grannyStates:grannyStates?[grannyStates]:[];
    for(const view of grannies)view.update(states.find(s=>(s.crossingId??0)===view.stats.crossingId));
    for(const cloud of cloudMotion)cloud.object.position.copy(cloud.origin).addScaledVector(cloud.velocity,Math.sin(time/60)*60);
  }
  function updateOcclusion(camera,racer){
    const progress=racer.progress??track.closest(racer.x,racer.z).t;
    const ahead=track.getPoint(progress+10/track.length);
    occlusion.update(camera,racer,ahead,track.y);
    gaussianOcclusion.get(environment)?.update();
  }
  function prepareRender(camera,racer,time){
    // Snap the shadow origin to texels to keep voxel edges steady during driving.
    if(time-shadowTime>=shadowInterval||sun.shadow.needsUpdate){
      const texel=144/shadowSize,x=Math.round(racer.x/texel)*texel,z=Math.round(racer.z/texel)*texel;
      sun.target.position.set(x,track.y,z);sun.position.copy(sun.target.position).addScaledVector(sunDirection,200);
      activeVoxel?.updateShadows(racer,90);sun.shadow.needsUpdate=true;shadowTime=time;
    }
    // Gaussian sorting is camera-dependent; reserve the secondary view for
    // the default solid park so it cannot take over Spark's main camera.
    reflection.setEnabled(film&&!!activeVoxel);
    if(film&&activeVoxel)reflection.update(camera,time);
  }
  return {scene,road,sun,reflection,kong,granny,grannies,loadEnvironment,update,updateOcclusion,prepareRender,
    resize(){const size=renderer.getDrawingBufferSize(new THREE.Vector2());reflection.resize(size.x,size.y);},
    setRenderQuality(value,mobile=false){film=!!value;reflection.setEnabled(film);renderer.shadowMap.enabled=true;shadowInterval=mobile?1/24:1/30;const size=mobile&&!film?1024:2048;if(size!==shadowSize){shadowSize=size;sun.shadow.mapSize.set(size,size);sun.shadow.map?.dispose();sun.shadow.map=null;}shadowTime=-Infinity;sun.shadow.needsUpdate=true;},
    setOcclusionEnabled:occlusion.setEnabled,get spark(){return spark;},get environment(){return environment;}};
}
