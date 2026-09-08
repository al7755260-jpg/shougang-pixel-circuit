import test from 'node:test';
import assert from 'node:assert/strict';
import {FramePacer,renderPixelRatio} from '../src/render-budget.js';
import {AdaptiveResolution} from '../src/adaptive-resolution.js';

const bufferPixels=(width,height,ratio)=>Math.floor(width*ratio)*Math.floor(height*ratio);
function sampleFrames(adaptive,ms,count,targetFps=60){
  for(let i=0;i<count;i++)adaptive.sample(ms,true,targetFps);
}

test('a 4K desktop at DPR 2 stays within a 1080p render budget',()=>{
  const width=3840,height=2160,ratio=renderPixelRatio({width,height,devicePixelRatio:2});
  assert(ratio>0);
  assert(bufferPixels(width,height,ratio)<=1920*1080);
  assert.equal(ratio,.5);
});

test('phone rendering respects both its DPR ceiling and 720p pixel budget',()=>{
  for(const [width,height] of [[390,844],[1170,2532],[2532,1170]]){
    const ratio=renderPixelRatio({width,height,devicePixelRatio:3,mobile:true});
    assert(ratio>0&&ratio<=1.25);
    assert(bufferPixels(width,height,ratio)<=1280*720,`${width} x ${height} exceeds the mobile budget`);
  }
  assert.equal(renderPixelRatio({width:390,height:844,devicePixelRatio:1,mobile:true}),1);
});

test('coarser pixel settings and lower adaptive scales only reduce render cost',()=>{
  const viewport={width:2560,height:1440,devicePixelRatio:2};
  for(const pixelSize of [1,1.5,2]){
    let previous=Infinity;
    for(const scale of [1,.9,.8,.62]){
      const ratio=renderPixelRatio({...viewport,pixelSize,scale});
      assert(ratio>0&&ratio<previous);
      assert(bufferPixels(viewport.width,viewport.height,ratio)<=1920*1080);
      previous=ratio;
    }
  }
  for(const scale of [1,.9,.8,.62]){
    const ratios=[1,1.5,2].map(pixelSize=>renderPixelRatio({...viewport,pixelSize,scale}));
    assert(ratios[0]>ratios[1]&&ratios[1]>ratios[2]);
  }
  const native=renderPixelRatio(viewport),coarseAdaptive=renderPixelRatio({...viewport,pixelSize:2,scale:.8});
  assert(Math.abs(coarseAdaptive-native*.4)<1e-12);
});

for(const refreshHz of [60,120])test(`30 FPS pacing remains 30 FPS on a ${refreshHz} Hz display`,()=>{
  const pacer=new FramePacer(),renderTimes=[],seconds=10;
  // Non-zero clock origin and small RAF jitter reproduce fractional timestamps.
  const jitter=[-.11,.12,.03,-.04];
  for(let frame=0;frame<refreshHz*seconds;frame++){
    const now=113.27+frame*1000/refreshHz+jitter[frame%jitter.length];
    if(pacer.due(now,30))renderTimes.push(now);
  }
  assert(renderTimes.length>=299&&renderTimes.length<=301,`rendered ${renderTimes.length} frames in ${seconds} seconds`);
  const meanMs=(renderTimes.at(-1)-renderTimes[0])/(renderTimes.length-1);
  assert(Math.abs(meanMs-1000/30)<.1,`mean frame interval was ${meanMs} ms`);
});

test('an isolated 500 ms stall does not lower adaptive resolution',()=>{
  const changes=[],adaptive=new AdaptiveResolution(scale=>changes.push(scale));
  sampleFrames(adaptive,1000/60,180);
  adaptive.sample(500,true);
  sampleFrames(adaptive,1000/60,240);
  assert.equal(adaptive.scale,1);
  assert.deepEqual(changes,[]);
});

test('sustained 500 ms frames lower resolution instead of being ignored forever',()=>{
  const changes=[],adaptive=new AdaptiveResolution(scale=>changes.push(scale));
  sampleFrames(adaptive,500,24);
  assert(adaptive.scale<1&&adaptive.scale>=.62);
  assert(changes.length>0);
  assert(changes.every((scale,i)=>scale<(i?changes[i-1]:1)));
});

test('a healthy menu running at its 30 FPS target keeps full resolution',()=>{
  const changes=[],adaptive=new AdaptiveResolution(scale=>changes.push(scale));
  sampleFrames(adaptive,1000/30,600,30);
  assert.equal(adaptive.scale,1);
  assert.deepEqual(changes,[]);
});

test('a menu persistently running at 15 FPS lowers resolution',()=>{
  const adaptive=new AdaptiveResolution();
  sampleFrames(adaptive,1000/15,120,30);
  assert(adaptive.scale<1&&adaptive.scale>=.62);
});

test('disabling adaptation restores full resolution and ignores further slow frames',()=>{
  const changes=[],adaptive=new AdaptiveResolution(scale=>changes.push(scale));
  sampleFrames(adaptive,500,24);
  assert(adaptive.scale<1);
  adaptive.setEnabled(false);
  assert.equal(adaptive.scale,1);
  assert.equal(changes.at(-1),1);
  const count=changes.length;
  sampleFrames(adaptive,500,50);
  assert.equal(adaptive.scale,1);
  assert.equal(changes.length,count);
});
