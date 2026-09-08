import * as THREE from 'three';
import {assetUrl,PUBLIC_BUILD} from './asset-url.js';

async function readAsset(url,signal,onProgress){
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error(`园区资源载入失败 (${response.status})`);
  const decodedLength=Number(response.headers.get('x-uncompressed-length'));
  const length=decodedLength||Number(response.headers.get('content-length'));
  if(!response.body||!length||(response.headers.get('content-encoding')&&!decodedLength))return response.arrayBuffer();
  const reader=response.body.getReader(),buffer=new Uint8Array(length);let received=0;
  while(true){const {done,value}=await reader.read();if(done)break;if(received+value.byteLength>length)throw new Error('园区资源长度异常');buffer.set(value,received);received+=value.byteLength;onProgress(received/length);}
  if(received!==length)throw new Error('园区资源传输未完成');
  return buffer.buffer;
}

// Join neighbouring quantized blocks without simplifying the scan or expanding
// positions to floats. Keep 2x2 horizontal cells by default: larger batches trade
// fewer draw calls for more off-screen geometry. The original metadata is kept.
async function batchQuantizedChunks(meta,data,size,signal,onProgress){
  size=Math.max(1,Math.min(3,Math.floor(size)||1));
  const unchanged={...data,chunks:meta.chunks,stats:{size:1,sourceChunks:meta.chunks.length,renderChunks:meta.chunks.length,maxPositionError:0}};
  if(size===1||data.positions instanceof Float32Array||!meta.chunks.every(c=>c.key&&c.positionOrigin&&c.localBounds&&c.positionScale))return unchanged;
  const groups=new Map();
  for(const [index,chunk] of meta.chunks.entries()){
    const key=[chunk.positionScale,Math.floor(chunk.key[0]/size),Math.floor(chunk.key[1]/2),Math.floor(chunk.key[2]/size)].join(':');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({index,chunk});
  }
  const batches=[];let maximumCoordinate=0,maxPositionError=0;
  for(const entries of groups.values()){
    const scale=entries[0].chunk.positionScale,origin=[Infinity,Infinity,Infinity];
    for(const {chunk} of entries)for(let axis=0;axis<3;axis++)origin[axis]=Math.min(origin[axis],chunk.positionOrigin[axis]);
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    let vertexCount=0,indexCount=0;
    for(const entry of entries){
      const c=entry.chunk;entry.offset=c.positionOrigin.map((value,axis)=>Math.round((value-origin[axis])/scale));
      for(let axis=0;axis<3;axis++){
        const error=Math.abs(origin[axis]+entry.offset[axis]*scale-c.positionOrigin[axis]);
        maxPositionError=Math.max(maxPositionError,error);
        // Foreign/non-grid assets retain their original unbatched geometry.
        if(error>2e-5)return unchanged;
        bounds.min[axis]=Math.min(bounds.min[axis],c.localBounds.min[axis]+entry.offset[axis]);
        bounds.max[axis]=Math.max(bounds.max[axis],c.localBounds.max[axis]+entry.offset[axis]);
        maximumCoordinate=Math.max(maximumCoordinate,bounds.max[axis]);
      }
      vertexCount+=c.vertexCount;indexCount+=c.indexCount;
    }
    batches.push({entries,origin,scale,bounds,vertexCount,indexCount});
  }
  if(maximumCoordinate>65535)return unchanged;
  const CoordinateArray=maximumCoordinate<=255?Uint8Array:Uint16Array;
  const positions=new CoordinateArray(data.positions.length),normals=new Int8Array(data.normals.length),srgb=new Uint8Array(data.srgb.length),indices=new Uint32Array(data.indices.length),chunks=[];
  let vertexStart=0,indexStart=0;
  for(const [batchIndex,batch] of batches.entries()){
    if(batchIndex%8===0){signal?.throwIfAborted();onProgress(batchIndex/batches.length);await new Promise(resolve=>setTimeout(resolve,0));}
    let localVertex=0,localIndex=0;
    for(const {chunk,offset} of batch.entries){
      const start=chunk.vertexStart*3,end=(chunk.vertexStart+chunk.vertexCount)*3,destination=(vertexStart+localVertex)*3;
      for(let source=start,target=destination;source<end;source+=3,target+=3){
        positions[target]=data.positions[source]+offset[0];positions[target+1]=data.positions[source+1]+offset[1];positions[target+2]=data.positions[source+2]+offset[2];
      }
      normals.set(data.normals.subarray(start,end),destination);srgb.set(data.srgb.subarray(start,end),destination);
      for(let i=0;i<chunk.indexCount;i++)indices[indexStart+localIndex+i]=data.indices[chunk.indexStart+i]+localVertex;
      localVertex+=chunk.vertexCount;localIndex+=chunk.indexCount;
    }
    chunks.push({vertexStart,vertexCount:batch.vertexCount,indexStart,indexCount:batch.indexCount,positionOrigin:batch.origin,positionScale:batch.scale,localBounds:batch.bounds,sourceChunkIndices:batch.entries.map(entry=>entry.index)});
    vertexStart+=batch.vertexCount;indexStart+=batch.indexCount;
  }
  onProgress(1);
  return {positions,normals,srgb,indices,chunks,stats:{size,sourceChunks:meta.chunks.length,renderChunks:chunks.length,maxPositionError,positionBytes:CoordinateArray.BYTES_PER_ELEMENT}};
}

// This mesh is derived from the supplied scan. Only exposed voxel faces are
// stored, and separate park blocks can be culled when they are off camera.
export async function loadVoxelEnvironment({signal,onProgress=()=>{},quality='original',mergeChunks=2}={}){
  const base=assetUrl(quality==='original'?'/assets/shougang-voxel-detail':'/assets/shougang-voxel');
  const response=await fetch(`${base}.json`,{signal});
  if(!response.ok)throw new Error('像素园区资料未找到');
  const meta=await response.json();
  let buffer=await readAsset(`${base}.bin${PUBLIC_BUILD?'.gz':''}`,signal,p=>onProgress(p*.85));
  if(PUBLIC_BUILD&&new Uint8Array(buffer)[0]===31&&new Uint8Array(buffer)[1]===139){
    if(typeof DecompressionStream!=='undefined')buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    else {const {gunzipSync}=await import('fflate');buffer=gunzipSync(new Uint8Array(buffer)).buffer;}
  }
  onProgress(.9);
  const attributes=meta.attributes;
  const PositionArray=attributes.position.componentType==='uint8'?Uint8Array:attributes.position.componentType==='uint16'?Uint16Array:Float32Array;
  const sourceData={positions:new PositionArray(buffer,attributes.position.byteOffset,attributes.position.count),normals:new Int8Array(buffer,attributes.normal.byteOffset,attributes.normal.count),srgb:new Uint8Array(buffer,attributes.color.byteOffset,attributes.color.count),indices:new Uint32Array(buffer,attributes.index.byteOffset,attributes.index.count)};
  const {positions,normals,srgb,indices,chunks,stats:batching}=await batchQuantizedChunks(meta,sourceData,mergeChunks,signal,p=>onProgress(.9+p*.075));
  const group=new THREE.Group();group.name='首钢园 · 实景体素重构';
  group.matrixAutoUpdate=false;
  // Preserve the scan's colors as the surface base color while letting the
  // park share the sun, ambient illumination and shadows of the racing scene.
  // DC colors already contain some captured shading; do not bake in another
  // color tint or contrast adjustment here.
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,metalness:0});
  material.name='首钢园 · 原色体素 PBR';
  // Keep original sRGB bytes on the CPU/GPU. Decode once to linear for Three's
  // output color conversion; avoid a second float-sized copy of the park.
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>',`#include <color_vertex>
    #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
      vColor.rgb = mix(vColor.rgb / 12.92, pow((vColor.rgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), vColor.rgb));
    #endif`);
  };
  material.customProgramCacheKey=()=> 'voxel-source-dc-standard-srgb-v3';
  const shadowChunks=[];
  // Only nearby park blocks need to render into the moving sun shadow map.
  // Use each block's full horizontal bounds so a tall building or wide block
  // intersecting the radius is kept even when its centre lies outside it.
  function updateShadows(position,radius=70){
    const radiusSquared=Math.max(0,radius)**2;
    let count=0;
    for(const {mesh,minX,maxX,minZ,maxZ} of shadowChunks){
      const dx=Math.max(minX-position.x,0,position.x-maxX);
      const dz=Math.max(minZ-position.z,0,position.z-maxZ);
      mesh.castShadow=dx*dx+dz*dz<=radiusSquared;
      if(mesh.castShadow)count++;
    }
    return count;
  }
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;for(const mesh of group.children)mesh.geometry.dispose();material.dispose();group.clear();shadowChunks.length=0;};
  try{for(const [i,chunk] of chunks.entries()){
    if(i%32===0){signal?.throwIfAborted();onProgress(.975+.025*i/chunks.length);await new Promise(resolve=>setTimeout(resolve,0));}
    const start=chunk.vertexStart*3,end=(chunk.vertexStart+chunk.vertexCount)*3;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions.subarray(start,end),3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(normals.subarray(start,end),3,true));
    geometry.setAttribute('color',new THREE.BufferAttribute(srgb.subarray(start,end),3,true));
    geometry.setIndex(new THREE.BufferAttribute(indices.subarray(chunk.indexStart,chunk.indexStart+chunk.indexCount),1));
    const origin=new THREE.Vector3(...(chunk.positionOrigin||[0,0,0])),scale=chunk.positionScale||1;
    geometry.boundingBox=chunk.localBounds?new THREE.Box3(new THREE.Vector3(...chunk.localBounds.min),new THREE.Vector3(...chunk.localBounds.max)):new THREE.Box3(new THREE.Vector3(...chunk.bounds.min).sub(origin).divideScalar(scale),new THREE.Vector3(...chunk.bounds.max).sub(origin).divideScalar(scale));
    geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(origin);mesh.scale.setScalar(scale);mesh.name=`园区体素 ${group.children.length+1}`;
    mesh.userData.sourceChunkIndices=chunk.sourceChunkIndices||[i];
    mesh.updateMatrix();mesh.matrixAutoUpdate=false;
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
    const bounds=geometry.boundingBox;
    shadowChunks.push({mesh,minX:bounds.min.x*scale+origin.x,maxX:bounds.max.x*scale+origin.x,minZ:bounds.min.z*scale+origin.z,maxZ:bounds.max.z*scale+origin.z});
  }signal?.throwIfAborted();}catch(error){dispose();throw error;}
  group.userData={environmentStyle:'voxel',voxelQuality:quality,numVoxels:meta.totalVoxels,voxelSize:meta.voxel?.size??meta.voxelSize,triangles:meta.indexCount/3,colorMode:'source-dc-pbr-srgb',batching};
  onProgress(1);
  return {group,meta,updateShadows,dispose};
}
