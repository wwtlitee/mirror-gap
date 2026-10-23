import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrowth,ensureGrowth,validateGrowth,growthSummary,stepGrowth,applyGrowthSize,GROWTH_SECONDS,NEWBORN_LENGTH,MATURE_LENGTH} from '../public/companion-growth.mjs';
const fixture=()=>({paused:false,actor:{},stats:{ateSeconds:0,restedSeconds:0},companion:{identity:{adoptedAt:1},activeSeconds:0,growth:createGrowth()}});
function advance(s,seconds,nutrition=0,rest=0){s.companion.activeSeconds+=seconds;stepGrowth(s,seconds,{nutrition,rest});}
test('tiny adoption and adult proportions have a fixed world reference',()=>{
  const s=fixture();applyGrowthSize(s);assert.equal(growthSummary(s.companion).length,NEWBORN_LENGTH);
  advance(s,GROWTH_SECONDS,180,600);
  const g=growthSummary(s.companion);assert.equal(g.stage,'mature');assert.ok(Math.abs(g.length-MATURE_LENGTH)<1e-12);assert.equal(g.relativeSize,2.5);
  assert.ok(s.actor.bodyScale<.05);validateGrowth(s.companion.growth,s.companion.activeSeconds);
});
test('time, replenishment or absence alone cannot grow a pet',()=>{
  const s=fixture();advance(s,3600);assert.equal(s.companion.growth.progress,0);
  s.home={food:100,water:100};advance(s,60);assert.equal(s.companion.growth.progress,0);
  const before=structuredClone(s.companion.growth);s.paused=true;stepGrowth(s,3600,{nutrition:3600,rest:3600});assert.deepEqual(s.companion.growth,before);
});
test('actual nourishment and rest cause smooth monotonic growth without shrinkage',()=>{
  const s=fixture();advance(s,600,30,60);const initial=growthSummary(s.companion);
  assert.ok(initial.progress>0);assert.ok(initial.relativeSize>1&&initial.relativeSize<2.5);
  advance(s,1800);assert.ok(s.companion.growth.progress>=initial.progress);
  const before=s.companion.growth.progress;advance(s,1,1,1);assert.ok(s.companion.growth.progress-before<=1/GROWTH_SECONDS+1e-12);
});
test('old identity life time never fabricates historic nutrition or growth',()=>{
  const c={activeSeconds:999999,identity:{name:'原来的我'},learning:{food:{apple:{score:.5}}}};ensureGrowth(c);
  assert.equal(c.growth.startedAt,999999);assert.equal(c.growth.progress,0);assert.equal(c.learning.food.apple.score,.5);
  const recovered=JSON.parse(JSON.stringify(c));validateGrowth(recovered.growth,recovered.activeSeconds);assert.deepEqual(growthSummary(c),growthSummary(recovered));
});
test('malformed, non-finite and impossible growth is rejected',()=>{
  for(const patch of [{progress:2},{nutrition:1},{elapsed:Infinity},{startedAt:-1},{progress:.5}])assert.throws(()=>validateGrowth({...createGrowth(),...patch},0));
});
