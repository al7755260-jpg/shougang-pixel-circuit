import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {TexturePass} from 'three/addons/postprocessing/TexturePass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';

// Reuse the main pass depth: the six-million-face park is never drawn again
// just to obtain ambient occlusion or photographic depth of field.
export function createCinematicRenderer(renderer,scene,camera){
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
  target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  target.texture.name='PV linear HDR beauty';
  const composer=new EffectComposer(renderer);
  const input=new TexturePass(target.texture);composer.addPass(input);
  const optics=new ShaderPass({
    uniforms:{tDiffuse:{value:null},tDepth:{value:target.depthTexture},resolution:{value:new THREE.Vector2(1,1)},
      projectionInverse:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4()},focus:{value:22},dof:{value:0},aoStrength:{value:.5}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:/* glsl */`
      uniform sampler2D tDiffuse,tDepth;
      uniform vec2 resolution;
      uniform mat4 projectionInverse,projection;
      uniform float focus,dof,aoStrength;
      varying vec2 vUv;
      vec3 viewPosition(vec2 uv,float d){vec4 p=projectionInverse*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
      void main(){
        float depth=texture2D(tDepth,vUv).x;
        vec3 color=texture2D(tDiffuse,vUv).rgb;
        if(depth<.999995){
          vec3 p=viewPosition(vUv,depth);
          vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
          if(normal.z<0.)normal=-normal;
          float radius=.85,occ=0.,weight=0.;
          float pixelRadius=clamp(radius*projection[1][1]*resolution.y/(-p.z*2.),2.,26.);
          // Deterministic sampling avoids temporal crawling on square voxel faces.
          for(int i=0;i<12;i++){
            float a=float(i)*2.39996323,r=sqrt((float(i)+.5)/12.);
            vec2 uv=clamp(vUv+vec2(cos(a),sin(a))*pixelRadius*r/resolution,vec2(.001),vec2(.999));
            float sd=texture2D(tDepth,uv).x;
            vec3 delta=viewPosition(uv,sd)-p;
            float len=length(delta);
            float range=1.-smoothstep(radius*.25,radius*1.5,len);
            float alignment=max(0.,dot(normal,delta)/max(len,.001)-.12);
            occ+=alignment*range;weight+=1.;
          }
          color*=1.-clamp(occ/max(weight,1.)*aoStrength*3.,0.,.42);
          float blur=dof*clamp(abs(-p.z-focus)/max(-p.z,1.),0.,1.);
          if(blur>.05){
            vec3 sum=color;float weights=1.;
            for(int i=0;i<8;i++){
              float a=float(i)*.785398;
              vec2 uv=clamp(vUv+vec2(cos(a),sin(a))*blur/resolution,vec2(.001),vec2(.999));
              float z=-viewPosition(uv,texture2D(tDepth,uv).x).z;
              float w=1.-smoothstep(1.,5.,abs(z+p.z));
              sum+=texture2D(tDiffuse,uv).rgb*w;weights+=w;
            }
            color=mix(color,sum/weights,.65);
          }
        }
        gl_FragColor=vec4(color,1.);
      }`
  });composer.addPass(optics);
  const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.065,.4,2.5);composer.addPass(bloom);
  // The source sky has solar-disc linear RGB above 8,900. Limit only the bloom
  // extraction so looking towards it never washes out the playable road.
  bloom.materialHighPassFilter.fragmentShader=bloom.materialHighPassFilter.fragmentShader.replace(
    'gl_FragColor = mix( outputColor, texel, alpha );',
    'gl_FragColor = mix( outputColor, vec4(min(texel.rgb,vec3(8.0)),texel.a), alpha );');
  const output=new OutputPass();composer.addPass(output);
  const fxaa=new ShaderPass(FXAAShader);composer.addPass(fxaa);
  let enabled=true;
  return {
    target,composer,optics,bloom,
    setEnabled(value){enabled=!!value;},
    resize(width,height,pixelRatio){
      const w=Math.max(1,Math.round(width*pixelRatio)),h=Math.max(1,Math.round(height*pixelRatio));
      target.setSize(w,h);composer.setPixelRatio(pixelRatio);composer.setSize(width,height);
      optics.uniforms.resolution.value.set(w,h);fxaa.uniforms.resolution.value.set(1/w,1/h);
    },
    render(dt,{focus=22,closeup=false,phase='racing'}={}){
      if(!enabled){renderer.setRenderTarget(null);renderer.render(scene,camera);return;}
      optics.uniforms.projectionInverse.value.copy(camera.projectionMatrixInverse);
      optics.uniforms.projection.value.copy(camera.projectionMatrix);
      optics.uniforms.focus.value=focus;
      optics.uniforms.dof.value=closeup?6.0:phase==='menu'?.8:0;
      renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
      renderer.setRenderTarget(null);composer.render(dt);
    },
    dispose(){target.dispose();for(const pass of composer.passes)pass.dispose?.();composer.dispose();}
  };
}
