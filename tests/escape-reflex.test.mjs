import test from 'node:test';import assert from 'node:assert/strict';
import {createEscape,validateEscape,updateEscape,escapeDirection} from '../public/escape-reflex.mjs';
import {needScore} from '../public/need-display.mjs';
const fixture=()=>({actor:{position:[0,2,0],heading:0,contact:false},living:{escape:createEscape(),alert:0,behavior:'flight'}});
const motor={local:[.4,.1,.6],drive:.6};
function run(s,seconds,hold=null,move=()=>{}){for(let i=0;i<seconds*50;i++){move(i);updateEscape(s,motor,hold,.02);}}
test('small oscillations count as confinement and drain safety before a burst',()=>{const s=fixture();run(s,5);assert.equal(s.living.escape.stress,0);run(s,15,null,i=>s.actor.position[0]=Math.sin(i)*.04);assert.equal(s.living.escape.phase,'burst');assert.equal(needScore(s,'alert'),0);assert.equal(s.living.escape.attempts,1);});
test('normal sleep, observation and games never trigger',()=>{for(const hold of ['rest','screen','observe']){const s=fixture();s.actor.contact=true;run(s,100,hold);assert.equal(s.living.escape.attempts,0);assert.equal(s.living.escape.stress,0);}});
test('productive feeding and drinking are safe; failed alignment eventually triggers',()=>{for(const behavior of ['eat','drink','toilet','groom','bathe']){const s=fixture();s.actor.contact=true;s.living.behavior=behavior;run(s,30,'feed');assert.equal(s.living.escape.attempts,0);}const s=fixture();run(s,25,'feed');assert.ok(s.living.escape.attempts>0);});
test('no motor intent is not a failed movement, including disconnected brain',()=>{const s=fixture();for(let i=0;i<4000;i++)updateEscape(s,{local:[0,0,0],drive:0},null,.02);assert.equal(s.living.escape.stress,0);});
test('sustained travel remains calm',()=>{const s=fixture();run(s,90,null,i=>s.actor.position[0]=i*.004);assert.equal(s.living.escape.attempts,0);});
test('escape requires leaving the anchor and sustained clearance, then recovers',()=>{const s=fixture();run(s,20);assert.equal(s.living.escape.phase,'burst');s.actor.position[0]=1;run(s,.4);assert.equal(s.living.escape.phase,'burst');run(s,.4);assert.equal(s.living.escape.phase,'recover');assert.equal(s.living.escape.escapes,1);s.actor.contact=true;s.living.behavior='rest';run(s,16,'rest');assert.equal(needScore(s,'alert'),100);});
test('checkpoint validation rejects NaN; clone continuation is deterministic',()=>{const s=fixture();run(s,13);const clone=structuredClone(s);validateEscape(clone.living.escape);run(s,8);run(clone,8);assert.deepEqual(clone,s);clone.living.escape.direction[0]=NaN;assert.throws(()=>validateEscape(clone.living.escape));});
test('clearance probe is finite and does not move the real actor',()=>{const s=fixture(),before=structuredClone(s.actor);const d=escapeDirection(s.actor,1);assert.ok(d.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...d)-1)<1e-9);assert.deepEqual(s.actor,before);});
test('environmental alarm and confinement combine without erasing either source',()=>{const s=fixture();s.living.alert=.8;s.living.escape.stress=.3;assert.equal(needScore(s,'alert'),20);s.living.escape.stress=1;assert.equal(needScore(s,'alert'),0);});
import {EmbodiedLife} from '../src/embodied-life.mjs';
test('physical wall confinement phases out without crossing room bounds',()=>{
 const controller={motor:{local:[0,0,1],drive:.6},sensory:{context:{},signals:[]},behavior:{},tick(){}};
 const sim=new EmbodiedLife(null,{controller});Object.assign(sim.state.actor,{position:[-5.70,2,0],velocity:[0,0,0],heading:-Math.PI/2,contact:false});sim.state.needs.energy=100;
 let burst=false,maxStep=0,previous=sim.state.actor.position.slice();
 for(let i=0;i<1800;i++){sim.tick(.02);const p=sim.state.actor.position;maxStep=Math.max(maxStep,Math.hypot(...p.map((x,j)=>x-previous[j])));previous=p.slice();burst ||=sim.state.living.escape.attempts>0;assert.ok(p[0]>=-5.72&&p[0]<=5.72);}
 assert.ok(burst);assert.ok(sim.state.living.escape.escapes>0);assert.ok(maxStep<.15,`unexpected discontinuity ${maxStep}`);
});
test('a JSON checkpoint during a burst retains sensory attention and reflex timing',()=>{
 const sim=new EmbodiedLife();sim.tick(.5);sim.state.living.escape.phase='burst';sim.state.living.escape.stress=1;sim.state.living.escape.anchor=[...sim.state.actor.position];sim.state.living.escape.attempts=1;
 const copy=new EmbodiedLife(JSON.parse(JSON.stringify(sim.serialize())));for(let i=0;i<15;i++){sim.tick(.02);copy.tick(.02);}assert.deepEqual(copy.serialize(),sim.serialize());
});


import {escapeClear,moveEscapeBody} from '../public/escape-reflex.mjs';
for(const position of [[-4,.6,1],[-1.2,1,-3.5],[-5.5,1.2,2.4]])test(`zero-energy phasing leaves enclosed furniture at ${position}`,()=>{
 const controller={motor:{local:[0,0,0],drive:0},sensory:{context:{},signals:[]},behavior:{},tick(){}};
 const sim=new EmbodiedLife(null,{controller}),s=sim.state;
 Object.assign(s.actor,{position:[...position],velocity:[0,0,0],contact:false});s.needs.energy=0;s.needs.satiety=0;s.living.physiology.thirst=1;
 Object.assign(s.living.escape,{phase:'burst',stress:1,anchor:[...position],attempts:1});
 let maxStep=0;for(let i=0;i<600&&s.living.escape.escapes===0;i++){const before=[...s.actor.position];sim.tick(.02);maxStep=Math.max(maxStep,Math.hypot(...s.actor.position.map((v,j)=>v-before[j])));}
 assert.equal(s.living.escape.escapes,1);assert.ok(escapeClear(s.actor.position));assert.equal(s.living.escape.phase,'recover');assert.ok(maxStep<.12,`step ${maxStep}`);
});
test('phasing keeps room bounds, and timeout never re-enables collisions inside furniture',()=>{
 const p=[5.59,.41,4.07],v=[3,-3,3];moveEscapeBody(p,v,1);assert.ok(p[0]<=5.6&&p[1]>=.4&&p[2]<=4.08);
 const s=fixture();s.actor.position=[-4,.6,1];Object.assign(s.living.escape,{phase:'burst',stress:1,anchor:[-4,.6,1],burstTime:4.99});updateEscape(s,motor,null,.02);assert.equal(s.living.escape.phase,'burst');
});
