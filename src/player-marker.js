import * as THREE from 'three';

/** One local HUD marker, anchored to the animated driver's actual head. */
export function createPlayerMarker(hud){
  const element=document.createElement('div');element.id='player-marker';element.hidden=true;
  element.setAttribute('aria-label','Player：你操控的赛车');
  element.innerHTML=`<svg viewBox="0 0 128 80" aria-hidden="true">
    <path d="M6 9H122L64 76Z" fill="#152d3d" opacity=".55"/>
    <path d="M6 4H122L64 71Z" fill="#ffd43e" stroke="#243542" stroke-width="5" stroke-linejoin="round"/>
    <path d="M17 11H111" fill="none" stroke="#fff3a6" stroke-width="3"/>
    <text x="64" y="31" text-anchor="middle" fill="#243542" font-family="Courier New,monospace" font-size="20" font-weight="900">Player</text>
  </svg>`;
  hud.prepend(element);
  const anchor=new THREE.Vector3(),projected=new THREE.Vector3();
  return {
    element,
    update(state,player,kart,camera,width,height){
      element.hidden=true;
      if(!kart?.visible||!['countdown','racing','paused'].includes(state.phase))return;
      const head=kart.userData.driver?.children.find(o=>o.isMesh);
      if(!head)return;
      if(!head.geometry.boundingBox)head.geometry.computeBoundingBox();
      head.geometry.boundingBox.getCenter(anchor);anchor.y=head.geometry.boundingBox.max.y+.18;
      // Includes suspension, steering lean and crash flight, across all ten models.
      head.localToWorld(anchor);camera.updateMatrixWorld();projected.copy(anchor).project(camera);
      if(projected.z<-1||projected.z>1||Math.abs(projected.x)>.98||Math.abs(projected.y)>.98)return;
      const x=(projected.x+1)*width/2,y=(1-projected.y)*height/2-5;
      element.dataset.vehicleId=String(player.id);
      element.style.transform=`translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) translate(-50%,-100%)`;
      element.hidden=false;
    }
  };
}
