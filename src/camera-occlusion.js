import * as THREE from 'three';

// Shared by the opaque voxel cutout and the Gaussian opacity modifier.
// Work in world metres, including the scan chunks' quantized local transforms.
export const OCCLUSION_GLSL = /* glsl */`
float sgOcclusionTube(vec3 p, vec3 eye, vec3 endpoint, float endRadius) {
  vec3 axis = endpoint - eye;
  float extent = length(axis);
  if (extent < 0.1) return 0.0;
  vec3 direction = axis / extent;
  vec3 relative = p - eye;
  float along = dot(relative, direction);
  float depth = smoothstep(-0.25, 0.4, along)
    * (1.0 - smoothstep(extent - 0.6, extent + 0.15, along));
  float radius = mix(3.2, endRadius, clamp(along / extent, 0.0, 1.0));
  float lateral = length(relative - direction * along);
  return (1.0 - smoothstep(radius * 0.48, radius, lateral)) * depth;
}
float sgOcclusionMask(vec3 p, vec3 eye, vec3 focus, vec3 ahead, float floorY, float enabled) {
  float driver = sgOcclusionTube(p, eye, focus, 4.8);
  float road = sgOcclusionTube(p, eye, ahead, 3.8);
  float insideCamera = 1.0 - smoothstep(1.5, 3.2, distance(p, eye));
  float aboveRoad = smoothstep(floorY + 0.06, floorY + 0.62, p.y);
  return max(max(driver, road), insideCamera) * aboveRoad * clamp(enabled, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */`
varying vec3 vSgOcclusionWorld;
uniform vec3 sgOcclusionCamera;
uniform vec3 sgOcclusionFocus;
uniform vec3 sgOcclusionAhead;
uniform float sgOcclusionFloor;
uniform float sgOcclusionEnabled;
${OCCLUSION_GLSL}
float sgBayer2(vec2 p) { return 2.0 * p.x + 3.0 * p.y - 4.0 * p.x * p.y; }
float sgDitherThreshold(vec2 pixel) {
  vec2 p = floor(mod(pixel, 4.0));
  return (4.0 * sgBayer2(mod(p, 2.0)) + sgBayer2(floor(p / 2.0)) + 0.5) / 16.0;
}
`;

/** A local see-through corridor follows the actual camera and racer each frame.
 * Shared, screen-aligned dithering clears every wall layer at the same pixels,
 * avoiding transparent triangle sorting and stacked opacity in the dense scan.
 */
export function createCameraOcclusion() {
  const uniforms = {
    camera: {value: new THREE.Vector3()},
    focus: {value: new THREE.Vector3()},
    ahead: {value: new THREE.Vector3()},
    floorY: {value: 1.4},
    enabled: {value: 0},
  };
  const attached = new WeakSet();
  let enabled = true;
  function attach(group) {
    group.traverse(object => {
      // Keep the sky and distant planets opaque. This hook is only installed
      // on environment groups, never the road, cars, pickups or guardian.
      if (!object.isMesh || object.material?.isShaderMaterial) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material || attached.has(material)) continue;
        attached.add(material);
        const previousCompile = material.onBeforeCompile;
        const previousKey = material.customProgramCacheKey();
        material.onBeforeCompile = function(shader, renderer) {
          previousCompile.call(this, shader, renderer);
          Object.assign(shader.uniforms, {
            sgOcclusionCamera: uniforms.camera,
            sgOcclusionFocus: uniforms.focus,
            sgOcclusionAhead: uniforms.ahead,
            sgOcclusionFloor: uniforms.floorY,
            sgOcclusionEnabled: uniforms.enabled,
          });
          shader.vertexShader = 'varying vec3 vSgOcclusionWorld;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
            vec4 sgOcclusionPosition = vec4(transformed, 1.0);
            #ifdef USE_BATCHING
              sgOcclusionPosition = batchingMatrix * sgOcclusionPosition;
            #endif
            #ifdef USE_INSTANCING
              sgOcclusionPosition = instanceMatrix * sgOcclusionPosition;
            #endif
            vSgOcclusionWorld = (modelMatrix * sgOcclusionPosition).xyz;
          `);
          shader.fragmentShader = FRAGMENT + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            float sgFade = sgOcclusionMask(vSgOcclusionWorld, sgOcclusionCamera,
              sgOcclusionFocus, sgOcclusionAhead, sgOcclusionFloor, sgOcclusionEnabled);
            float sgVisibility = mix(1.0, 0.04, sgFade);
            if (sgDitherThreshold(gl_FragCoord.xy) > sgVisibility) discard;
          `);
        };
        material.customProgramCacheKey = () => `${previousKey}|camera-occlusion-v1`;
        material.needsUpdate = true;
      }
    });
  }
  function update(camera, racer, roadAhead, floorY) {
    camera.getWorldPosition(uniforms.camera.value);
    uniforms.focus.value.set(racer.x, floorY + 1.15, racer.z);
    uniforms.ahead.value.set(roadAhead.x, floorY + 0.75, roadAhead.z);
    uniforms.floorY.value = floorY;
    uniforms.enabled.value = enabled ? 1 : 0;
  }
  return {uniforms, attach, update, setEnabled(value) { enabled = Boolean(value); uniforms.enabled.value = enabled ? 1 : 0; }};
}
