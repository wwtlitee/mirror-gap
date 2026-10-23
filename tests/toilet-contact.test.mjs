import test from 'node:test';
import assert from 'node:assert/strict';
import {toiletLandingPoses,toiletLandingPoint,toiletPose,toiletAdjustment,toiletAligned} from '../public/toilet-contact.mjs';
import {resolveBodyContacts} from '../public/environment-spec.mjs';
import {supportedFeet} from '../public/collision-world.mjs';
import {planRoute} from '../public/route-planner.mjs';

test('toilet navigation chooses supported rim poses instead of the rounded front scent position',()=>{
 const poses=toiletLandingPoses();assert.ok(poses.length>=2);
 for(const pose of poses){const position=[...pose.position];resolveBodyContacts(position,[0,0,0],pose.heading);assert.ok(Math.hypot(...position.map((v,i)=>v-pose.position[i]))<.003);assert.ok(supportedFeet(position,pose.heading)>=4);assert.ok(toiletAligned({...pose,contact:true,zoneId:'toilet'}));}
 const point=toiletLandingPoint([3.7,.45,.4]);assert.ok(poses.some(p=>p.position===point));assert.notDeepEqual(point,[4.08,.66,.38]);
 assert.equal(planRoute({position:[3.7,.45,.4],heading:0},point).status,'ready');
});
test('a reachable rim stance permits alignment while air and invalid actors cannot eliminate',()=>{
 const actor={position:[4.265,.6021,.54],heading:1,contact:true,zoneId:'toilet'};
 assert.ok(toiletPose(actor));assert.ok(toiletAdjustment(actor));assert.equal(toiletAligned(actor),false);actor.heading=toiletAdjustment(actor).heading;assert.equal(toiletAligned(actor),true);
 assert.equal(toiletPose({...actor,contact:false,supportFeet:0}),null);assert.equal(toiletPose({...actor,position:[NaN,.6,.5]}),null);assert.equal(toiletAligned(null),false);assert.equal(toiletLandingPoint([NaN,0,0]),null);
});
test('invalid fixture positions do not become alleged local foot paths through a basin wall',()=>{
 const actor={position:[4.52,.615,.58],heading:0,contact:true,zoneId:'toilet'},before=structuredClone(actor);
 assert.equal(toiletAdjustment(actor),null);assert.deepEqual(actor,before);
});
test('millimetres of supported progress and a neighbouring mesh zone do not cancel rim adjustment',()=>{
 const actor={position:[3.961350448506359,.68506075565003,.4263531643427385],heading:-.04,contact:true,supportFeet:6,zoneId:'perch'};
 assert.equal(supportedFeet(actor.position,actor.heading),6);
 assert.equal(toiletPose(actor),null,'an adjacent ledge is not a valid elimination location');
 const adjustment=toiletAdjustment(actor);assert.ok(adjustment?.position);
 assert.deepEqual(toiletAdjustment(structuredClone(actor)),adjustment);
 assert.equal(toiletAdjustment({...actor,contact:false,supportFeet:0}),null);
 assert.equal(toiletAdjustment({...actor,position:[actor.position[0],.3851,actor.position[2]]}),null);
});
