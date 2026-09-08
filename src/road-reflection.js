import * as THREE from 'three';

/** Optional wet-road reflections; disabled for the default dry asphalt.
 * The reflected camera / oblique clipping construction follows Three's Reflector.
 * Only near geometry is drawn; the dense park never receives a second full draw.
 * beforeRender may return a token which afterRender receives for state restoration.
 */
export function createRoadReflection({renderer,scene,road,track,beforeRender,afterRender,
  maxDistance=95,maxFps=20,resolutionScale=.38,strength=0}={}) {
  const surface=road.userData.surface;
  if(!surface?.material?.isMeshStandardMaterial)throw new Error('A PBR road surface is required');
  const material=surface.material;
  const target=new THREE.WebGLRenderTarget(384,256,{
    type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
    depthBuffer:true,stencilBuffer:false,samples:0,
  });
  target.texture.name='首钢园 · 近场湿路反射';
  const uniforms={
    sgRoadReflection:{value:target.texture},sgRoadReflectionMatrix:{value:new THREE.Matrix4()},
    sgRoadReflectionTexel:{value:new THREE.Vector2(1/384,1/256)},
    sgRoadReflectionStrength:{value:0},sgRoadReflectionOrigin:{value:new THREE.Vector3()},
    sgRoadReflectionRange:{value:maxDistance*.82},
  };
  const previousCompile=material.onBeforeCompile,previousKey=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,webglRenderer) {
    previousCompile.call(this,shader,webglRenderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=`uniform mat4 sgRoadReflectionMatrix;
      varying vec4 vSgRoadReflectionCoord;
      varying vec3 vSgRoadWorld;\n${shader.vertexShader}`;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
      vec4 sgRoadWorldPosition=modelMatrix*vec4(transformed,1.0);
      vSgRoadWorld=sgRoadWorldPosition.xyz;
      vSgRoadReflectionCoord=sgRoadReflectionMatrix*sgRoadWorldPosition;
    `);
    shader.fragmentShader=`uniform sampler2D sgRoadReflection;
      uniform vec2 sgRoadReflectionTexel;
      uniform float sgRoadReflectionStrength;
      uniform float sgRoadReflectionRange;
      uniform vec3 sgRoadReflectionOrigin;
      varying vec4 vSgRoadReflectionCoord;
      varying vec3 vSgRoadWorld;\n${shader.fragmentShader}`;
    // Keep direct light, contact shadow, diffuse and the physically shaded
    // aggregate intact. Blend into indirect specular instead of emitting light.
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      if(sgRoadReflectionStrength>0.0 && vSgRoadReflectionCoord.w>0.0) {
        vec2 sgRoadUV=vSgRoadReflectionCoord.xy/vSgRoadReflectionCoord.w;
        float sgRoadBorder=min(min(sgRoadUV.x,1.0-sgRoadUV.x),min(sgRoadUV.y,1.0-sgRoadUV.y));
        float sgRoadRange=1.0-smoothstep(sgRoadReflectionRange*.62,sgRoadReflectionRange,
          distance(vSgRoadWorld.xz,sgRoadReflectionOrigin.xz));
        float sgRoadValid=smoothstep(0.0,.025,sgRoadBorder)*sgRoadRange;
        vec2 sgRoadBlur=sgRoadReflectionTexel*(1.2+roughnessFactor*4.0);
        vec3 sgRoadRadiance=(texture2D(sgRoadReflection,sgRoadUV+sgRoadBlur*vec2(-.7,-.7)).rgb
          +texture2D(sgRoadReflection,sgRoadUV+sgRoadBlur*vec2(.7,-.7)).rgb
          +texture2D(sgRoadReflection,sgRoadUV+sgRoadBlur*vec2(-.7,.7)).rgb
          +texture2D(sgRoadReflection,sgRoadUV+sgRoadBlur*vec2(.7,.7)).rgb)*.25;
        float sgRoadPeak=max(max(sgRoadRadiance.r,sgRoadRadiance.g),sgRoadRadiance.b);
        if(sgRoadPeak>3.0)sgRoadRadiance*=(3.0+5.0*(1.0-exp(-(sgRoadPeak-3.0)/5.0)))/sgRoadPeak;
        float sgRoadGrazing=pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),2.0);
        float sgRoadWetness=sgRoadReflectionStrength*(.3+.7*sgRoadGrazing)*sgRoadValid;
        reflectedLight.indirectSpecular=mix(reflectedLight.indirectSpecular,
          sgRoadRadiance,sgRoadWetness);
      }
    `);
  };
  material.customProgramCacheKey=()=>`${previousKey}|near-road-reflection-v1`;
  material.needsUpdate=true;

  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-track.y),clip=new THREE.Vector4();
  const q=new THREE.Vector4(),normal=new THREE.Vector3(0,1,0),eye=new THREE.Vector3();
  const rotation=new THREE.Matrix4(),look=new THREE.Vector3(),reflectedEye=new THREE.Vector3();
  const reflectedLook=new THREE.Vector3(),projectionView=new THREE.Matrix4(),frustum=new THREE.Frustum();
  const sphere=new THREE.Sphere(),viewport=new THREE.Vector4(),scissor=new THREE.Vector4();
  const reflectionCameras=new WeakMap(),hidden=[];
  const stats={enabled:strength>0,frames:0,width:384,height:256,culledMeshes:0,drawCalls:0,triangles:0,lastMs:0};
  let enabled=true,lastTime=-Infinity,rendering=false,disposed=false;

  function resize(width,height) {
    // The supplied dimensions are the actual main render buffer, not CSS pixels.
    const scale=Math.min(resolutionScale,720/Math.max(width,height));
    const w=Math.max(96,Math.round(width*scale)),h=Math.max(96,Math.round(height*scale));
    if(w===target.width&&h===target.height)return;
    target.setSize(w,h);uniforms.sgRoadReflectionTexel.value.set(1/w,1/h);
    stats.width=w;stats.height=h;lastTime=-Infinity;uniforms.sgRoadReflectionStrength.value=0;
  }

  function update(camera,time=performance.now()/1000) {
    if(disposed||!enabled||strength<=0||rendering||!road.visible)return false;
    if(time>=lastTime&&time-lastTime<1/Math.max(1,maxFps))return false;
    camera.updateMatrixWorld();camera.getWorldPosition(eye);
    if(eye.y<=track.y+.04){uniforms.sgRoadReflectionStrength.value=0;return false;}
    let reflectionCamera=reflectionCameras.get(camera);
    if(!reflectionCamera){reflectionCamera=camera.clone();reflectionCameras.set(camera,reflectionCamera);}
    reflectedEye.copy(eye);reflectedEye.y=2*track.y-eye.y;
    rotation.extractRotation(camera.matrixWorld);
    look.set(0,0,-1).applyMatrix4(rotation).add(eye);
    reflectedLook.copy(look);reflectedLook.y=2*track.y-look.y;
    reflectionCamera.position.copy(reflectedEye);
    reflectionCamera.up.set(0,1,0).applyMatrix4(rotation).reflect(normal);
    reflectionCamera.lookAt(reflectedLook);reflectionCamera.layers.mask=camera.layers.mask;
    reflectionCamera.far=camera.far;reflectionCamera.near=camera.near;
    reflectionCamera.updateMatrixWorld();reflectionCamera.projectionMatrix.copy(camera.projectionMatrix);
    uniforms.sgRoadReflectionMatrix.value.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1)
      .multiply(reflectionCamera.projectionMatrix).multiply(reflectionCamera.matrixWorldInverse);
    const clipInView=plane.clone().applyMatrix4(reflectionCamera.matrixWorldInverse);
    clip.set(clipInView.normal.x,clipInView.normal.y,clipInView.normal.z,clipInView.constant);
    const e=reflectionCamera.projectionMatrix.elements;
    q.x=(Math.sign(clip.x)+e[8])/e[0];q.y=(Math.sign(clip.y)+e[9])/e[5];
    q.z=reflectionCamera.isOrthographicCamera?-camera.far:-1;
    q.w=reflectionCamera.isOrthographicCamera?1:(1+e[10])/e[14];
    clip.multiplyScalar(2/clip.dot(q));
    e[2]=clip.x;e[6]=clip.y;e[10]=clip.z+(reflectionCamera.isOrthographicCamera?0:1)-.002;
    e[14]=clip.w-(reflectionCamera.isOrthographicCamera?1:0);
    reflectionCamera.projectionMatrixInverse.copy(reflectionCamera.projectionMatrix).invert();
    projectionView.multiplyMatrices(reflectionCamera.projectionMatrix,reflectionCamera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projectionView);
    scene.updateMatrixWorld();

    const currentTarget=renderer.getRenderTarget(),currentFace=renderer.getActiveCubeFace(),currentLevel=renderer.getActiveMipmapLevel();
    const currentXr=renderer.xr.enabled,currentAutoClear=renderer.autoClear;
    const currentShadowAuto=renderer.shadowMap.autoUpdate,currentShadowNeeds=renderer.shadowMap.needsUpdate;
    const currentScissorTest=renderer.getScissorTest();renderer.getViewport(viewport);renderer.getScissor(scissor);
    const begin=performance.now();let token;
    hidden.length=0;rendering=true;
    try {
      road.visible=false;
      scene.traverseVisible(object=>{
        if(object.userData.skipRoadReflection){hidden.push(object);object.visible=false;return;}
        if(!object.isMesh)return;
        let bound;
        if(object.isInstancedMesh){if(!object.boundingSphere)object.computeBoundingSphere();bound=object.boundingSphere;}
        else {if(!object.geometry.boundingSphere)object.geometry.computeBoundingSphere();bound=object.geometry.boundingSphere;}
        if(!bound)return;
        sphere.copy(bound).applyMatrix4(object.matrixWorld);
        if(sphere.center.distanceTo(eye)-sphere.radius>maxDistance||!frustum.intersectsSphere(sphere)){
          hidden.push(object);object.visible=false;
        }
      });
      token=beforeRender?.();
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
      renderer.autoClear=true;renderer.setRenderTarget(target);renderer.setScissorTest(false);
      renderer.state.buffers.depth.setMask(true);
      renderer.render(scene,reflectionCamera);
      stats.frames++;stats.culledMeshes=hidden.length;
      stats.drawCalls=renderer.info.render.calls;stats.triangles=renderer.info.render.triangles;
      uniforms.sgRoadReflectionOrigin.value.copy(eye);
      uniforms.sgRoadReflectionStrength.value=strength;lastTime=time;
    } finally {
      for(const object of hidden)object.visible=true;
      road.visible=true;
      renderer.xr.enabled=currentXr;renderer.shadowMap.autoUpdate=currentShadowAuto;
      renderer.shadowMap.needsUpdate=currentShadowNeeds;renderer.autoClear=currentAutoClear;
      renderer.setRenderTarget(currentTarget,currentFace,currentLevel);
      renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(currentScissorTest);
      rendering=false;stats.lastMs=performance.now()-begin;
      afterRender?.(token);
    }
    return true;
  }
  return {update,resize,stats,get target(){return target;},
    setEnabled(value){const next=Boolean(value);if(next===enabled)return;enabled=next;stats.enabled=enabled&&strength>0;if(!enabled)uniforms.sgRoadReflectionStrength.value=0;else lastTime=-Infinity;},
    setStrength(value){strength=THREE.MathUtils.clamp(value,0,.4);stats.enabled=enabled&&strength>0;if(enabled&&stats.frames)uniforms.sgRoadReflectionStrength.value=strength;},
    dispose(){if(disposed)return;disposed=true;target.dispose();material.onBeforeCompile=previousCompile;
      material.customProgramCacheKey=()=>previousKey;material.needsUpdate=true;},
  };
}
