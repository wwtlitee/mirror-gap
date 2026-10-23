import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {sleepEligible,stationaryActivity} from '../public/behavior-policy.mjs';
import {updateLiving} from '../src/living-world.mjs';
import {regionDemand} from '../public/region-life.mjs';
import {createBehaviorFocus} from '../public/behavior-focus.mjs';
import {supportedFeet} from '../public/collision-world.mjs';
import {resolveBodyContacts} from '../public/environment-spec.mjs';
const motor={local:[0,0,0],drive:0,behavior:{grooming:1}};
test('exhaustion can recover despite hunger, then releases the bed to seek supplies',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.actor,{zoneId:'rest',contact:true});
 s.needs.energy=0;s.needs.satiety=0;s.living.physiology.thirst=1;s.living.physiology.sleepPressure=1;
 assert.equal(sleepEligible(s),true);
 s.living.sleep.active=true;s.living.sleep.elapsed=95;s.needs.energy=34;
 assert.equal(sleepEligible(s),true);
 s.needs.energy=35;assert.equal(sleepEligible(s),false);assert.equal(regionDemand(s,'rest').body,0);
 s.needs.satiety=50;s.living.physiology.thirst=.3;
 assert.ok(regionDemand(s,'rest').body>.9);assert.equal(sleepEligible(s),true);
});
test('minor fatigue never starts sleep; deep fatigue starts and hysteresis sustains it',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.actor,{zoneId:'rest',contact:true,velocity:[0,0,0]});s.living.contactSeconds=5;s.needs.energy=84;
 assert.equal(sleepEligible(s),false);updateLiving(s,motor,.1);assert.notEqual(s.living.behavior,'rest');
 s.needs.energy=47;updateLiving(s,motor,.1);assert.equal(s.living.behavior,'rest');
 s.needs.energy=80;assert.equal(sleepEligible(s),true);s.needs.energy=100;s.living.physiology.sleepPressure=0;s.living.sleep.elapsed=90;assert.equal(sleepEligible(s),false);
 s.living.behavior='perch';assert.equal(sleepEligible(s),false);
});
test('real brain holds toilet, screen attention and window observation despite initial drift',()=>{
 for(const [zone,position,expected] of [['toilet',[4.265,.6021,.54],'toilet'],['work',[-1.2,1.5131,-3.15],'play'],['garden',[3.1,1.3651,-3.75],'observe']]){
  const sim=new EmbodiedLife(),s=sim.state;Object.assign(s.actor,{position:[...position],heading:0,velocity:[.1,0,.1],contact:true,zoneId:zone,action:'observe'});
  assert.equal(supportedFeet(position,0),6,zone);
  const corrected=[...position];assert.ok(resolveBodyContacts(corrected,[0,0,0],0),zone);
  assert.ok(Math.hypot(...corrected.map((value,index)=>value-position[index]))<.003,zone);
  s.living.physiology.waste=zone==='toilet'?.9:.2;
  // This is a physical settling test for an already selected activity; demand
  // arbitration has its own tests and may otherwise legitimately choose play.
  s.living.focus={...createBehaviorFocus(s.simSeconds),action:expected};
  for(let i=0;i<80;i++)sim.tick(.1);
  const settled=[...s.actor.position];for(let i=0;i<30;i++)sim.tick(.1);
  assert.equal(s.living.behavior,expected,zone);assert.ok(Math.hypot(s.actor.position[0]-settled[0],s.actor.position[2]-settled[2])<.001,zone);
  if(zone==='garden'){assert.ok(s.actor.position[2]<-3.84,'moves to outer window edge');assert.ok(Math.abs(Math.abs(s.actor.heading)-Math.PI)<.02);s.needs.energy=25;assert.equal(stationaryActivity(s),'observe');s.living.regions.garden.observationSeconds=30;assert.equal(stationaryActivity(s),'observe');s.living.activityCooldowns={observe:s.simSeconds+180};s.living.commitment=null;assert.equal(stationaryActivity(s),null);}
  if(zone==='work')assert.ok(s.living.workstation.elapsed>2);
  s.living.alert=.6;assert.equal(stationaryActivity(s),null);
 }
});


test('depleted fly recovers on a supported floor then releases to seek water',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.actor,{zoneId:'flight',position:[0,.125,0],velocity:[0,0,0],contact:true});
 s.needs.energy=0;s.needs.satiety=45;s.living.physiology.thirst=1;
 assert.equal(stationaryActivity(s),'rest');
 for(let i=0;i<100;i++)updateLiving(s,motor,1);
 assert.ok(s.needs.energy>=34.9);assert.equal(s.actor.zoneId,'flight');
 updateLiving(s,motor,1);assert.equal(sleepEligible(s),false);
 s.needs.energy=50;s.living.sleep.active=false;assert.equal(sleepEligible(s),false);
 s.needs.energy=0;s.actor.contact=false;assert.equal(sleepEligible(s),false);
});
