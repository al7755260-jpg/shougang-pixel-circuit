import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
for(const file of ['assets/shougang-voxel.bin.gz','assets/shougang-voxel-detail.bin.gz','assets/shougang-voxel.json','assets/shougang-voxel-detail.json',
  'assets/pv/blender-pv-sky.hdr','assets/pv/blender-voxel-clouds.glb','assets/pv/pv-scene.json','assets/pv/shougang-pv-poster.png','assets/font/OFL-PressStart2P.txt','assets/font/SOURCE.txt','runtime.json','manifest.webmanifest','icon.svg']){
  const target=new URL('dist-public/'+file,root);await fs.mkdir(new URL('./',target),{recursive:true});await fs.copyFile(new URL('public/'+file,root),target);
}
for(const dir of ['models','thumbnails'])await fs.cp(new URL('public/assets/vehicles/'+dir,root),new URL('dist-public/assets/vehicles/'+dir,root),{recursive:true});
await fs.cp(new URL('public/assets/kong/',root),new URL('dist-public/assets/kong/',root),{recursive:true});
await fs.cp(new URL('public/assets/granny/',root),new URL('dist-public/assets/granny/',root),{recursive:true});
await fs.writeFile(new URL('dist-public/.nojekyll',root),'');
await fs.copyFile(new URL('THIRD_PARTY.md',root),new URL('dist-public/THIRD_PARTY.md',root));
const licenses=[];
for(const [name,file] of [['Three.js','three/LICENSE'],['Spark','@sparkjsdev/spark/LICENSE'],['fflate','fflate/LICENSE'],['ws','ws/LICENSE'],['Vite','vite/LICENSE.md']])licenses.push(`${name}\n\n${await fs.readFile(new URL('node_modules/'+file,root),'utf8')}`);
await fs.writeFile(new URL('dist-public/THIRD_PARTY-LICENSES.txt',root),licenses.join('\n\n----------------------------------------\n\n'));
console.log('Public package: compressed voxel park, ten cars, sky, and runtime endpoint.');
