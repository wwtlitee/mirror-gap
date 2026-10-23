import test from 'node:test';import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';import {stationaryActivity} from '../public/behavior-policy.mjs';import {updateLiving} from '../src/living-world.mjs';import {senseEnvironment} from '../src/neural-controller.mjs';
const motor={local:[0,0,0],drive:.3,behavior:{grooming:0}};
function dirty(){const s=new EmbodiedLife().state;Object.assign(s.actor,{position:[0,.125,0],contact:true,zoneId:'flight',velocity:[.08,0,0],groomingDrive:.5});Object.assign(s.needs,{energy:65,satiety:60});Object.assign(s.living.physiology,{dirt:1,thirst:.2,waste:.2,sleepPressure:.2});s.living.contactSeconds=3;return s;}
test('one grooming trigger stops movement and sustains a complete cleaning bout',()=>{const s=dirty();assert.equal(stationaryActivity(s),'groom');s.actor.velocity=[0,0,0];updateLiving(s,{...motor,behavior:{grooming:.5}},.02);assert.equal(s.living.behavior,'groom');s.actor.groomingDrive=0;for(let i=0;i<290;i++){assert.equal(stationaryActivity(s),'groom');updateLiving(s,motor,.02);}assert.ok(s.living.physiology.dirt<.91);assert.equal(stationaryActivity(s),'groom');for(let i=0;i<3000;i++){s.simSeconds+=.02;updateLiving(s,motor,.02);}assert.ok(s.living.activityCooldowns.clean>s.simSeconds);assert.notEqual(stationaryActivity(s),'groom');});
test('danger, urgent thirst and escape preempt grooming',()=>{for(const change of [s=>s.living.alert=.8,s=>s.living.physiology.thirst=.95,s=>s.living.escape.phase='burst']){const s=dirty();s.living.behavior='groom';change(s);assert.notEqual(stationaryActivity(s),'groom');}});
test('trapped descent does not silence obstacle sensing or keep low landing arousal',()=>{const s=new EmbodiedLife().state;Object.assign(s.actor,{position:[-1.2,1,-3.1],contact:false,velocity:[0,0,0]});s.living.escape.phase='trapped';s.living.surface.blocked=0;const sensed=senseEnvironment(s,{feed:0,mist:0,chime:0});assert.notEqual(sensed.context.holdReason,'approach');assert.ok(sensed.context.obstacle||sensed.context.surfaceApproach);assert.ok(sensed.context.arousal>.06);});
test('grooming suppresses conflicting propulsion while preserving real contact',()=>{
 const controller={motor:{local:[0,.5,1],drive:1},behavior:{grooming:.5,feeding:0},sensory:{context:{takeoffIntent:true},signals:[]},tick(){}};
 const sim=new EmbodiedLife(null,{controller}),s=sim.state;Object.assign(s.actor,{position:[0,.125,0],contact:true,zoneId:'flight',velocity:[0,0,0]});Object.assign(s.needs,{energy:65,satiety:60});Object.assign(s.living.physiology,{dirt:1,thirst:.2,waste:.2,sleepPressure:.2});s.living.contactSeconds=3;
 for(let i=0;i<200;i++)sim.tick(.02);
 assert.equal(s.living.behavior,'groom');assert.ok(Math.hypot(s.actor.position[0],s.actor.position[2])<.005);assert.ok(s.actor.contact);assert.ok(s.living.physiology.dirt<.94);
});

test('water-bowl humidity cannot keep a clean fly grooming forever',()=>{
 const s=dirty();Object.assign(s.actor,{position:[-2.6443240718665257,1.2121,.6120570302210889],velocity:[0,0,0],zoneId:'feed',action:'observe'});s.living.behavior='groom';s.living.physiology.dirt=0;s.living.wetness=.081681645;
 s.living.commitment={action:'clean',resourceId:null,startedAt:s.simSeconds,lastProgressAt:s.simSeconds,bestScore:91.8};
 for(let i=0;i<1000;i++){s.simSeconds+=.02;updateLiving(s,motor,.02);}
 assert.ok(s.living.wetness<.005);assert.notEqual(s.living.behavior,'groom');assert.ok(s.living.activityCooldowns.clean>s.simSeconds);
});
