import test from 'node:test';import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {activityAvailable,updateActivityCooldowns,validateActivityCooldowns} from '../public/activity-cooldowns.mjs';
import {updateNavigation} from '../public/navigation-attention.mjs';

test('entertainment completion cannot suppress observation while comfort still needs recovery',()=>{
 const s=new EmbodiedLife().state;s.needs.curiosity=0;s.needs.comfort=25;
 updateActivityCooldowns(s);assert.equal(activityAvailable(s,'play'),false);
 assert.equal(activityAvailable(s,'observe'),true);
 s.needs.comfort=100;updateActivityCooldowns(s);assert.equal(activityAvailable(s,'observe'),false);
});
test('completed meal cools eating only; interruption is not completion; emergency bypasses',()=>{
 const sim=new EmbodiedLife(),s=sim.state;s.living.behavior='eat';s.needs.satiety=40;
 updateActivityCooldowns(s);assert.equal(activityAvailable(s,'eat'),true);
 s.living.behavior='flight';updateActivityCooldowns(s);assert.equal(activityAvailable(s,'eat'),true);
 s.living.behavior='eat';s.needs.satiety=100;updateActivityCooldowns(s);
 assert.equal(activityAvailable(s,'eat'),false);assert.equal(activityAvailable(s,'drink'),true);
 assert.equal(s.living.activityCooldowns.eat-s.simSeconds,180);
 const until=s.living.activityCooldowns.eat;s.simSeconds+=2;updateActivityCooldowns(s);assert.equal(s.living.activityCooldowns.eat,until);
 s.simSeconds=until+1;updateActivityCooldowns(s);assert.equal(activityAvailable(s,'eat'),true);
 assert.deepEqual(new EmbodiedLife(sim.serialize()).state.living.activityCooldowns,s.living.activityCooldowns);
 s.needs.satiety=19;assert.equal(activityAvailable(s,'eat'),true);
 assert.throws(()=>validateActivityCooldowns({eat:NaN}));
});
test('normal attention reviews every two seconds while urgent thirst interrupts immediately',()=>{
 const s=new EmbodiedLife().state;s.actor.contact=false;s.living.behavior='flight';
 const cue=(id,intensity)=>({id,intensity,distance:2,regionalNeed:1});
 const n=s.living.navigation;Object.assign(n,{targetId:'screen',selectedAt:0,lastProgressAt:9,nextReviewAt:10});
 s.simSeconds=9;updateNavigation(s,[cue('screen',1),cue('window',4)],.1);assert.equal(n.targetId,'screen');
 s.simSeconds=10;updateNavigation(s,[cue('screen',1),cue('window',4)],.1);assert.equal(n.targetId,'window');
 s.simSeconds=10.1;s.living.physiology.thirst=.95;
 updateNavigation(s,[cue('window',4),{...cue('water-test',1),resourceKind:'water'}],.1);
 assert.equal(n.targetId,'water-test');
});
test('drinking, sleep, toilet and cleaning require recovery before cooling down',()=>{
 for(const [behavior,action,complete,urgent] of [
  ['drink','drink',s=>s.living.physiology.thirst=0,s=>s.living.physiology.thirst=.95],
  ['rest','rest',s=>{s.needs.energy=100;s.living.sleep.elapsed=95;s.living.physiology.sleepPressure=0;},s=>s.needs.energy=10],
  ['toilet','toilet',s=>{s.living.hygiene.toiletElapsed=4;s.living.physiology.waste=0;},s=>s.living.physiology.waste=.95],
  ['groom','clean',s=>{s.living.physiology.dirt=0;s.living.wetness=0;},s=>s.living.physiology.dirt=.95]
 ]){
  const s=new EmbodiedLife().state;s.living.behavior=behavior;s.living.physiology.dirt=.6;
  updateActivityCooldowns(s);assert.equal(activityAvailable(s,action),true,action);
  complete(s);updateActivityCooldowns(s);assert.equal(activityAvailable(s,action),false,action);
  urgent(s);assert.equal(activityAvailable(s,action),true,action);
 }
});
