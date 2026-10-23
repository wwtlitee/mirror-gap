import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbodiedLife } from '../src/embodied-life.mjs';
import { senseEnvironment } from '../src/neural-controller.mjs';
import { SURFACE_CUES, updateSurfaceLife, surfaceRestlessness } from '../public/surface-life.mjs';
import { createMirrorGapCharacter } from '../public/character.mjs';
const pulses={feed:0,mist:0,chime:0};
test('remaining food still attracts a starving fly; cleanliness and novelty cannot outrank survival',()=>{
 const s=new EmbodiedLife().state;s.needs.satiety=0;s.needs.energy=35;s.living.physiology.thirst=.1;s.living.physiology.dirt=1;
 const sources=[{id:'food',resourceId:'apple',resourceKind:'food',kind:'odor',zone:'feed',position:[0,2,0],range:5},{id:'drink',resourceId:'water-bowl',resourceKind:'water',kind:'water',zone:'feed',position:[0,2,0],range:5},{id:'screen',kind:'contrast',zone:'work',position:[0,2,0],range:5}];
 s.actor.position=[0,2,1];s.actor.contact=false;s.home.food=100;
 const rich=senseEnvironment(s,pulses,sources).signals.find(x=>x.id==='food').intensity;
 s.home.food=21;const signals=senseEnvironment(s,pulses,sources).signals;
 assert.equal(signals.find(x=>x.id==='food').intensity,rich);
 assert.ok(rich>signals.find(x=>x.id==='drink').intensity*5);
 assert.ok(rich>signals.find(x=>x.id==='screen').intensity*5);
});
test('brief foot-contact flicker cannot reset departure pressure on a curved surface',()=>{
 const s=new EmbodiedLife().state;s.actor.zoneId='rest';s.living.regions.rest.need=0;s.living.behavior='walk';
 for(let i=0;i<1200;i++){s.actor.contact=i%100<90;s.actor.position[0]+=.0001;updateSurfaceLife(s,{local:[.3,0,0]},.02);}
 s.actor.contact=true;assert.ok(surfaceRestlessness(s)>.25);
 s.actor.contact=false;for(let i=0;i<1200;i++){s.actor.position[0]+=.01;updateSurfaceLife(s,{local:[.3,0,0]},.02);}
 assert.equal(s.living.surface.contactAge,0);
});

test('all eight active regions contain at least three local cues and distinct sensing modalities',()=>{
  const zones=new Set(SURFACE_CUES.map(c=>c.zone));assert.equal(zones.size,8);
  for(const zone of zones){const cues=SURFACE_CUES.filter(c=>c.zone===zone);assert.ok(cues.length>=3);assert.ok(new Set(cues.map(c=>c.kind)).size>=3);}
});
test('habituation weakens the touched object, not every cue in the room',()=>{
  const s=new EmbodiedLife().state,c=SURFACE_CUES.find(c=>c.id==='table-grain');
  Object.assign(s.actor,{position:[...c.position],contact:true,zoneId:c.zone,velocity:[0,0,0]});
  const before=senseEnvironment(s,pulses).signals;s.living.surface.exposure[c.id]=1;
  const after=senseEnvironment(s,pulses).signals;
  assert.ok(after.find(v=>v.id===c.id).intensity<before.find(v=>v.id===c.id).intensity*.1);
  assert.equal(after.find(v=>v.id==='keys').intensity,before.find(v=>v.id==='keys').intensity);
});
test('humidity is a sensory cue without liquid contact; airborne passing does not count as walking',()=>{
  const s=new EmbodiedLife().state,c=SURFACE_CUES.find(c=>c.effect==='wet');
  Object.assign(s.actor,{position:[...c.position],contact:true,zoneId:c.zone,velocity:[0,0,0]});s.living.contactSeconds=2;
  const m={local:[0,0,0]};updateSurfaceLife(s,m,.2);assert.equal(s.living.wetness,0);assert.ok(s.living.surface.exposure[c.id]>0);assert.equal(s.actor.contactCue,c.label);
  s.actor.position[0]+=.1;s.actor.velocity[0]=.1;updateSurfaceLife(s,m,1);assert.ok(s.living.surface.stats[c.zone].walked>.09);
  const walked=s.living.surface.walked;s.actor.contact=false;s.actor.position[0]+=1;updateSurfaceLife(s,m,1);assert.equal(s.living.surface.walked,walked);
});
test('no-progress contact creates a bounded escape sensation without moving the body',()=>{
  const s=new EmbodiedLife().state;Object.assign(s.actor,{contact:true,zoneId:'perch',velocity:[0,0,0]});s.living.behavior='perch';s.living.contactSeconds=10;
  const before=[...s.actor.position];for(let i=0;i<100;i++)updateSurfaceLife(s,{local:[.5,0,0]},.1);
  assert.equal(surfaceRestlessness(s),1);assert.deepEqual(s.actor.position,before);
  s.living.contactSeconds=10;assert.equal(senseEnvironment(s,pulses).context.takeoffIntent,true);
});
test('free exploration with satisfied needs allows a quiet pause then resumes movement',()=>{
  const sim=new EmbodiedLife();Object.assign(sim.state.actor,{position:[0,.125,.75],contact:true,zoneId:'flight',mode:'activity',velocity:[0,0,0]});
  Object.assign(sim.state.needs,{energy:90,satiety:95,comfort:95,curiosity:0});
  Object.assign(sim.state.living.physiology,{thirst:.05,sleepPressure:.05,dirt:0,waste:.05});
  sim.state.living.focus.action='explore';
  sim.environmentCommand('daytime','day');let idle=0;const start=[...sim.state.actor.position];let displacement=0;
  for(let i=0;i<400;i++){sim.tick(.1);if(['idle','idle-groom'].includes(sim.state.living.behavior))idle+=.1;displacement=Math.max(displacement,Math.hypot(...sim.state.actor.position.map((v,j)=>v-start[j])));}
  assert.ok(idle>2,`idle ${idle}s`);assert.ok(displacement>.2);
});
test('old continuous brain is preserved, new activity counters start at zero and corrupted current state rejects',()=>{
  const old=new EmbodiedLife().serialize();old.version='4.4.0';delete old.living.surface;
  const sim=new EmbodiedLife(old);assert.deepEqual(sim.neural.serialize(),old.neural);assert.equal(sim.state.living.surface.walked,0);
  const bad=sim.serialize();bad.living.surface.blocked=NaN;assert.throws(()=>new EmbodiedLife(bad),/地面行为存档/);
});
test('walk pose advances with real distance and remains frozen at zero delta',()=>{
  const c=createMirrorGapCharacter(),a={contact:true,contactSeconds:3,mode:'activity',behavior:'walk',velocity:[.15,0,0]};
  c.update(a,.1);assert.equal(c.root.userData.pose.walking,true);const first=c.root.userData.pose.stride;
  c.update(a,.1);assert.ok(c.root.userData.pose.stride>first);const held=c.root.userData.pose.stride;c.update(a,0);assert.equal(c.root.userData.pose.stride,held);c.dispose();
});

test('old blocked counters cannot keep recovery active after meaningful contact',()=>{
 const s=new EmbodiedLife().state;s.actor.contact=true;s.actor.velocity=[0,0,0];s.living.behavior='drink';s.living.surface.blocked=3000;updateSurfaceLife(s,{local:[.4,0,0]},.02);assert.equal(s.living.surface.blocked,0);
});

test('airborne obstruction uses actual progress and does not treat lift as an escape',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.actor,{contact:false,position:[3.8955,.4405,.3278],heading:2.844761,velocity:[.2,0,0]});s.living.behavior='flight';
 const motor={local:[.5,.5,0]};for(let i=0;i<40;i++)updateSurfaceLife(s,motor,.1);
 assert.ok(s.living.surface.blocked>1);assert.equal(senseEnvironment(s,pulses).context.obstacle?.blocked,true);
 for(let i=0;i<40;i++){s.actor.position[1]+=.02;updateSurfaceLife(s,motor,.1);}
 assert.equal(s.living.surface.blocked,0,'real upward progress clears the counter');
});

test('recovery continues through a narrow gap until measured obstruction clears',()=>{
 const s=new EmbodiedLife().state;s.actor.contact=false;s.living.behavior='flight';s.living.surface.blocked=2;
 for(let i=0;i<40;i++){s.actor.position[0]+=.02;updateSurfaceLife(s,{local:[.5,0,0],obstacle:{blocked:true}},.1);}
 assert.ok(Math.abs(s.living.surface.blocked-6)<1e-9);
 for(let i=0;i<40;i++){s.actor.position[0]+=.02;updateSurfaceLife(s,{local:[.5,0,0],obstacle:{blocked:false}},.1);}
 assert.equal(s.living.surface.blocked,0);
});
