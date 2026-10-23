import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {updateNavigation,validateNavigation} from '../public/navigation-attention.mjs';
import {topSurfaceApproach} from '../public/environment-spec.mjs';
import {stationaryActivity} from '../public/behavior-policy.mjs';
const cue=(id,intensity,distance=2)=>({id,intensity,distance,regionalNeed:1});
test('attention resists alternating scores and retires a target without progress',()=>{
 const s=new EmbodiedLife().state;s.actor.contact=false;s.living.behavior='flight';
 updateNavigation(s,[cue('screen',1),cue('window',.9)],.1);
 for(let i=1;i<150;i++){s.simSeconds=i*.1;updateNavigation(s,[cue('screen',i%2?1:.95),cue('window',i%2?.95:1)],.1);assert.equal(s.living.navigation.targetId,'screen');}
 s.simSeconds=19;updateNavigation(s,[cue('screen',1),cue('window',.9)],.1);
 assert.equal(s.living.navigation.targetId,'window');assert.ok(s.living.navigation.failedUntil.screen>19);
 validateNavigation(s.living.navigation);
});
test('rise phase is retained through tabletop clearance and then crosses the edge',()=>{
 const a={position:[-1.2,1,-2.5],contact:false};let phase=topSurfaceApproach(a);assert.equal(phase.phase,'rise');
 a.position[1]=1.45;phase=topSurfaceApproach(a,phase);assert.equal(phase.phase,'rise');
 a.position[1]=phase.top+.05;phase=topSurfaceApproach(a,phase);assert.equal(phase.phase,'cross-edge');assert.ok(phase.direction[2]<0);
 a.position[2]=-3.2;assert.equal(topSurfaceApproach(a,phase),null);
});
test('food hold without consumption times out and survives save/load as a bounded retry',()=>{
 const sim=new EmbodiedLife(),s=sim.state;Object.assign(s.actor,{position:[-3.2651195682448235,1.338958690640381,1.6400589796435747],heading:1.8665471203125215,contact:true,action:'observe',zoneId:'feed'});s.needs.satiety=54;
 assert.equal(stationaryActivity(s),'feed');
 for(let i=0;i<42;i++){s.simSeconds+=.1;updateNavigation(s,[],.1);}
 assert.notEqual(stationaryActivity(s),'feed');assert.ok(Object.keys(s.living.navigation.failedUntil).some(k=>k.startsWith('resource:')));
 const copy=new EmbodiedLife(sim.serialize());assert.deepEqual(copy.state.living.navigation,s.living.navigation);
 s.simSeconds+=21;updateNavigation(s,[],.1);assert.equal(stationaryActivity(s),'feed');
});

test('synaptic foraging preserves the four-second no-consumption timeout during focused eating',()=>{
 const sim=new EmbodiedLife(),s=sim.state;
 Object.assign(s.actor,{position:[-3.2651195682448235,1.338958690640381,1.6400589796435747],heading:1.8665471203125215,contact:true,action:'observe',zoneId:'feed'});
 s.needs.satiety=54;s.living.focus.action='eat';s.synapticForaging=true;
 assert.equal(stationaryActivity(s),'feed');
 for(let i=0;i<42;i++){s.simSeconds+=.1;updateNavigation(s,[],.1);}
 assert.equal(stationaryActivity(s),null,'unproductive contact must release its hold');
 assert.ok(Object.entries(s.living.navigation.failedUntil).some(([id,until])=>id.startsWith('resource:')&&until>s.simSeconds));
 assert.equal(s.living.navigation.targetId,null);assert.equal(s.living.navigation.route,null);
 const copy=new EmbodiedLife(sim.serialize());assert.deepEqual(copy.state.living.navigation,s.living.navigation);
 s.simSeconds+=21;updateNavigation(s,[],.1);assert.equal(stationaryActivity(s),'feed');
});

test('two second evidence rejects an impulse, accepts sustained intent and urgent thirst',()=>{
 const s=new EmbodiedLife().state;s.actor.contact=false;s.living.behavior='flight';s.needs.energy=70;s.living.physiology.waste=.1;
 for(let i=0;i<80;i++){s.simSeconds=i*.1;updateNavigation(s,[cue('screen',1),cue('window',.3)],.1);}
 s.simSeconds=8;updateNavigation(s,[cue('screen',1),cue('window',4)],.1);assert.equal(s.living.navigation.targetId,'screen');
 for(let i=81;i<130;i++){s.simSeconds=i*.1;updateNavigation(s,[cue('screen',1),cue('window',3)],.1);}
 assert.equal(s.living.navigation.targetId,'window');
 s.living.physiology.thirst=.95;s.simSeconds+=.1;updateNavigation(s,[cue('window',3),{...cue('resource:water-bowl',.5),resourceId:'water-bowl',resourceKind:'water'}],.1);
 assert.equal(s.living.navigation.targetId,'resource:water-bowl');validateNavigation(s.living.navigation);
});

test('escape retires its failed attraction and does not immediately reacquire it',()=>{
 const s=new EmbodiedLife().state;s.living.behavior='flight';s.actor.contact=false;
 updateNavigation(s,[cue('high-perch',3),cue('window',1)],.1);assert.equal(s.living.navigation.targetId,'high-perch');
 s.simSeconds=1;s.living.escape.phase='burst';updateNavigation(s,[cue('high-perch',3)],.1);assert.equal(s.living.navigation.targetId,null);assert.equal(s.living.navigation.failedUntil['high-perch'],31);
 s.simSeconds=3;s.living.escape.phase='recover';updateNavigation(s,[cue('high-perch',3),cue('window',1)],.1);assert.equal(s.living.navigation.targetId,'window');
 const copy=new EmbodiedLife({...new EmbodiedLife().serialize(),living:s.living});assert.equal(copy.state.living.navigation.failedUntil['high-perch'],31);
 s.simSeconds=32;updateNavigation(s,[cue('high-perch',3)],.1);assert.equal(s.living.navigation.targetId,'high-perch');
});

test('a focused food destination ignores stronger competing food until real failure',()=>{
 const s=new EmbodiedLife().state;s.synapticForaging=false;
 s.actor.contact=false;s.living.behavior='flight';s.living.focus.action='eat';
 const foods=(a,b)=>[{...cue('food-a',a),resourceId:'a',resourceKind:'food'},{...cue('food-b',b),resourceId:'b',resourceKind:'food'}];
 updateNavigation(s,foods(2,1),1);assert.equal(s.living.navigation.targetId,'food-a');
 for(let i=1;i<=17;i++){s.simSeconds=i;updateNavigation(s,foods(1,100),1);assert.equal(s.living.navigation.targetId,'food-a');}
 s.simSeconds=19;updateNavigation(s,foods(1,100),1);assert.equal(s.living.navigation.targetId,'food-b');assert.equal(s.living.focus.action,'eat');
});
