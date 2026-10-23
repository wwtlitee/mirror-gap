import test from 'node:test';import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {updateCommitment,committedTo,validateCommitment} from '../public/activity-commitment.mjs';
import {createBehaviorFocus,updateBehaviorFocus} from '../public/behavior-focus.mjs';
import {needScore} from '../public/need-display.mjs';
import {updateLiving} from '../src/living-world.mjs';
const motor={local:[0,0,0],drive:0,behavior:{grooming:1}};
test('an unfinished meal survives transient signals and ends at full score',()=>{
 const s=new EmbodiedLife().state;s.actor.contact=true;s.actor.consumingResource={id:'fries',kind:'food'};s.needs.satiety=54;s.living.behavior='eat';updateCommitment(s);
 assert.ok(committedTo(s,'eat'));
 s.simSeconds+=1;s.living.behavior='flight';s.actor.contact=false;updateCommitment(s);assert.ok(committedTo(s,'eat'));
 s.needs.satiety=60;s.simSeconds+=2;updateCommitment(s);validateCommitment(s.living.commitment);assert.ok(committedTo(s,'eat'));
 s.needs.satiety=100;updateCommitment(s);assert.equal(s.living.commitment,null);
});
test('a genuine failed reach and danger release commitment without declaring completion',()=>{
 const s=new EmbodiedLife().state;s.actor.contact=true;s.actor.consumingResource={id:'fries',kind:'food'};s.needs.satiety=54;s.living.behavior='eat';updateCommitment(s);
 s.simSeconds+=13;s.actor.contact=false;s.living.behavior='flight';updateCommitment(s);
 assert.equal(s.living.commitment,null);assert.ok(s.living.navigation.failedUntil['resource:fries']>s.simSeconds);assert.equal(s.living.activityCooldowns?.eat,undefined);
 s.actor.contact=true;s.living.behavior='rest';updateCommitment(s);s.living.alert=.9;updateCommitment(s);assert.equal(s.living.commitment,null);
});

test('real washing remains productive while wetness rises, then finishes only when clean and dry',()=>{
 const s=new EmbodiedLife().state;
 Object.assign(s.actor,{position:[4.5,.385,3.1],heading:0,contact:true,velocity:[0,0,0],zoneId:'entry',action:'observe'});
 s.living.contactSeconds=5;s.living.focus={...createBehaviorFocus(s.simSeconds),action:'clean'};
 s.needs.energy=75;s.needs.satiety=85;
 Object.assign(s.living.physiology,{dirt:.9,thirst:.05,waste:.2,sleepPressure:.2});
 for(let i=0;i<249;i++){s.simSeconds+=.1;updateLiving(s,motor,.1);}
 assert.equal(s.living.behavior,'bathe');
 assert.ok(s.living.physiology.dirt<.3&&s.living.wetness>.65);
 assert.ok(committedTo(s,'clean'));
 assert.equal(s.living.activityRetryUntil?.clean,undefined);
 assert.ok(s.simSeconds-s.living.commitment.lastProgressAt<.11);
 let finished=false;
 for(let i=0;i<800;i++){
  s.simSeconds+=.1;updateLiving(s,motor,.1);
  assert.equal(s.living.activityRetryUntil?.clean,undefined);
  if(!s.living.commitment){
   assert.equal(needScore(s,'dirt'),100);assert.equal(needScore(s,'wetness'),100);
   finished=true;break;
  }
 }
 assert.ok(finished,'real washing and drying must eventually satisfy both meters');
});

test('old commitments acquire bounded metric history without inventing progress',()=>{
 const s=new EmbodiedLife().state;s.actor.contact=true;s.living.behavior='groom';
 s.living.commitment={action:'clean',resourceId:null,startedAt:0,lastProgressAt:0,bestScore:50};
 s.living.physiology.dirt=.5;s.living.wetness=.2;
 validateCommitment(s.living.commitment);s.simSeconds=1;updateCommitment(s);
 assert.deepEqual(s.living.commitment.perMetricScores,{dirt:50,wetness:80});
 assert.equal(s.living.commitment.lastProgressAt,0);
 const valid=structuredClone(s.living.commitment);
 for(const perMetricScores of [{dirt:NaN,wetness:80},{dirt:101,wetness:80},{dirt:50},{dirt:50,wetness:80,energy:50},null]){
  assert.throws(()=>validateCommitment({...valid,perMetricScores}));
 }
 s.simSeconds=13;updateCommitment(s);
 assert.equal(s.living.commitment,null);
 assert.equal(s.living.activityRetryUntil.clean,33);
});

test('a resumed observation stays the goal while stronger needs wait',()=>{
 const s=new EmbodiedLife().state;
 Object.assign(s.actor,{position:[3.1,1.3651,-3.85],heading:Math.PI,contact:true,velocity:[0,0,0],zoneId:'garden',action:'observe'});
 s.living.contactSeconds=5;s.living.focus={...createBehaviorFocus(s.simSeconds),action:'observe'};
 s.living.regions.garden.observationSeconds=29.95;s.living.commitment=null;
 s.needs.comfort=50;s.needs.energy=75;s.needs.satiety=75;
 Object.assign(s.living.physiology,{thirst:.1,waste:.2,sleepPressure:.2});
 s.simSeconds+=.1;updateLiving(s,motor,.1);updateBehaviorFocus(s,[],.1);
 assert.equal(s.living.behavior,'observe');assert.equal(s.living.focus.action,'observe');
 assert.ok((s.living.regions.garden.observationUntil??0)<=s.simSeconds);
 assert.ok(s.needs.comfort>50&&s.needs.comfort<100);
 s.living.alert=.6;updateLiving(s,motor,.1);assert.equal(s.living.behavior,'startle');
 s.living.alert=0;s.needs.satiety=0;
 for(let i=0;i<7;i++){s.simSeconds+=.1;updateBehaviorFocus(s,[],.1);}
 assert.equal(s.living.focus.action,'observe');
 assert.equal(s.living.focus.candidate,'eat');
});

 test('simultaneous hunger thirst and waste cannot independently veto the authorized meal',()=>{
 const s=new EmbodiedLife().state;s.living.focus={...createBehaviorFocus(),action:'eat'};
 s.actor.contact=true;s.actor.consumingResource={id:'fries',kind:'food'};s.living.behavior='eat';
 s.needs.satiety=0;s.needs.energy=35;s.living.physiology.thirst=1;s.living.physiology.waste=1;
 updateCommitment(s);assert.ok(committedTo(s,'eat'));
 for(let i=0;i<60;i++){s.simSeconds+=1;s.needs.satiety+=.65;updateCommitment(s);assert.ok(committedTo(s,'eat'));}
 s.living.focus.action='drink';updateCommitment(s);assert.equal(s.living.commitment,null);
 });
