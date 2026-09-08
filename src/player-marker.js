import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from './asset-url.js';

/** A real Rodin badge and extruded pixel lettering, attached to the local driver. */
export function createPlayerMarker(hud){
  // This transparent DOM anchor reserves space for comic bubbles and accessibility.
  // The badge itself uses the game's existing WebGL context.
  const element=document.createElement('div');element.id='player-marker';element.hidden=true;
  element.setAttribute('aria-label','Player：你操控的赛车');
  element.innerHTML='<span class="player-marker-fallback">Player</span>';hud.prepend(element);
  const scene=new THREE.Scene(),view=new THREE.OrthographicCamera(0,1,1,0,.1,1000);
  view.position.z=500;
  const badge=new THREE.Group();badge.name='Player · Rodin 立体赛车徽章';scene.add(badge);
  scene.add(new THREE.HemisphereLight(0xfff5df,0x69808c,2.2));
  const key=new THREE.DirectionalLight(0xfff5e7,2.5);key.position.set(-3,5,8);scene.add(key);
  const fill=new THREE.DirectionalLight(0xa5e0e2,.8);fill.position.set(4,0,4);scene.add(fill);
  const anchor=new THREE.Vector3(),projected=new THREE.Vector3(),size=new THREE.Vector3(),center=new THREE.Vector3();
  let model,loading,aspect=.44,viewWidth=0,viewHeight=0,visible=false;
  return {
    element,
    async warm(renderer){
      if(!loading)loading=new GLTFLoader().loadAsync(assetUrl('assets/player-marker/player-badge.glb')).then(gltf=>{
        model=gltf.scene;model.name='Imagegen → Rodin · Player badge';
        const bounds=new THREE.Box3().setFromObject(model);bounds.getSize(size);bounds.getCenter(center);
        model.position.copy(center).multiplyScalar(-1/size.x);model.scale.setScalar(1/size.x);
        aspect=size.y/size.x;
        model.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});
        badge.add(model);element.dataset.model='rodin';element.dataset.asset='player-badge.glb';
        return renderer.compileAsync(scene,view);
      }).catch(error=>{
        // A failed optional badge download must not prevent anyone from racing.
        loading=null;element.dataset.model='fallback';console.warn('Player badge could not load',error);
      });
      await loading;
    },
    update(state,player,kart,camera,width,height){
      visible=false;element.hidden=true;
      const clean=state.phase==='racing'&&hud.parentElement.dataset.cleanView==='true'&&matchMedia('(pointer:fine)').matches;
      if(clean||!kart?.visible||!['countdown','racing','paused'].includes(state.phase))return;
      const head=kart.userData.driver?.children.find(o=>o.isMesh);if(!head)return;
      if(!head.geometry.boundingBox)head.geometry.computeBoundingBox();
      head.geometry.boundingBox.getCenter(anchor);anchor.y=head.geometry.boundingBox.max.y+.18;
      // Includes driver height, steering lean, suspension and crash flight.
      head.localToWorld(anchor);camera.updateMatrixWorld();projected.copy(anchor).project(camera);
      if(projected.z<-1||projected.z>1||Math.abs(projected.x)>.98||Math.abs(projected.y)>.98)return;
      const w=width<=760?94:108,h=w*aspect;
      const x=(projected.x+1)*width/2,y=(1-projected.y)*height/2-7-Math.sin(state.elapsed*2.4)*1.5;
      element.dataset.vehicleId=String(player.id);
      element.style.width=w+'px';element.style.height=h+'px';
      element.style.transform=`translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) translate(-50%,-100%)`;
      element.hidden=false;visible=!!model;
      if(width!==viewWidth||height!==viewHeight){viewWidth=width;viewHeight=height;view.right=width;view.top=height;view.updateProjectionMatrix();}
      // A screen-space camera keeps the physical badge facing the player in every
      // race camera, without distance changes turning it into a giant obstruction.
      badge.position.set(x,height-y+h/2,0);badge.scale.setScalar(w);
      badge.rotation.set(-.045,.035,0);
    },
    render(renderer){
      if(!visible)return;
      const autoClear=renderer.autoClear;renderer.autoClear=false;
      try{renderer.clearDepth();renderer.render(scene,view);}finally{renderer.autoClear=autoClear;}
    }
  };
}
