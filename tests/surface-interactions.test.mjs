import {supportedFeet} from '../public/collision-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {toiletPose,toiletAligned,TOILET_BASIN} from '../public/toilet-contact.mjs';
import {topSurfaceApproach} from '../public/environment-spec.mjs';
import {updateBodyNeeds} from '../public/body-needs.mjs';
import {updateSurfaceLife} from '../public/surface-life.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';

test('specific food exposure weakens only that food, recovers, and survives save/load',()=>{
 const sim=new EmbodiedLife(),s=sim.state;s.needs.satiety=25;s.actor.contact=false;
 const pulses={feed:0,mist:0,chime:0},read=()=>senseEnvironment(s,pulses).signals.filter(v=>v.resourceKind==='food');
 const before=read();s.actor.consumingResource={kind:'food',id:'apple'};
 for(let i=0;i<60;i++)updateSurfaceLife(s,{local:[0,0,0]},1);
 const after=read();for(const signal of after){const original=before.find(v=>v.id===signal.id);if(signal.resourceId==='apple')assert.ok(signal.intensity<original.intensity*.2);else assert.equal(signal.intensity,original.intensity);}
 const saved=sim.serialize();assert.equal(new EmbodiedLife(saved).state.living.surface.exposure['food:apple'],1);
 s.actor.consumingResource=null;updateSurfaceLife(s,{local:[0,0,0]},100);assert.ok(s.living.surface.exposure['food:apple']<1);
});

test('wrong-facing toilet stance cannot excrete before turning rear over the bowl',()=>{
 const sim=new EmbodiedLife(),s=sim.state;
 Object.assign(s.actor,{position:[4.04,.615,.32],heading:Math.atan2(4.04-4.265,.32-.38)+.4,contact:true,zoneId:'toilet',velocity:[0,0,0]});
 s.living.physiology.waste=.9;
 assert.equal(toiletAligned(s.actor),false);
 updateBodyNeeds(s,{toileting:true},1);assert.equal(s.living.hygiene.toiletElapsed,0);
 for(let i=0;i<800;i++)sim.tick(.02);
 assert.ok(s.living.hygiene.bowelMovements>0);assert.ok(toiletAligned(s.actor));
 const drop=s.living.hygiene.lastDropPosition;
 assert.ok(Math.abs(drop[0]-TOILET_BASIN.x)<=TOILET_BASIN.halfX);
 assert.ok(Math.abs(drop[2]-TOILET_BASIN.z)<=TOILET_BASIN.halfZ);
 assert.equal(toiletPose({...s.actor,position:[4.65,.615,.38]}),null);
});

for(const [id,position] of [['window',[3.1,.98,-3.5]],['desk',[-1.2,1.05,-3.3]]]){
 test(`${id}: real neural movement escapes below furniture and clears its top`,()=>{
  const sim=new EmbodiedLife();Object.assign(sim.state.actor,{position:[...position],velocity:[0,0,0],contact:false,zoneId:id==='desk'?'work':'garden'});
  const initial=[...sim.state.actor.position],cue=topSurfaceApproach(sim.state.actor);
  assert.equal(cue.phase,'clear-edge');assert.deepEqual(sim.state.actor.position,initial);
  let clear=false,maxDisplacement=0;for(let i=0;i<200;i++){sim.tick(.1);const a=sim.state.actor;if(a.position[1]>=cue.top||(a.contact&&a.zoneId==='work'&&a.position[1]>initial[1]+.2&&supportedFeet(a.position,a.heading)>=3))clear=true;maxDisplacement=Math.max(maxDisplacement,Math.hypot(...sim.state.actor.position.map((v,j)=>v-initial[j])));}
  assert.ok(clear);assert.ok(maxDisplacement>.5);assert.ok(sim.state.actor.position[1]>initial[1]+.2);
 });
}


test('hovering over a useful tabletop starts landing without waiting for downward velocity',()=>{
 const sim=new EmbodiedLife(),s=sim.state;
 Object.assign(s.actor,{position:[-1.2,1.68,-3.15],velocity:[0,0,0],contact:false,zoneId:'work'});
 s.needs.curiosity=100;s.needs.energy=80;s.needs.satiety=70;
 assert.equal(topSurfaceApproach(s.actor),null);
 assert.equal(senseEnvironment(s,{feed:0,mist:0,chime:0}).context.holdReason,'approach');
 for(let i=0;i<150;i++)sim.tick(.1);
 assert.equal(s.actor.contact,true);assert.equal(s.living.workstation.phase,'playing');
 assert.ok(s.needs.curiosity<99);
});


test('off-centre toilet contact shuffles on the fixture before excreting',()=>{
 const sim=new EmbodiedLife(),s=sim.state;
 Object.assign(s.actor,{position:[4.52,.615,.58],heading:0,contact:true,zoneId:'toilet',velocity:[0,0,0]});
 s.living.physiology.waste=.9;
 assert.equal(toiletPose(s.actor),null);
 for(let i=0;i<180;i++)sim.tick(.1);
 assert.ok(s.living.hygiene.bowelMovements>0);
 const drop=s.living.hygiene.lastDropPosition;
 assert.ok(Math.abs(drop[0]-TOILET_BASIN.x)<=TOILET_BASIN.halfX);
 assert.ok(Math.abs(drop[2]-TOILET_BASIN.z)<=TOILET_BASIN.halfZ);
});
