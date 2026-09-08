import fs from 'node:fs/promises';
import path from 'node:path';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip),root=new URL('../dist/',import.meta.url);
let files=0,original=0,encoded=0;
async function visit(directory){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()){await visit(file);continue;}
    if(!/\.(bin|glb|hdr|json|js|css|html|svg)$/i.test(file))continue;
    const data=await fs.readFile(file);if(data.length<1024)continue;
    const packed=await compress(data,{level:6});
    if(packed.length>=data.length*.95)continue;
    await fs.writeFile(file+'.gz',packed);files++;original+=data.length;encoded+=packed.length;
  }
}
await visit((await import('node:url')).fileURLToPath(root));
console.log(`Lossless network assets: ${files} files, ${(original/1e6).toFixed(1)} MB -> ${(encoded/1e6).toFixed(1)} MB`);
