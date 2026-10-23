import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeObservation} from '../src/life-observation.mjs';
import {NEED_METERS} from '../public/need-display.mjs';
import {navigationBrake} from '../public/navigation-brake.mjs';
const sample=(second,score,behavior='drink')=>({wallMs:second*1000,simSeconds:second,version:'test',position:[0,1,0],paused:false,behavior,focus:'drink',scores:Object.fromEntries(Object.keys(NEED_METERS).map(k=>[k,k==='thirst'?score:100])),bowelMovements:0,escape:{attempts:0,escapes:0},neuralAvailable:true,neuralMs:2});
test('observation distinguishes initial full scores from recovery, decline and another cycle',()=>{
 const report=analyzeObservation([sample(0,60),sample(1,100),sample(2,90),sample(3,100)]);
 assert.equal(report.metrics.thirst.fullRecoveries,2);assert.equal(report.metrics.thirst.declinedAfterFull,true);
 assert.equal(report.metrics.energy.fullRecoveries,0);assert.equal(report.behaviors.drink,3);
 assert.equal(report.behaviors.rest,undefined);assert.throws(()=>analyzeObservation([]),/No observation/);
});
test('observation reports persistent nonproductive confinement without counting rest as stuck',()=>{
 const bad=analyzeObservation([sample(0,10,'flight'),sample(30,10,'flight')]);assert.ok(bad.issues.includes('nonproductive-confinement-over-20s'));
 const rest=analyzeObservation([sample(0,10,'rest'),sample(30,30,'rest')]);assert.equal(rest.maxNonproductiveConfinementSeconds,0);
});
test('approach braking only reduces thrust and adds damping, without replacing direction',()=>{
 const route={status:'ready',index:0,waypoints:[[0,1,0]]};
 const near=navigationBrake({position:[.1,1,0],contact:false},route);
 assert.ok(near.thrust>=0&&near.thrust<1&&near.drag>0);
 assert.deepEqual(navigationBrake({position:[2,1,0],contact:false},route),{thrust:1,drag:0});
 assert.deepEqual(navigationBrake({position:[.1,1,0],contact:true},route),{thrust:1,drag:0});
});

test('completion cooldown proves a full score reached between samples without double counting',()=>{
 const a=sample(0,60),b=sample(1,99),c=sample(2,100);a.activityCooldowns={drink:0};b.activityCooldowns={drink:180.8};c.activityCooldowns={drink:180.8};
 const report=analyzeObservation([a,b,c]);assert.equal(report.metrics.thirst.fullRecoveries,1);assert.equal(report.completionEvents.length,1);
});
