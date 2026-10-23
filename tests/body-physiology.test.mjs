import { FOOD_TOP, FOOD_PROPS } from '../public/habitat-layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbodiedLife } from '../src/embodied-life.mjs';
import { senseEnvironment } from '../src/neural-controller.mjs';
import { updateLiving } from '../src/living-world.mjs';
import { moveBody, resolveBodyContacts, BODY_OFFSETS, BODY_RADIUS, waterContact } from '../public/environment-spec.mjs';
const pulses={feed:0,mist:0,chime:0},motor={local:[0,0,0],drive:0,behavior:{grooming:1}};
const inside=(p,s)=>p.every((v,i)=>v>s.min[i]-BODY_RADIUS+1e-6&&v<s.max[i]+BODY_RADIUS-1e-6);

test('swept compound body stops head/tail at a thin wall at multiple headings',()=>{
 const wall={id:'thin',zone:'flight',min:[-.02,.1,-2],max:[.02,3,2]};
 for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const p=[-1,1,0],v=[2.5,0,.2];moveBody(p,v,1,heading,[wall],[]);
  assert.ok(p[0]<-.02);assert.equal(v[0],0);
  for(const offset of BODY_OFFSETS)assert.equal(inside([p[0]+Math.sin(heading)*offset,p[1],p[2]+Math.cos(heading)*offset],wall),false);
 }
});

test('rotating beside a wall resolves body envelope and feet remain on support',()=>{
 const solids=[{id:'floor',zone:'flight',min:[-2,-.1,-2],max:[2,.04,2]}, {id:'wall',zone:'flight',min:[0,0,-2],max:[.1,2,2]}];
 const p=[-.09,.125,0];resolveBodyContacts(p,[0,0,0],Math.PI/2,solids,[]);
 assert.ok(p[0]<-.174);assert.ok(Math.abs(p[1]-.125)<1e-8);
});

test('both water sources require physical vertical contact and thirst declines only there',()=>{
 for(const position of [[4.5,.405,3.1],[FOOD_PROPS.water.x,FOOD_TOP+.102+BODY_RADIUS,FOOD_PROPS.water.z]]){
  const s=new EmbodiedLife().state;Object.assign(s.actor,{position,contact:true,zoneId:position[0]>0?'entry':'feed',velocity:[0,0,0],action:'observe'});
  s.living.physiology.thirst=.8;assert.ok(waterContact(s.actor));const before=s.home.water;
  updateLiving(s,motor,1);assert.equal(s.living.behavior,'drink');assert.ok(s.living.physiology.thirst<.8);assert.ok(s.home.water<before);
  const t=s.living.physiology.thirst;s.actor.position[1]+=1;updateLiving(s,motor,1);assert.ok(s.living.physiology.thirst>t);assert.notEqual(s.living.behavior,'drink');
 }
});

test('thirst strengthens water sense, water contact stimulates real taste cells, mist does not hydrate',()=>{
 const sim=new EmbodiedLife(),s=sim.state;s.living.physiology.thirst=.1;
 const dry=senseEnvironment(s,pulses).signals.find(v=>v.id==='water').intensity;s.living.physiology.thirst=.9;
 assert.ok(senseEnvironment(s,pulses).signals.find(v=>v.id==='water').intensity>dry*2);
 Object.assign(s.actor,{position:[4.5,.405,3.1],contact:true,zoneId:'entry'});sim.neural.tick(s,.1);
 assert.ok(sim.neural.sensory.inputs[5]>.6);assert.ok(sim.neural.metrics.snapshot(sim.neural.sensory.inputs).inputs[5].hz>0);
 const t=s.living.physiology.thirst;sim.interact('mist');assert.equal(s.living.physiology.thirst,t);
});

test('sleep pressure recovers at rest, thirst interrupts game, neural grooming removes dirt',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.actor,{contact:true,zoneId:'rest',velocity:[0,0,0],action:'rest'});
 s.needs.energy=100;s.living.physiology.sleepPressure=.8;s.living.contactSeconds=9;
 assert.equal(senseEnvironment(s,pulses).context.holdReason,'recovery');updateLiving(s,motor,1);assert.ok(s.living.physiology.sleepPressure<.8);
 const game=new EmbodiedLife().state;
 Object.assign(game.actor,{contact:true,velocity:[0,0,0],zoneId:'work',position:[-1.2,1.405,-3.15],action:'reflect'});game.living.workstation.phase='playing';game.living.physiology.thirst=.9;
 updateLiving(game,motor,.1);assert.equal(game.living.workstation.phase,'resting');
 // Grooming is an independent healthy fixture; urgent thirst must still block it.
 const groom=new EmbodiedLife().state;
 Object.assign(groom.actor,{contact:true,velocity:[0,0,0],zoneId:'flight',position:[0,.125,0],action:'observe',groomingDrive:1});groom.living.contactSeconds=3;groom.living.physiology.dirt=.8;
 updateLiving(groom,motor,1);assert.equal(groom.living.behavior,'groom');assert.ok(groom.living.physiology.dirt<.8);
});

test('4.1 checkpoint adds physiology without resetting neural state; corrupt current values reject',()=>{
 const sim=new EmbodiedLife();sim.tick(.3);const old=sim.serialize();old.version='4.1.0';delete old.living.physiology;
 const next=new EmbodiedLife(old);
 // Full body saves own weight-only memory; compare every original neural
 // field and the separately stored weights instead of dropping either check.
 const {synapticMemory,...restoredMotorBrain}=next.neural.serialize();
 assert.deepEqual(restoredMotorBrain,old.neural);assert.deepEqual(synapticMemory,old.synapticMemory);
 assert.deepEqual(next.state.needs,old.needs);assert.equal(next.state.living.physiology.thirst,.28);
 const saved=next.serialize();saved.living.physiology.thirst=NaN;assert.throws(()=>new EmbodiedLife(saved),/存档无效/);
});


test('real brain drinks at the water surface without hovering at the rim height',()=>{
 const sim=new EmbodiedLife();Object.assign(sim.state.actor,{position:[FOOD_PROPS.water.x,FOOD_TOP+.102+BODY_RADIUS,FOOD_PROPS.water.z],heading:0,velocity:[0,0,0],contact:true,zoneId:'feed',mode:'activity',action:'observe'});
 sim.state.living.physiology.thirst=.8;for(let i=0;i<250;i++)sim.tick(.1);
 assert.ok(sim.state.living.physiology.thirst<.4);assert.equal(sim.state.living.behavior,'drink');
 assert.ok(Math.abs(sim.state.actor.position[1]-(FOOD_TOP+.102+BODY_RADIUS))<.002);
});
