import test from 'node:test';
import assert from 'node:assert/strict';
import {insideHabitatGround,resolveHabitatGround} from '../public/habitat-ground.mjs';
import {resolveBodyContacts,moveBody,BODY_RADIUS} from '../public/environment-spec.mjs';
import {meshClearance,supportedFeet} from '../public/collision-world.mjs';
import {planRoute} from '../public/route-planner.mjs';

test('actual underground position exits the solid soil and permits a route again',()=>{
 const p=[3.198372417248112,.1251,2.789204963285469],v=[0,0,0];
 assert.ok(insideHabitatGround(p));assert.equal(meshClearance(p).distance,0);
 assert.equal(planRoute({position:p,heading:0},[0,1,0]).status,'unreachable');
 resolveBodyContacts(p,v,0);assert.ok(p[1]>=.385);assert.equal(insideHabitatGround(p),null);assert.ok(supportedFeet(p,0)>=3);
 assert.equal(planRoute({position:p,heading:0},[0,1,0]).status,'ready');
});
test('falling and crossing both slab seams cannot enter the closed ground volume',()=>{
 for(const z of [2.29,2.3,2.31,2.789]){const p=[3.2,.65,z],v=[0,-2.5,0];for(let i=0;i<100;i++){v[1]=-.5;moveBody(p,v,.02,.8);assert.equal(insideHabitatGround(p),null);assert.ok(p[1]>=.385);}}
});
test('solid ground does not fill empty space outside the real tray or move an airborne body',()=>{
 for(const initial of [[0,.1251,0],[2.5,.1251,2.7],[3.2,1,2.7]]){const p=[...initial],v=[.1,0,0];resolveHabitatGround(p,v,BODY_RADIUS);assert.deepEqual(p,initial);assert.deepEqual(v,[.1,0,0]);}
});

test('walking into the tray edge never puts any body sphere inside the solid',()=>{
 for(const heading of [0,.7,1.6,3]){const p=[2.35,.1251,2.7],v=[1.5,0,0];for(let i=0;i<100;i++){v[0]=1.5;v[1]=-.2;moveBody(p,v,.02,heading);for(const offset of [-.105,0,.09])assert.equal(insideHabitatGround([p[0]+Math.sin(heading)*offset,p[1],p[2]+Math.cos(heading)*offset]),null);}}
});
