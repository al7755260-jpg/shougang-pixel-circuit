import * as THREE from 'three';

const mod = v => (v % 1 + 1) % 1;

// Registered against five physical landmarks in the user's hand-drawn aerial
// reference. Start is southwest; west street -> north -> east -> bottom west.
const REFERENCE_LAYOUT = [[-21.2623866038,58.1740055871],[-28.9993150275,2.0334565355],[-38.2374927031,-67.5275450859],[59.7060008722,-68.4680375725],[67.9326750984,-56.7890284038],[57.7486236368,4.7671296169],[61.9812290904,53.6749214257],[2.3777511510,57.8671529284]];
const BASE_LENGTH = 401.8071577297179;

class GroundArc extends THREE.Curve {
  constructor(center, radius, startAngle, sweep, y) {
    super();Object.assign(this,{center,radius,startAngle,sweep,y});
  }
  getPoint(t, target = new THREE.Vector3()) {
    const a=this.startAngle+this.sweep*t;
    return target.set(this.center[0]+Math.cos(a)*this.radius,this.y,this.center[1]+Math.sin(a)*this.radius);
  }
  getPointAt(t, target) {return this.getPoint(t,target);}
  getTangent(t, target = new THREE.Vector3()) {
    const a=this.startAngle+this.sweep*t,s=Math.sign(this.sweep);
    return target.set(-Math.sin(a)*s,0,Math.cos(a)*s);
  }
  getTangentAt(t,target) {return this.getTangent(t,target);}
  getLength() {return this.radius*Math.abs(this.sweep);}
}

class StreetCurve extends THREE.CurvePath {
  // CurvePath.getPoint already traverses its children by distance. Applying the
  // generic Curve reparameterization again introduces needless lookup error.
  getPointAt(t,target) {return this.getPoint(mod(t+(this.routeStartOffset||0)),target);}
  getTangentAt(t,target = new THREE.Vector3()) {
    const lengths=this.getCurveLengths(),distance=mod(t+(this.routeStartOffset||0))*this.getLength();
    let i=0;while(i<lengths.length-1&&distance>lengths[i])i++;
    const start=i?lengths[i-1]:0,span=lengths[i]-start;
    return this.curves[i].getTangentAt(span?(distance-start)/span:0,target).normalize();
  }
}

function roundedStreets(layout,radius,y) {
  const count=layout.length,fillets=layout.map((c,i)=>{
    const p=layout[(i+count-1)%count],n=layout[(i+1)%count];
    const a=[c[0]-p[0],c[1]-p[1]],b=[n[0]-c[0],n[1]-c[1]],al=Math.hypot(...a),bl=Math.hypot(...b);
    a[0]/=al;a[1]/=al;b[0]/=bl;b[1]/=bl;
    const turn=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
    if(Math.abs(turn)<1e-8)return {entry:c,exit:c,arc:null};
    const cornerRadius=Array.isArray(radius)?radius[i]:radius;
    const trim=cornerRadius*Math.tan(Math.abs(turn)/2);
    if(trim>Math.min(al,bl)*.5)throw new Error('Street fillet exceeds adjacent segment clearance');
    const entry=[c[0]-a[0]*trim,c[1]-a[1]*trim],exit=[c[0]+b[0]*trim,c[1]+b[1]*trim];
    const sign=Math.sign(turn),center=[entry[0]-a[1]*sign*cornerRadius,entry[1]+a[0]*sign*cornerRadius];
    return {entry,exit,arc:new GroundArc(center,cornerRadius,Math.atan2(entry[1]-center[1],entry[0]-center[0]),turn,y)};
  });
  const curve=new StreetCurve();
  for(let i=0;i<count;i++){
    const from=fillets[i],to=fillets[(i+1)%count];
    if(Math.hypot(to.entry[0]-from.exit[0],to.entry[1]-from.exit[1])>1e-8)
      curve.add(new THREE.LineCurve3(new THREE.Vector3(from.exit[0],y,from.exit[1]),new THREE.Vector3(to.entry[0],y,to.entry[1])));
    if(to.arc)curve.add(to.arc);
  }
  return curve;
}

export function createTrack() {
  const y = 1.4;
  const layout=REFERENCE_LAYOUT.map(p=>[...p]),radii=[8,10,10,10,10,10,10,10];
  const desiredStart=new THREE.Vector3(layout[0][0],y,layout[0][1]);
  // A small adjustment to the virtual southwest corner places the midpoint of
  // its smooth turn exactly at the marked start. Other reference controls stay
  // fixed; no global scale or forced lap-length multiplier is applied.
  let curve;
  for(let i=0;i<18;i++){
    curve=roundedStreets(layout,radii,y);
    const corner=curve.curves.at(-1),midpoint=corner.getPoint(.5);
    const dx=desiredStart.x-midpoint.x,dz=desiredStart.z-midpoint.z;
    if(Math.hypot(dx,dz)<1e-9)break;
    layout[0][0]+=dx;layout[0][1]+=dz;
  }
  const finalCorner=curve.curves.at(-1);
  curve.routeStartOffset=(curve.getLength()-finalCorner.getLength()/2)/curve.getLength();
  const count=1600;
  const samples=Array.from({length:count+1},(_,i)=>curve.getPointAt(i/count));
  const cellSize=14,grid=new Map(),seen=new Uint32Array(count);let stamp=0;
  for(let i=0;i<count;i++){
    const a=samples[i],b=samples[i+1];
    for(let cx=Math.floor(Math.min(a.x,b.x)/cellSize);cx<=Math.floor(Math.max(a.x,b.x)/cellSize);cx++)
      for(let cz=Math.floor(Math.min(a.z,b.z)/cellSize);cz<=Math.floor(Math.max(a.z,b.z)/cellSize);cz++){
        const key=`${cx},${cz}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);
      }
  }
  const track={curve,width:8.8,y,length:curve.getLength(),samples,version:'exhibition-loop-v4',name:'展馆环线',label:'展馆环线',baseLength:BASE_LENGTH,minTurnRadius:8,layoutScale:1,
    getPoint(t){return curve.getPointAt(mod(t));},
    getTangent(t){return curve.getTangentAt(mod(t)).normalize();},
    getNormal(t){const d=this.getTangent(t);return new THREE.Vector3(d.z,0,-d.x);},
    closest(x,z){
      let best=Infinity, index=0, alpha=0, px=0,pz=0;
      stamp=(stamp+1)>>>0;if(stamp===0){seen.fill(0);stamp=1;}
      const evaluate=i=>{
        if(seen[i]===stamp)return;seen[i]=stamp;
        const a=samples[i],b=samples[i+1],dx=b.x-a.x,dz=b.z-a.z;
        const u=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
        const qx=a.x+dx*u,qz=a.z+dz*u,d=(x-qx)**2+(z-qz)**2;
        // Resolve equal-distance facets deterministically across the lap seam.
        const tieTolerance=1e-12*Math.max(1e-6,Math.min(best,100));
        if(d<best-tieTolerance||(Math.abs(d-best)<=tieTolerance&&i<index)){best=d;index=i;alpha=u;px=qx;pz=qz;}
      };
      const cx=Math.floor(x/cellSize),cz=Math.floor(z/cellSize);
      let certified=false;
      for(let ring=0;ring<=8;ring++){
        for(let gx=cx-ring;gx<=cx+ring;gx++)for(let gz=cz-ring;gz<=cz+ring;gz++){
          if(ring&&gx!==cx-ring&&gx!==cx+ring&&gz!==cz-ring&&gz!==cz+ring)continue;
          const ids=grid.get(`${gx},${gz}`);if(ids)for(const i of ids)evaluate(i);
        }
        // Every segment is indexed in each cell its bounding box touches. Once
        // the found distance fits inside this searched square, unseen segments
        // provably cannot be closer, including across the lap seam.
        const boundary=Math.min(x-(cx-ring)*cellSize,(cx+ring+1)*cellSize-x,z-(cz-ring)*cellSize,(cz+ring+1)*cellSize-z);
        if(best<=boundary*boundary){certified=true;break;}
      }
      if(!certified)for(let i=0;i<count;i++)evaluate(i);
      const a=samples[index],b=samples[index+1],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
      return {t:mod((index+alpha)/count),point:{x:px,y,z:pz},distance:Math.sqrt(best),signedDistance:((x-px)*dz-(z-pz)*dx)/len};
    }
  };
  const vertexT=layout.map(([x,z])=>track.closest(x,z).t);
  track.sections=[
    {name:'西侧街道 · 起跑上行',kind:'straight',start:0,end:vertexT[2]},
    {name:'北侧展馆大道',kind:'straight',start:vertexT[2],end:vertexT[4]},
    {name:'白顶展馆东侧',kind:'sweeper',start:vertexT[4],end:vertexT[6]},
    {name:'南侧街道 · 向西回归',kind:'straight',start:vertexT[6],end:1}
  ];
  return track;
}

function pixelAsphalt() {
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');
  let seed=902;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const v=47+Math.floor(random()*16);
    ctx.fillStyle=`rgb(${v},${v+2},${v+3})`;ctx.fillRect(x,y,1,1);
  }
  // Mineral grains add a restrained pixel texture to the dry asphalt.
  for(let i=0;i<90;i++){ctx.fillStyle=i%2?'#414342':'#2b2d2e';ctx.fillRect(random()*128,random()*128,1+random()*2,1+random()*3);}
  const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestMipmapNearestFilter;tex.colorSpace=THREE.SRGBColorSpace;
  return tex;
}

function asphaltRoadMaterial() {
  // Rough, non-metallic aggregate spreads the sun into a soft highlight.
  // Keep the road dark enough to read as asphalt under the bright HDR sky.
  const aggregate=pixelAsphalt();
  const material=new THREE.MeshStandardMaterial({name:'干燥颗粒沥青 · PBR',map:aggregate,
    bumpMap:aggregate,bumpScale:.05,roughness:.92,metalness:0,envMapIntensity:.35,side:THREE.DoubleSide});
  return material;
}

export function createRoad(track) {
  const group=new THREE.Group();group.name='霓虹环线 / 可驾驶路面';
  const segments=Math.ceil(track.length/.45);
  function strip(left,right,height,material,checker=false){
    const positions=[],uv=[],colors=[],indices=[];
    for(let i=0;i<=segments;i++){
      const t=i/segments,p=track.getPoint(t),n=track.getNormal(t);
      const color=new THREE.Color(Math.floor(t*track.length/2.2)%2===0?0xe0e9e4:0x334d5b);
      for(const side of [left,right]){positions.push(p.x+n.x*side,height,p.z+n.z*side);uv.push((side-left)/(right-left)*2,i/segments*track.length/7);if(checker)colors.push(color.r,color.g,color.b);}
      if(i<segments){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    if(checker)geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,material);mesh.receiveShadow=true;group.add(mesh);return mesh;
  }
  const w=track.width/2;
  const surface=strip(-w,w,track.y,asphaltRoadMaterial());
  surface.name='比赛路面 · 干燥颗粒沥青';group.userData.surface=surface;
  const curb=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:.08,side:THREE.DoubleSide});
  strip(-w-.65,-w,track.y+.025,curb,true);strip(w,w+.65,track.y+.025,curb,true);
  const cyan=new THREE.MeshBasicMaterial({color:0x71b8c4,side:THREE.DoubleSide});
  const pink=new THREE.MeshBasicMaterial({color:0x75939f,side:THREE.DoubleSide});
  strip(-w-.82,-w-.66,track.y+.05,cyan);strip(w+.66,w+.82,track.y+.05,pink);
  return group;
}
