import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {CalmFollow,angleDifference} from '../public/calm-follow.mjs';import{landingReadiness}from '../public/environment-spec.mjs';import{createMirrorGapCharacter}from '../public/character.mjs';import{EmbodiedLife}from '../src/embodied-life.mjs';import{updateLiving}from '../src/living-world.mjs';
test('calm follow rejects oscillating turns and caps sustained pan at 20 degrees/s',()=>{
 const c=new CalmFollow();c.reset(0);let max=0;
 for(let i=0;i<600;i++){const before=c.heading;c.update({contact:false,velocity:[i%12<6?1:-1,0,1]},1/60);max=Math.max(max,Math.abs(c.heading));assert.ok(Math.abs(angleDifference(c.heading,before))<=.35/60+1e-9);}
 assert.ok(max<.08);for(let i=0;i<240;i++)c.update({contact:false,velocity:[1,0,0]},1/60);assert.ok(c.heading>.4&&c.heading<1.3);
 const held=c.heading;for(let i=0;i<120;i++)c.update({contact:true,heading:Math.PI,velocity:[.1,0,0]},1/60);assert.equal(c.heading,held);
});
test('descending far from a surface never extends feet, approaching floor does',()=>{
 assert.equal(landingReadiness({position:[0,3,0],velocity:[0,-1,0],contact:false},[],[]),0);
 assert.ok(landingReadiness({position:[0,.15,0],velocity:[0,-.5,0],contact:false},[],[])>.5);
 assert.equal(landingReadiness({position:[0,.15,0],velocity:[0,.5,0],contact:false},[],[]),0);
});
test('flight pose actually tucks front/middle feet inward and trails hind feet, freezes paused',()=>{
 const c=createMirrorGapCharacter(),feet=()=>{c.root.updateMatrixWorld(true);const out=[];c.root.traverse(o=>{if(o.userData.footLocal)out.push(new THREE.Vector3(...o.userData.footLocal).applyMatrix4(o.matrixWorld));});return out;};
 const spread=feet();for(let i=0;i<120;i++)c.update({position:[0,3,0],velocity:[0,-.3,1],contact:false,mode:'travel'},1/60);
 const tucked=feet();for(const i of [0,1,3,4])assert.ok(Math.abs(tucked[i].x)<Math.abs(spread[i].x)*.6,`${i}: ${tucked[i].x}/${spread[i].x}`);
 assert.ok(tucked[2].z<-.4&&tucked[5].z<-.4);assert.ok(c.root.userData.pose.legTuck>.99);
 const before=feet().map(v=>v.toArray());c.update({contact:true},0);assert.deepEqual(feet().map(v=>v.toArray()),before);c.dispose();
});
test('finished drinking does not chatter around 8 percent; moving fly cannot groom',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.actor,{position:[4.5,.405,3.1],contact:true,zoneId:'entry',velocity:[0,0,0],action:'observe'});s.living.physiology.thirst=.081;s.living.behavior='drink';
 const m={local:[0,0,0],behavior:{grooming:1}};for(let i=0;i<100;i++)updateLiving(s,m,.1);assert.notEqual(s.living.behavior,'drink');assert.ok(s.living.physiology.thirst<.1);
 s.actor.position=[0,.125,0];s.actor.zoneId='flight';s.actor.velocity=[.2,0,0];s.living.physiology.dirt=.8;s.living.contactSeconds=10;updateLiving(s,m,.1);assert.notEqual(s.living.behavior,'groom');
});


test('a brief surface graze does not announce walking or unfold the flight pose',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.actor,{position:[0,.125,0],velocity:[.2,0,0],contact:true,zoneId:'flight',mode:'activity',action:'rest'});
 updateLiving(s,{local:[0,0,0]},.02);assert.equal(s.living.behavior,'flight');
 const c=createMirrorGapCharacter();for(let i=0;i<120;i++)c.update({contact:false,mode:'travel',position:[0,3,0],velocity:[0,0,1]},1/60);
 c.update({...s.actor,contactSeconds:.02},.02);assert.ok(c.root.userData.pose.flying);assert.ok(c.root.userData.pose.legTuck>.9);c.dispose();
});
