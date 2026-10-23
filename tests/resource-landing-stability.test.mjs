import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyMetrics,BASE_BODY_LENGTH} from '../public/body-metrics.mjs';
import {moveBody,resolveBodyContacts} from '../public/environment-spec.mjs';
import {resourceContact,nearestResource} from '../public/resource-contact.mjs';
import {supportedFeet} from '../public/collision-world.mjs';
import {resourceLandingPoses,stableResourceLandingPose} from '../public/resource-landing.mjs';
import {FOOD_IDS,withFoodStock} from '../public/food-stock.mjs';

test('a statically supported curved apple shoulder cannot be returned as a sustained feeding stance',()=>{
 const pose={position:[-3.1139593368944527,1.2493964061526643,1.4785503778730833],heading:Math.PI/2,bodyScale:.0193,contact:true};
 assert.ok(supportedFeet(pose.position,pose.heading,pose)>=3);
 assert.equal(resourceContact(pose,'food')?.id,'apple');
 const original=structuredClone(pose);
 assert.equal(stableResourceLandingPose(pose,'food','apple'),null);
 assert.deepEqual(pose,original,'the probe must never mutate its live actor input');
 assert.equal(stableResourceLandingPose({...pose,position:[NaN,0,0]},'food','apple'),null);
});

for(const [name,scale]of [['newborn',(.19/30)/BASE_BODY_LENGTH],['mature',(.19/12)/BASE_BODY_LENGTH]]){
 test(name+' selected apple stance keeps physical feet and mouth contact under ten seconds of turning and gravity',()=>{
  const selected=resourceLandingPoses('apple',scale)[0];assert.ok(selected);
  const pose=structuredClone(selected),initial=[...pose.position],m=bodyMetrics(pose),velocity=[0,0,0];
  for(let tick=0;tick<500;tick++){
   const target=nearestResource(pose.position,'food',{id:'apple'});assert.ok(target);
   const dx=target.point[0]-pose.position[0],dz=target.point[2]-pose.position[2],heading=Math.atan2(dx,dz);
   const turn=Math.atan2(Math.sin(heading-pose.heading),Math.cos(heading-pose.heading));
   if(Math.hypot(dx,dz)>.005*m.scale&&Math.abs(turn)>.01)pose.heading+=Math.max(-.04,Math.min(.04,turn));
   velocity[0]=velocity[2]=0;velocity[1]=(velocity[1]-.04)*Math.exp(-.14);
   const support=moveBody(pose.position,velocity,.02,pose.heading,undefined,undefined,pose);
   resolveBodyContacts(pose.position,velocity,pose.heading,undefined,undefined,pose);
   assert.ok(support);assert.ok(supportedFeet(pose.position,pose.heading,pose)>=3);
   assert.equal(resourceContact(pose,'food')?.id,'apple');
  }
  assert.ok(Math.hypot(...pose.position.map((v,i)=>v-initial[i]))<m.radius*.5);
 });
}

test('cached landing geometry is reused until food portion or body scale changes',()=>{
 const state={companion:{},home:{food:100},living:{care:{foods:Object.fromEntries(FOOD_IDS.map(id=>[id,100]))}}};
 withFoodStock(state,()=>{
  const full=resourceLandingPoses('apple',.0193);assert.ok(full.length);
  assert.equal(resourceLandingPoses('apple',.0193),full);
  assert.notEqual(resourceLandingPoses('apple',.0483),full);
  state.living.care.foods.apple=12.5;
  const last=resourceLandingPoses('apple',.0193);assert.ok(last.length);
  assert.notEqual(last,full);assert.equal(resourceLandingPoses('apple',.0193),last);
  assert.equal(resourceContact(last[0],'food')?.id,'apple');
 });
});
