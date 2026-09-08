import {defineConfig} from 'vite';
export default defineConfig(({mode})=>({
  base:mode==='public'?'/shougang-pixel-circuit/':'/',
  publicDir:mode==='public'?false:'public',
  build:{outDir:mode==='public'?'dist-public':'dist'},
}));
