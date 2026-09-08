import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createKart} from '../voxel-assets.js';
import {vehicleById} from './catalog.js';

/** Cache source geometry and textures; each racer owns only its transform rig. */
export class VehicleModelLibrary {
  constructor() { this.loader = new GLTFLoader(); this.sources = new Map(); this.templates = new Map(); this.jobs = new Map(); }
  async source(url) {
    if (!this.sources.has(url)) this.sources.set(url, this.loader.loadAsync(url).then(gltf => {
      gltf.scene.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true; object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material.map) { material.map.anisotropy = 4; }
        }
      });
      return gltf.scene;
    }).catch(error => { this.sources.delete(url); throw error; }));
    return this.sources.get(url);
  }
  async load(id) {
    if (this.templates.has(id)) return this.templates.get(id);
    if (this.jobs.has(id)) return this.jobs.get(id);
    const spec = vehicleById(id);
    if (!spec?.available) throw new Error('这款赛车还在制作中。');
    const job = Promise.all([this.source(spec.body.url), this.source(spec.wheelAsset.url)])
      .then(([body,wheel]) => { const template = {spec,body,wheel}; this.templates.set(id,template); return template; })
      .finally(() => this.jobs.delete(id));
    this.jobs.set(id,job); return job;
  }
  has(id) { return this.templates.has(id); }
  create(id, {number=8}={}) {
    const template = this.templates.get(id);
    if (!template) throw new Error('车型尚未加载。');
    const {spec,body,wheel} = template;
    const kart = new THREE.Group(); kart.name = spec.name;
    const chassis = new THREE.Group(); chassis.name = '车身悬挂'; kart.add(chassis);
    const bodyMount = new THREE.Group(); chassis.add(bodyMount);
    bodyMount.add(body.clone(true));
    bodyMount.rotation.fromArray([...(spec.body.rotation||[0,0,0]),'XYZ']);
    bodyMount.scale.setScalar(spec.body.scale??1); bodyMount.position.fromArray(spec.body.offset||[0,0,0]);
    const wheels = [], frontWheels = [], wheelMounts = [];
    const radius = spec.wheelRadius ?? .30;
    const mounts = spec.mounts || [[-.72,radius,-.73],[.72,radius,-.73],[-.72,radius,.76],[.72,radius,.76]];
    for (let index=0; index<mounts.length; index++) {
      const pivot = new THREE.Group(); pivot.name = index<2?'后轮轴':'前轮转向轴';
      pivot.position.fromArray(mounts[index]); kart.add(pivot);
      const rolling = new THREE.Group(); rolling.name = '轮胎滚动轴'; pivot.add(rolling);
      const visual = new THREE.Group(); visual.name = 'Rodin 独立轮胎'; rolling.add(visual);
      visual.add(wheel.clone(true)); visual.rotation.fromArray([...(spec.wheelAsset.rotation||[0,0,0]),'XYZ']);
      visual.scale.setScalar(spec.wheelAsset.scale??1); visual.position.fromArray(spec.wheelAsset.offset||[0,0,0]);
      if (index%2===0) { const facing = new THREE.Group(); rolling.remove(visual); facing.add(visual); facing.rotation.y=Math.PI; rolling.add(facing); }
      wheels.push(rolling); wheelMounts.push(pivot.position.clone()); if(index>=2)frontWheels.push(pivot);
    }
    // Keep the established pixel courier, while all ten vehicle bodies and tires
    // are the generated assets. Reuse a single donor's immutable geometry.
    this.donors ||= new Map();
    if (!this.donors.has(spec.color)) this.donors.set(spec.color,createKart(THREE,{color:spec.color,number}));
    const donor = this.donors.get(spec.color).userData;
    const driver = donor.driver.clone(true); driver.position.fromArray(spec.driverPosition||[0,.59,-.19]);
    driver.scale.setScalar(spec.driverScale??1); chassis.add(driver);
    const exhaust = donor.exhaust.clone(true); exhaust.position.fromArray(spec.exhaustPosition||[0,.42,-1.3]); exhaust.visible=false; chassis.add(exhaust);
    const steering = new THREE.Group(); // Generated cockpit already contains its steering yoke.
    kart.userData = {modelId:id,wheels,frontWheels,wheelMounts,chassis,driver,exhaust,steering,wheelRadius:radius,color:spec.color,number,travel:0,generated:true};
    return kart;
  }
  async warm(ids, renderer, camera, scene) {
    if(!ids.some(Boolean))return;
    await Promise.all([...new Set(ids.filter(Boolean))].map(id=>this.load(id)));
    const probe = new THREE.Group();
    for (const id of new Set(ids.filter(Boolean))) probe.add(this.create(id));
    scene.add(probe);
    try { await renderer.compileAsync(scene,camera); } finally { scene.remove(probe); }
  }
}
