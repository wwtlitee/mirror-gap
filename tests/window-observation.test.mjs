import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {updateRegions} from '../public/region-life.mjs';
import {stationaryActivity} from '../public/behavior-policy.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
test('brief takeoffs cannot renew observation; cooldown suppresses window cues and survives save',()=>{
 const sim=new EmbodiedLife(),s=sim.state;
 Object.assign(s.actor,{position:[3.1,1.3651,-3.86],contact:true,zoneId:'garden',velocity:[0,0,0]});
 s.living.contactSeconds=3;
 for(let i=0;i<30;i++){
  s.actor.contact=true;s.living.behavior='observe';s.simSeconds++;updateRegions(s,1);
  s.actor.contact=false;s.living.behavior='flight';s.simSeconds+=.1;updateRegions(s,.1);
 }
 s.actor.contact=true;
 assert.equal(stationaryActivity(s),null);
 assert.equal(s.living.regions.garden.observationSeconds,30);
 assert.ok(s.living.regions.garden.observationUntil>s.simSeconds);
 const restored=new EmbodiedLife(sim.serialize()).state;
 assert.equal(stationaryActivity(restored),null);
 assert.ok(!senseEnvironment(restored,{feed:0,mist:0,chime:0}).signals.some(v=>v.zone==='garden'));
 s.simSeconds=s.living.regions.garden.observationUntil+1;s.living.behavior='perch';updateRegions(s,.1);
 assert.equal(stationaryActivity(s),'observe');
});
