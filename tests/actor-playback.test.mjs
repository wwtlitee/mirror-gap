import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorPlayback} from '../public/actor-playback.mjs';
const frame=(t,{paused=false,speed=1,heading=0,contact=false}={})=>({simSeconds:t,paused,speed,actor:{position:[.35*t,3,1],velocity:[.35,0,0],heading,pitch:0,bank:0,contact},living:{contactSeconds:0}});
test('jittered 10 Hz flight is continuous at 60 and 120 Hz without packet speed pulses',()=>{
 for(const hz of [60,120]){
  const p=new ActorPlayback();let packet=0,s=frame(0),last=null;const speeds=[];
  for(let i=0;i<hz*6;i++){
   const now=i/hz,next=(packet+1)*.1+[0,.016,0,.025,0][(packet+1)%5];
   if(now>=next){packet++;s=frame(packet*.1);}
   const pose=p.sample(s,1/hz);
   if(last&&now>1)speeds.push((pose.actor.position[0]-last)/ (1/hz));
   last=pose.actor.position[0];assert.ok(p.frames.length<=5);
  }
  assert.ok(Math.max(...speeds)-Math.min(...speeds)<.000001);
  assert.ok(Math.abs(speeds[0]-.35)<.000001);
 }
});
test('pause is immediate; resume and speed changes discard the old buffer',()=>{
 const p=new ActorPlayback();for(let i=0;i<30;i++)p.sample(frame(i*.1),.1);
 const paused=frame(3,{paused:true});assert.deepEqual(p.sample(paused,.016).actor.position,paused.actor.position);
 const resumed=p.sample(frame(3.1),.016);assert.deepEqual(resumed.actor.position,frame(3.1).actor.position);
 p.sample(frame(3.2,{speed:3}),.016);assert.equal(p.frames.length,1);
});
test('heading crosses the angle seam through the short arc; network gaps never extrapolate',()=>{
 const p=new ActorPlayback();p.sample(frame(0,{heading:3.1}),0);p.sample(frame(.1,{heading:-3.1}),.19);
 const mid=p.sample(frame(.1,{heading:-3.1}),0);assert.ok(Math.abs(mid.actor.heading-Math.PI)<.001);
 for(let i=0;i<120;i++){const s=p.sample(frame(.1,{heading:-3.1}),1/120);assert.ok(s.actor.position[0]<=.03500001);}
 assert.ok(p.frames.length<=2);
});
test('interpolation does not mutate saved snapshots and resets on timeline restart',()=>{
 const p=new ActorPlayback(),s=frame(100),copy=structuredClone(s);p.sample(s,.016);p.sample(frame(100.1),.016);assert.deepEqual(s,copy);
 const restart=frame(0);assert.deepEqual(p.sample(restart,.016).actor.position,restart.actor.position);
});

test('a consistently slower simulation does not repeatedly drain the render buffer',()=>{
 const p=new ActorPlayback();let packet=0,last=null,stopped=0,total=0;
 for(let i=0;i<60*15;i++){
  const wall=i/60;while((packet+1)*.16<=wall)packet++;
  const pose=p.sample(frame(packet*.1),1/60);
  if(wall>5){total++;if(Math.abs(pose.actor.position[0]-last)<1e-8)stopped++;}
  assert.ok(pose.actor.position[0]<=packet*.1*.35+1e-8);last=pose.actor.position[0];
 }
 assert.ok(stopped/total<.01,`stopped ${stopped}/${total}`);
 assert.ok(Math.abs(p.diagnostics().clockRate-.625)<.03);
});
