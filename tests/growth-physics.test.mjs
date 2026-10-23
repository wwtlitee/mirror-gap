import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyMetrics,BASE_BODY_LENGTH} from '../public/body-metrics.mjs';
import {moveBody,resolveBodyContacts} from '../public/environment-spec.mjs';
import {supportedFeet,surfaceBelow} from '../public/collision-world.mjs';
import {resourceContact,RESOURCE_SIGNALS} from '../public/resource-contact.mjs';
import {resourceLandingPoses} from '../public/resource-landing.mjs';
import {toiletLandingPoses,toiletAligned,toiletRimStations} from '../public/toilet-contact.mjs';
import {planRoute,updateRoute} from '../public/route-planner.mjs';
import {FOOD_IDS,withFoodStock} from '../public/food-stock.mjs';
import {RESOURCE_BY_ID} from '../public/resource-spec.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createBehaviorFocus} from '../public/behavior-focus.mjs';

const stages=[{name:'newborn',scale:(.19/30)/BASE_BODY_LENGTH},{name:'mature',scale:(.19/12)/BASE_BODY_LENGTH}];

test('one scale controls world body, collision envelope, mouth and rendering while legacy actors retain dimensions',()=>{
 const original=bodyMetrics({});assert.equal(original.radius,.085);assert.equal(original.characterScale,.22);
 const newborn=bodyMetrics(stages[0].scale),mature=bodyMetrics(stages[1].scale);
 assert.ok(Math.abs(newborn.length-.19/30)<1e-12);
 for(const field of ['length','radius','characterScale','mouthReach','mouthForward'])assert.ok(Math.abs(mature[field]/newborn[field]-2.5)<1e-10,field);
 assert.equal(bodyMetrics({bodyScale:NaN}).scale,1);assert.equal(bodyMetrics(-1).scale,1);
});

for(const {name,scale} of stages){
 test(name+' collision fits a small passage and cannot tunnel through a thin wall',()=>{
  const m=bodyMetrics(scale),wall={id:'wall',zone:'work',min:[0,0,-1],max:[.001,2,1]};
  const position=[-.02,.8,0],velocity=[2,0,0];
  moveBody(position,velocity,.04,Math.PI/2,[wall],[],scale);
  assert.ok(position[0]+Math.max(...m.offsets)+m.radius<=.0000001);
  assert.equal(velocity[0],0);
  const corridor=[{id:'left',zone:'work',min:[-.02,.5,-1],max:[-.01,1,1]},{id:'right',zone:'work',min:[.01,.5,-1],max:[.02,1,1]}];
  const tiny=[0,.8,0],legacy=[...tiny];resolveBodyContacts(tiny,[0,0,0],0,corridor,[],scale);resolveBodyContacts(legacy,[0,0,0],0,corridor,[]);
  assert.deepEqual(tiny,[0,.8,0]);assert.notDeepEqual(legacy,tiny);
 });

 test(name+' has physically supported mouth contact for every food, including the last remaining portion',()=>{
  for(const amount of [100,12.5]){
   const state={companion:{},home:{food:amount},living:{care:{foods:Object.fromEntries(FOOD_IDS.map(id=>[id,amount]))}}};
   withFoodStock(state,()=>{
    for(const id of FOOD_IDS){
     const poses=resourceLandingPoses(id,scale);assert.ok(poses.length>0,id+' '+amount);
     const pose=poses[0];assert.ok(supportedFeet(pose.position,pose.heading,pose)>=3,id);
     assert.equal(resourceContact(pose,'food')?.id,id);
     assert.equal(resourceContact({...pose,contact:false},'food'),null,'hovering does not feed');
     const corrected=[...pose.position];resolveBodyContacts(corrected,[0,0,0],pose.heading,undefined,undefined,pose);
     assert.ok(Math.hypot(...corrected.map((v,i)=>v-pose.position[i]))<bodyMetrics(pose).tolerance*2,id+' steady contact');
    }
   });
  }
 });

 test(name+' drinks at the actual water surface and six feet stay above the basin floor',()=>{
  for(const source of RESOURCE_SIGNALS.filter(source=>source.resourceKind==='water')){
   const pose=resourceLandingPoses(source.resourceId,scale)[0];assert.ok(pose,source.resourceId);
   const surfaceY=RESOURCE_BY_ID[source.resourceId].position[1],position=[...pose.position];
   for(let i=0;i<100;i++)moveBody(position,[0,-.03,0],.02,pose.heading,undefined,undefined,pose);
   assert.ok(position[1]>surfaceY,source.resourceId+' did not sink');
   assert.equal(supportedFeet(position,pose.heading,pose),6);
   assert.equal(resourceContact({...pose,position},'water')?.id,source.resourceId);
   assert.ok(surfaceBelow(position[0],position[1],position[2],.02,pose).position[1]>=surfaceY-1e-7);
  }
 });

 test(name+' maintains a real toilet stance under repeated gravity and routes to it',()=>{
  const pose=toiletLandingPoses(scale)[0];assert.ok(pose);
  const actor={...pose,position:[...pose.position],zoneId:'toilet',contact:true};
  for(let i=0;i<200;i++)moveBody(actor.position,[0,-.03,0],.02,actor.heading,undefined,undefined,actor);
  assert.ok(supportedFeet(actor.position,actor.heading,actor)>=4);
  assert.ok(toiletAligned(actor));
  assert.equal(toiletAligned({...actor,contact:false}),false);
  assert.equal(planRoute({position:[3.7,.45,.4],heading:0,bodyScale:scale},actor.position).status,'ready');
 });
}

test('route checkpoints replan when growth changes body clearance and do not declare millimetre goals reached early',()=>{
 const actor={position:[0,.5,0],heading:0,bodyScale:stages[0].scale},goal=[0,.5,.02];
 const young=updateRoute(actor,'test',goal,null,1);assert.equal(young.status,'ready');
 const adult=updateRoute({...actor,bodyScale:stages[1].scale},'test',goal,young,2);
 assert.equal(adult.plannedAt,2);assert.equal(adult.bodyScale,stages[1].scale);
});

for(const {name,scale} of stages)for(const activity of ['eat','drink','toilet']){
 test(name+' completes and exits '+activity+' through live contact and metabolism',()=>{
  // This isolates physical/metabolic completion from navigation: only neural
  // motor/feeding onset is stubbed; physics, focus, stock and cooldowns are real.
  const controller={motor:{local:[0,0,0],drive:0},behavior:{feeding:1,grooming:0},sensory:{context:{},signals:[]},tick(){}};
  const sim=new EmbodiedLife(null,{controller}),s=sim.state;
  const pose=activity==='toilet'?toiletLandingPoses(scale)[0]:resourceLandingPoses(activity==='eat'?'apple':'water-bowl',scale)[0];
  Object.assign(s.actor,structuredClone(pose),{bodyScale:scale,velocity:[0,0,0],zoneId:activity==='toilet'?'toilet':'feed',contact:true});
  Object.assign(s.needs,{energy:90,satiety:activity==='eat'?54:90});
  Object.assign(s.living.physiology,{thirst:activity==='drink'?.5:.1,waste:activity==='toilet'?.8:.1,dirt:.1,sleepPressure:.1});
  s.living.focus={...createBehaviorFocus(s.simSeconds),action:activity};s.living.contactSeconds=3;
  const food=s.home.food,water=s.home.water;let completed=false;
  for(let i=0;i<8000;i++){
   sim.tick(.02);
   if(s.living.activityCooldowns?.[activity]>s.simSeconds){completed=true;break;}
  }
  assert.ok(completed,'must reach completion threshold');assert.ok(s.actor.contact);assert.equal(s.living.escape.attempts,0);
  if(activity==='eat'){assert.ok(s.needs.satiety>=99.5);assert.ok(s.stats.ateSeconds>=69);assert.ok(s.home.food<food);}
  if(activity==='drink'){assert.ok(s.living.physiology.thirst<=.0051);assert.ok(s.home.water<water);}
  if(activity==='toilet'){assert.equal(s.living.hygiene.bowelMovements,1);assert.ok(s.living.physiology.waste<.005);}
  const eating=s.stats.ateSeconds;sim.tick(.3);
  assert.notEqual(s.living.behavior,activity,'completed activity releases its hold');
  if(activity==='eat')assert.equal(s.stats.ateSeconds,eating);
 });
}

test('the final supported rim step is retained when it first becomes a valid toilet pose',()=>{
 const scale=stages[0].scale,controller={motor:{local:[0,0,0],drive:0},behavior:{feeding:0,grooming:0},sensory:{context:{},signals:[]},tick(){}};
 const sim=new EmbodiedLife(null,{controller}),s=sim.state;
 const station=toiletRimStations(scale)[0];
 Object.assign(s.actor,{position:[station.position[0],station.position[1],station.position[2]-.00035],heading:station.walkHeading,bodyScale:scale,velocity:[0,0,0],contact:true,zoneId:'toilet',supportFeet:6});
 Object.assign(s.needs,{energy:90,satiety:90});Object.assign(s.living.physiology,{waste:.8,thirst:.1,dirt:.1,sleepPressure:.1});
 s.living.focus={...createBehaviorFocus(s.simSeconds),action:'toilet'};
 for(let i=0;i<1000&&!s.living.activityCooldowns?.toilet;i++)sim.tick(.02);
 assert.ok(s.living.activityCooldowns?.toilet>s.simSeconds,'the successful boundary crossing must not be mistaken for solver drift');
 assert.equal(s.living.escape.attempts,0);assert.ok(toiletAligned(s.actor));
});

for(const {name,scale} of stages)for(const activity of ['eat','drink','toilet']){
 test(name+' real neural motor approaches a nearby '+activity+' surface and performs the activity',()=>{
  const sim=new EmbodiedLife(),s=sim.state;
  const pose=activity==='toilet'?toiletLandingPoses(scale)[0]:resourceLandingPoses(activity==='eat'?'apple':'water-bowl',scale)[0];
  Object.assign(s.actor,structuredClone(pose),{bodyScale:scale,position:[pose.position[0]+.015,pose.position[1]+.07,pose.position[2]+.015],velocity:[0,0,0],zoneId:activity==='toilet'?'toilet':'feed',contact:false});
  Object.assign(s.needs,{energy:90,satiety:activity==='eat'?20:90});
  Object.assign(s.living.physiology,{thirst:activity==='drink'?.8:.1,waste:activity==='toilet'?.8:.1,dirt:.1,sleepPressure:.1});
  s.living.focus={...createBehaviorFocus(s.simSeconds),action:activity};
  const complete=()=>activity==='eat'?s.stats.ateSeconds>3:activity==='drink'?s.living.physiology.thirst<.7:s.living.activityCooldowns?.toilet>s.simSeconds;
  for(let i=0;i<1000&&!complete();i++)sim.tick(.1);
  assert.ok(complete(),JSON.stringify({position:s.actor.position,contact:s.actor.contact,behavior:s.living.behavior,route:s.living.navigation.route}));
  assert.ok(s.actor.contact);assert.equal(s.living.escape.attempts,0);
  if(activity==='toilet'){assert.ok(s.living.physiology.waste<=.0051);assert.equal(s.living.hygiene.bowelMovements,1);sim.tick(.3);assert.notEqual(s.living.behavior,'toilet');}
 });
}
