import test from 'node:test';
import assert from 'node:assert/strict';
import {selectResourceArrival} from '../public/resource-arrival.mjs';

test('a validated landing yaw produces a clear lead-in before the real edible goal',()=>{
  const actor={position:[1,1,1],heading:0,bodyScale:.025};
  const pose={position:[0,1,0],heading:Math.PI/2,bodyScale:.025};
  const before=structuredClone({actor,pose});
  const segmentClear=(from,to,yaw)=>to===pose.position?Math.abs(yaw-Math.PI/2)<1e-6:true;
  const target=selectResourceArrival([pose],actor,{segmentClear});
  assert.deepEqual(target.position,pose.position);assert.equal(target.arrival.heading,pose.heading);
  assert.ok(target.arrival.via[0]<-.12);assert.ok(target.arrival.via[1]>pose.position[1]);
  assert.deepEqual({actor,pose},before);
});

test('a direct stable approach keeps the existing coordinate target',()=>{
  const actor={position:[0,1,-1],heading:0,bodyScale:.025},pose={position:[0,1,0],heading:0,bodyScale:.025};
  assert.deepEqual(selectResourceArrival([pose],actor,{segmentClear:()=>true}),{position:[0,1,0],arrival:null});
});

test('an unsafe turn area cannot be reported as a valid final connector',()=>{
  const actor={position:[1,1,1],heading:0,bodyScale:.025},pose={position:[0,1,0],heading:Math.PI/2,bodyScale:.025};
  const segmentClear=(from,to,yaw)=>from===to?yaw===0:to!==pose.position||yaw===pose.heading;
  assert.deepEqual(selectResourceArrival([pose],actor,{segmentClear}),{position:pose.position,arrival:null});
});

test('empty candidates return null and returned coordinates do not own cached poses',()=>{
  const actor={position:[0,1,-1],heading:0,bodyScale:.025},pose={position:[0,1,0],heading:0,bodyScale:.025};
  assert.equal(selectResourceArrival([],actor),null);
  const target=selectResourceArrival([pose],actor,{segmentClear:()=>true});target.position[0]=99;
  assert.equal(pose.position[0],0);
});
