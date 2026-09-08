import fs from 'node:fs/promises';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
const pack=promisify(gzip),unpack=promisify(gunzip);
for(const name of ['shougang-voxel','shougang-voxel-detail']){
  const raw=new URL(`../public/assets/${name}.bin`,import.meta.url),packed=new URL(raw.href+'.gz');
  const rawExists=await fs.stat(raw).catch(()=>null),packedExists=await fs.stat(packed).catch(()=>null);
  if(!packedExists&&rawExists)await fs.writeFile(packed,await pack(await fs.readFile(raw),{level:6}));
  else if(!rawExists&&packedExists)await fs.writeFile(raw,await unpack(await fs.readFile(packed)));
  else if(!rawExists)throw new Error(`Missing park asset: ${name}`);
}
const old=new URL('../public/assets/pv/blender-source-manifest.json',import.meta.url);
if(await fs.stat(old).catch(()=>null)){
  const clean=JSON.parse(await fs.readFile(old,'utf8'),(key,value)=>typeof value==='string'&&/^[a-z]:[\\/]/i.test(value)?'Local Blender source':value);
  clean.source='Shougang Pixel Circuit · Blender scene by Alex Li';
  await fs.writeFile(new URL('../public/assets/pv/pv-scene.json',import.meta.url),JSON.stringify(clean));
}
