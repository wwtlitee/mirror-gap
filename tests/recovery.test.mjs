import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {beijingHour} from '../public/beijing-time.mjs';
import {daylightState,updateLiving} from '../src/living-world.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';

const motor={local:[0,0,0],drive:0,behavior:{grooming:1}};
const fresh=()=>{const s=new EmbodiedLife().state;Object.assign(s.actor,{position:[0,.125,.75],contact:true,velocity:[0,0,0],zoneId:'flight',action:'observe'});s.living.contactSeconds=4;return s;};
test('Beijing clock crosses UTC date boundary and is independent of simulation speed',()=>{
  assert.equal(beijingHour(new Date('2026-09-20T16:30:00Z')),.5);
  const s=fresh();s.speed=10;s.simSeconds=999999;
  assert.equal(daylightState(s,new Date('2026-09-20T04:00:00Z')).hour,12);
  s.paused=true;assert.equal(daylightState(s,new Date('2026-09-20T05:00:00Z')).hour,13);
});
test('energy is spent walking and flying; rest restores energy and comfort',()=>{
  for(const contact of [true,false]){const s=fresh();s.needs.energy=50;s.actor.contact=contact;s.actor.velocity=[.12,0,0];updateLiving(s,motor,1);assert.ok(s.needs.energy<50);}
  const s=fresh();s.actor.zoneId='rest';s.needs.energy=50;s.needs.comfort=50;s.living.physiology.sleepPressure=.8;updateLiving(s,motor,1);
  assert.ok(s.needs.energy>50);assert.ok(s.needs.comfort>50);assert.ok(s.living.physiology.sleepPressure<.8);
});
test('awake metabolism increases thirst sleep dirt waste; adverse needs lower comfort',()=>{
  const s=fresh();const before=structuredClone(s.living.physiology);s.living.physiology.dirt=.8;s.living.physiology.thirst=.8;s.needs.comfort=50;
  updateLiving(s,{...motor,behavior:{grooming:0}},1);
  assert.ok(s.living.physiology.thirst>.8);assert.ok(s.living.physiology.dirt>.8);
  assert.ok(s.living.physiology.waste>before.waste);assert.ok(s.living.physiology.sleepPressure>before.sleepPressure);assert.ok(s.needs.comfort<50);
});
test('mist and disturbance rise then decay, without changing thirst; all ten values remain bounded',()=>{
  const sim=new EmbodiedLife();const s=sim.state;const thirst=s.living.physiology.thirst;
  sim.interact('mist');sim.environmentCommand('disturbance','shadow');assert.ok(s.living.wetness>0);assert.ok(s.living.alert>0);assert.equal(s.living.physiology.thirst,thirst);
  const wet=s.living.wetness,alert=s.living.alert;s.actor.contact=false;updateLiving(s,motor,1);assert.ok(s.living.wetness<wet);assert.ok(s.living.alert<alert);
  for(let i=0;i<1000;i++)updateLiving(s,motor,.1);
  for(const n of Object.values(s.needs))assert.ok(Number.isFinite(n)&&n>=0&&n<=100);
  for(const n of [...Object.values(s.living.physiology),s.living.alert,s.living.wetness])assert.ok(Number.isFinite(n)&&n>=0&&n<=1);
});
test('invalid transient state cannot overwrite a valid checkpoint',()=>{
  const sim=new EmbodiedLife();sim.state.actor.position[0]=NaN;assert.throws(()=>sim.serialize(),/非有限/);
});
test('every packed collision triangle has nonzero area',()=>{
  const b=fs.readFileSync(new URL('../public/assets/room-collision.bin',import.meta.url));
  const meta=JSON.parse(fs.readFileSync(new URL('../public/assets/room-collision.json',import.meta.url),'utf8'));
  const a=meta.format==='float32-v1'?new Float32Array(b.buffer,b.byteOffset,b.length/4):new Int16Array(b.buffer,b.byteOffset,b.length/2);
  for(let i=0;i<a.length;i+=10){const x=a[i+3]-a[i],y=a[i+4]-a[i+1],z=a[i+5]-a[i+2],u=a[i+6]-a[i],v=a[i+7]-a[i+1],w=a[i+8]-a[i+2];assert.ok((y*w-z*v)**2+(z*u-x*w)**2+(x*v-y*u)**2>0,`triangle ${i/10}`);}
});

test('real neural resident cleans dirt on water contact without an unreachable grooming gate',()=>{
 const sim=new EmbodiedLife();Object.assign(sim.state.actor,{position:[4.5,.3851,3.1],velocity:[0,0,0],contact:true,zoneId:'entry',action:'observe'});
 Object.assign(sim.state.living.physiology,{dirt:.9,thirst:.05});
 for(let i=0;i<160;i++)sim.tick(.1);
 assert.ok(sim.state.living.physiology.dirt<.6);assert.ok(sim.state.living.hygiene.bathSeconds>4);assert.ok(sim.state.living.wetness>.1);assert.equal(sim.neural.error,null);
});

test('relocated habitat toilet has physical support and neural resident completes elimination',()=>{
 const sim=new EmbodiedLife();Object.assign(sim.state.actor,{position:[4.39,.615,.38],velocity:[0,0,0],contact:true,zoneId:'toilet',action:'observe'});sim.state.living.physiology.waste=.9;
 for(let i=0;i<180;i++)sim.tick(.1);
 assert.equal(sim.state.living.hygiene.bowelMovements,1);assert.ok(sim.state.living.physiology.waste<.12);assert.equal(sim.state.actor.supportFeet,6);
 assert.ok(sim.state.actor.position[0]>2.65&&sim.state.actor.position[2]>0&&sim.state.actor.position[2]<1);
});
