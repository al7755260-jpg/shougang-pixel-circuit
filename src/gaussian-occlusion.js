import { OCCLUSION_GLSL } from './camera-occlusion.js';

const installed = new WeakMap();

/** Apply the shared camera corridor to world-space Gaussian opacity on the GPU. */
export function createGaussianOcclusion(sparkModule, mesh, uniforms) {
  const previous = installed.get(mesh);
  if (previous) {
    previous.uniforms = uniforms;
    previous.controller.update();
    return previous.controller;
  }

  const { dyno } = sparkModule;
  const eye = dyno.dynoVec3(uniforms.camera.value.clone());
  const focus = dyno.dynoVec3(uniforms.focus.value.clone());
  const ahead = dyno.dynoVec3(uniforms.ahead.value.clone());
  const floorY = dyno.dynoFloat(uniforms.floorY.value);
  const enabled = dyno.dynoFloat(uniforms.enabled.value);
  const modifier = dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat,
        eye: 'vec3', focus: 'vec3', ahead: 'vec3',
        floorY: 'float', enabled: 'float',
      },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, eye, focus, ahead, floorY, enabled },
      globals: () => [OCCLUSION_GLSL],
      statements: ({ inputs: i, outputs: o }) => [
        `${o.gsplat} = ${i.gsplat};`,
        `if (isGsplatActive(${i.gsplat}.flags)) {`,
        `${o.gsplat}.rgba.a *= 1.0 - sgOcclusionMask(`,
        `${i.gsplat}.center, ${i.eye}, ${i.focus}, ${i.ahead}, ${i.floorY}, ${i.enabled});`,
        '}',
      ],
    }).outputs,
  );

  // worldModifiers run after the scan's scale, rotation and translation.
  mesh.worldModifiers = [...(mesh.worldModifiers ?? []), modifier];
  mesh.updateGenerator();

  const state = { uniforms, controller: null };
  const vectors = [['camera', eye], ['focus', focus], ['ahead', ahead]];
  const scalars = [['floorY', floorY], ['enabled', enabled]];
  const controller = {
    update() {
      let changed = false;
      for (const [key, target] of vectors) {
        const value = state.uniforms[key].value;
        if (!target.value.equals(value)) {
          target.value.copy(value);
          changed = true;
        }
      }
      for (const [key, target] of scalars) {
        const value = state.uniforms[key].value;
        if (target.value !== value) {
          target.value = value;
          changed = true;
        }
      }
      // A uniform write alone does not invalidate Spark's cached accumulator.
      if (changed) mesh.needsUpdate = true;
    },
  };
  state.controller = controller;
  installed.set(mesh, state);
  return controller;
}
