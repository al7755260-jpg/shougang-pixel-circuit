import * as THREE from 'three';
import {assetUrl} from './asset-url.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const P={carbon:0x384b55,steel:0x47606b,slate:0x586e77,concrete:0x778b92,trim:0x819c9f,glass:0x385f6a,deepGlass:0x234550,ice:0xc5e6e8,warm:0xf0c99a,rose:0xe1adb9,green:0x446e65,dark:0x203944};
function batch(){
  const source=[];
  let heightScale=1;
  return {
    setHeightScale(value){heightScale=value;},
    box(x,y,z,w,h,d,color,yaw=0){
      y=(y+1)*heightScale-1;h*=heightScale;
      const g=new THREE.BoxGeometry(w,h,d);if(yaw)g.rotateY(yaw);g.translate(x,y,z);
      const c=new THREE.Color(color),a=new Float32Array(g.attributes.position.count*3);
      for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}
      g.setAttribute('color',new THREE.BufferAttribute(a,3));source.push(g);
    },
    mesh(material,name){
      const geometry=mergeGeometries(source,false);for(const g of source)g.dispose();
      const mesh=new THREE.Mesh(geometry,material);mesh.name=name;return mesh;
    },
  };
}

function signTexture(text,ink){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=512;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='#213a47';ctx.fillRect(0,0,256,512);ctx.fillStyle=ink;
  ctx.fillRect(8,8,240,7);ctx.fillRect(8,497,240,7);ctx.fillRect(8,8,7,496);ctx.fillRect(241,8,7,496);
  const threeLines=[...text].length===3;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`900 ${threeLines?106:113}px "Microsoft YaHei",sans-serif`;
  [...text].forEach((ch,i)=>ctx.fillText(ch,128,(threeLines?110:128)+i*(threeLines?132:136)));
  ctx.font='bold 18px monospace';ctx.fillText('CITY LOOP',128,461);
  const texture=new THREE.CanvasTexture(canvas);texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}

// City campaign art preserves the three-character Shougang Park wordmark.
function parkPoster(){
  const texture=new THREE.TextureLoader().load(assetUrl('/assets/pv/shougang-pv-poster.png'));
  texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;return texture;
}
/** Supplementary park scenery only. Scanned heritage geometry is loaded separately. */
export function createDaylightScenery(track){
  const group=new THREE.Group();group.name='首钢 · 青雾城市增补';
  const masonry=batch(),paint=batch(),foliage=batch(),lights=batch();
  const surface=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.84,metalness:.08});surface.name='City graphite steel';
  const painted=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.54,metalness:.18});painted.name='City steel trims and dark glazing';
  const illuminated=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});illuminated.name='City sparse cyan, warm and rose lights';
  const cityLightPanels=[];
  let seed=2077;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  // Keep the established skyline beyond the scan. Most windows stay dark;
  // sparse unlit panes carry their cyan-white, warm and pale-rose display colors.
  for(let i=0;i<48;i++){
    const a=i/48*Math.PI*2,r=225+rand()*95,x=Math.cos(a)*r,z=Math.sin(a)*r;
    const h=25+rand()*85,w=7+rand()*11,d=7+rand()*9,color=[P.carbon,P.steel,P.slate,P.concrete][i%4];
    // Two supplementary western towers step down to open the start-line sky.
    // Scale their completed details together while preserving all RNG draws.
    const skylineScale=(i===23||i===24)?Math.min(1,28/h):1;
    for(const part of [masonry,paint,foliage,lights])part.setHeightScale(skylineScale);
    masonry.box(x,h/2-1,z,w,h,d,color);masonry.box(x,h+3,z,w*.7,6,d*.65,i%3?P.steel:P.trim);
    const accent=i%4===0?P.trim:i%3===0?P.slate:P.deepGlass;
    paint.box(x-w/2-.04,h/2,z,.15,h,d+.1,accent);
    for(let floor=4;floor<h;floor+=2.9)for(let column=-w/2+.7;column<w/2-.3;column+=1.6){
      if(rand()>.32){
        const choice=rand(),lit=choice>.82,glass=lit?(choice>.98?P.rose:choice>.945?P.warm:P.ice):choice>.2?P.glass:P.deepGlass;
        const panes=lit?lights:paint;panes.box(x+column,floor,z+d/2+.025,.45,.6,.045,glass);panes.box(x+column,floor,z-d/2-.025,.45,.6,.045,glass);
      }
    }
    if(i%3===0){paint.box(x,h+8,z,.12,14,.12,P.trim);lights.box(x,h+15,z,.4,.25,.4,P.warm);}
    if(i%4===0){masonry.box(x,h+6.4,z,w*.8,.65,d*.73,P.steel);foliage.box(x,h+6.95,z,w*.65,.6,d*.6,P.green);}
    if(i%3===1){
      // A small inward-facing blade sign reads across the park without lighting
      // the whole tower. Deterministic patterns leave the skyline's RNG intact.
      const index=(i-1)/3,nx=-x/r,nz=-z/r,yaw=Math.atan2(nx,nz),tx=nz,tz=-nx;
      const sw=1.4+(index%4)*.2,sh=8+(index%5)*2,sy=Math.max(sh/2+6,h*.63);
      const offset=Math.abs(nx)*w/2+Math.abs(nz)*d/2+.4,sx=x+nx*offset,sz=z+nz*offset;
      const ink=index%7===6?P.rose:index%5===3?P.warm:P.ice;
      const panelBox=(u,v,front,bw,bh,bd,color,target)=>target.box(sx+tx*u+nx*front,sy+v,sz+tz*u+nz*front,bw,bh,bd,color,yaw);
      panelBox(0,0,0,sw+.3,sh+.4,.26,P.dark,paint);
      panelBox(0,0,.18,sw,sh,.08,ink,lights);
      // Pixel glyphs and dark horizontal breaks survive the distant silhouette.
      const cell=sw/5,glyphCount=Math.floor(sh/(cell*5)),pitch=sh/glyphCount;
      for(let glyph=0;glyph<glyphCount;glyph++){
        const y0=-sh/2+(glyph+.5)*pitch;
        panelBox(0,y0-pitch*.48,.25,sw,.13,.045,P.dark,paint);
        for(let row=0;row<3;row++)for(let col=0;col<3;col++){
          if(((row*3+col+glyph+index)%5)<2)panelBox((col-1)*cell,y0+(row-1)*cell,.25,cell*.86,cell*.86,.045,P.dark,paint);
        }
      }
      cityLightPanels.push({buildingIndex:i,position:[sx,(sy+1)*skylineScale-1,sz],normal:[nx,0,nz],width:sw,height:sh*skylineScale,color:ink});
    }
  }
  for(const part of [masonry,paint,foliage,lights])part.setHeightScale(1);
  // These thin painted steel frames remain aligned with the four real furnaces.
  for(const [x,z,h,r]of [[-66,-102,17,10],[0,-102,21,10],[33.6,-102,18,8],[0,26.4,13,10]]){
    for(let level=3;level<h;level+=5.5)for(let side=0;side<4;side++){
      if(side%2===0)paint.box(x,level,z+(side?1:-1)*r,r*2,.12,.12,side?P.trim:P.steel);
      else paint.box(x+(side===1?1:-1)*r,level,z,.12,.12,r*2,P.steel);
    }
  }
  function sign(text,x,y,z,w,h,ink,rotation=0){
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:signTexture(text,ink),side:THREE.DoubleSide,toneMapped:false}));
    mesh.position.set(x,y,z);mesh.rotation.y=rotation;mesh.name=`城市立牌 · ${text}`;group.add(mesh);
  }
  sign('环线',43,15,-80,5,13,'#c5e6e8',Math.PI/4);
  sign('首钢园',-20,13,-85,4.5,12,'#f0c99a',0);
  sign('动力',15,11,33,3.5,10,'#e1adb9',Math.PI/2);
  sign('电玩',72,8,8,3.5,8,'#c5e6e8',-Math.PI/2);
  const shopCount=Math.min(28,Math.max(10,Math.ceil(track.length/52)));
  for(let i=0;i<shopCount;i++){
    const t=.035+i*.93/shopCount,p=track.getPoint(t),n=track.getNormal(t),s=i%2?1:-1;
    const q=p.addScaledVector(n,(track.width/2+8)*s),h=4+i%3;
    masonry.box(q.x,h/2,q.z,4.5,h,3.5,i%3?P.slate:P.carbon);
    paint.box(q.x,h-.2,q.z+1.8,4.6,.13,.15,i%2?P.trim:P.steel);
    for(let k=0;k<3;k++){
      const panes=k===1?lights:paint,glass=k===1?(i%4===0?P.rose:P.warm):P.glass;
      panes.box(q.x-1.5+k*1.45,h*.55,q.z+1.76,.75,1.2,.02,glass);
    }
  }
  // Established elevated rail and moving three-car train keep their positions and silhouettes.
  const railY=26,railZ=-132;
  masonry.box(0,railY,railZ,280,.7,3.5,P.steel);paint.box(0,railY+.45,railZ+1.8,280,.12,.12,P.trim);
  for(let x=-120;x<=120;x+=35)if(track.closest(x,railZ).distance>track.width/2+2.5)masonry.box(x,railY/2,railZ,.7,railY,.7,P.concrete);
  const train=new THREE.Group();train.name='城市高架通勤列车';const carriage=batch(),windows=batch();
  for(let i=0;i<3;i++){
    carriage.box(i*9,0,0,8,2.1,2.5,P.slate);windows.box(i*9,.2,0,7,1,2.56,P.ice);
    carriage.box(i*9,-.7,0,8,.15,2.62,i===1?P.trim:P.deepGlass);
    for(const s of [-1,1])carriage.box(i*9+s*2.5,-1.1,0,.8,.38,2.0,P.dark);
  }
  train.add(carriage.mesh(surface,'Slate steel commuter carriages'),windows.mesh(illuminated,'Pale cyan train windows'));train.position.set(-100,railY+1.5,railZ);group.add(train);
  const posterMaterial=new THREE.MeshBasicMaterial({map:parkPoster(),side:THREE.DoubleSide,toneMapped:false});
  for(const [x,y,z,rot]of [[72,9,23,-.6],[48,11,-10,Math.PI/2],[6,17,-88,0],[-18,10,33,Math.PI/2]]){
    const ad=new THREE.Mesh(new THREE.PlaneGeometry(7.5,7.5),posterMaterial);ad.position.set(x,y,z);ad.rotation.y=rot;ad.name='城市影像屏 · 首钢园 FUTURE PARK';group.add(ad);
    masonry.box(x,y-5,z,.35,5,.35,P.steel);
    paint.box(x,y+3.9,z,7.8,.10,.18,P.trim,rot);
  }
  // New trees are outside the complete scanned core (radius >= 350 m), never on the track.
  for(let i=0;i<44;i++){
    const a=i/44*Math.PI*2,r=350+rand()*38,x=Math.cos(a)*r,z=Math.sin(a)*r,h=5+rand()*6;
    masonry.box(x,h*.35-1,z,.95,h*.8,.95,0x3b4d49);
    foliage.box(x,h*.72,z,4.9,h*.56,4.9,i%3?0x446e65:0x385b55);
    foliage.box(x-.5,h*1.03,z+.2,3.9,h*.38,3.8,0x527d70);
    foliage.box(x+.2,h*1.23,z-.1,2.3,h*.20,2.4,0x5b887c);
  }
  // The clear-sky cloud blocks are removed. Distance comes from the atmospheric
  // sky gradient and the city's fog, with the real park left clear in front.
  group.add(masonry.mesh(surface,'Graphite and blue-gray city structures'),paint.mesh(painted,'Steel ribs and dark city glazing'),foliage.mesh(new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}),'Muted outer city greenery'),lights.mesh(illuminated,'Sparse city window lights'));
  const sky=new THREE.Mesh(new THREE.SphereGeometry(1700,32,20),new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,toneMapped:false,
    uniforms:{horizon:{value:new THREE.Color('#91c4cd')},zenith:{value:new THREE.Color('#326c83')}},
    vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'uniform vec3 horizon;uniform vec3 zenith;varying vec3 vP;void main(){float h=normalize(vP).y;vec3 c=mix(horizon,zenith,smoothstep(-.07,.34,h));gl_FragColor=vec4(c,1.);\n#include <colorspace_fragment>\n}',
  }));sky.name='Pale cyan-gray to petroleum-blue city sky';sky.renderOrder=-10;group.add(sky);
  group.userData.cityLightPanels=cityLightPanels;
  return {group,animate(time){train.position.x=((time*7)%360)-180;}};
}
