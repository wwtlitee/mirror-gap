import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {RESOURCE_SIGNALS} from '../public/resource-contact.mjs';
import {SIGNAL_SOURCES} from '../public/environment-spec.mjs';
import {resourceLandingTarget} from '../public/resource-landing.mjs';
import {withFoodStock} from '../public/food-stock.mjs';
import {updateNavigation} from '../public/navigation-attention.mjs';

// v8.5.0 / Unclecow. This fixture contains existing body geometry and stock only.
// A stub controller prevents construction or execution of a neural animal.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/resource-arrival-native03.json',import.meta.url),'utf8'));
const pulses={feed:0,mist:0,chime:0};
function body(){
  const controller={motor:{local:[0,0,0],drive:0},behavior:{},sensory:{signals:[],context:{}},tick(){throw Error('No neural/physics ticks in signal integration tests');}};
  const state=new EmbodiedLife(null,{controller}).state;
  Object.assign(state.actor,structuredClone(fixture.actor));
  state.companion={identity:{adoptedAt:null}};state.living.care={foods:structuredClone(fixture.foods)};state.home.food=fixture.homeFood;
  state.living.focus.action='eat';state.living.behavior='flight';state.needs.satiety=25;
  return state;
}

test('food sensation preserves its edible goal and carries the real directional arrival',()=>{
  const state=body(),source=RESOURCE_SIGNALS.find(s=>s.resourceId==='burger'),before=structuredClone(state);
  const target=withFoodStock(state,()=>resourceLandingTarget(source,state.actor.position,state.actor,{searchCache:new Map()}));
  assert.ok(target?.arrival,'the existing native geometry must expose a real directional landing');
  const signal=senseEnvironment(state,pulses,[source],{landingSearchCache:new Map()}).signals.find(s=>s.id===source.id);
  assert.deepEqual(signal.position,target.position);
  assert.deepEqual(signal.arrival,target.arrival);
  assert.deepEqual(state,before,'sampling must not modify the body, needs, stock or memory');
});

test('ordinary non-resource sensation retains its original position without an arrival',()=>{
  const state=body(),source=SIGNAL_SOURCES.find(s=>s.id==='window');
  const signal=senseEnvironment(state,pulses,[source]).signals.find(s=>s.id===source.id);
  assert.deepEqual(signal.position,source.position);assert.equal(signal.arrival,undefined);
});

test('a food without a usable landing is omitted rather than inventing a target',()=>{
  const state=body(),source={...RESOURCE_SIGNALS.find(s=>s.resourceId==='burger'),id:'resource-missing',resourceId:'missing'};
  assert.equal(senseEnvironment(state,pulses,[source]).signals.some(s=>s.id===source.id),false);
});

test('attention passes the sensed directional arrival to the persisted route without moving the body',()=>{
  const state=body(),source=RESOURCE_SIGNALS.find(s=>s.resourceId==='burger');
  const target=withFoodStock(state,()=>resourceLandingTarget(source,state.actor.position,state.actor,{searchCache:new Map()}));
  assert.ok(target?.arrival);
  const before={actor:structuredClone(state.actor),needs:structuredClone(state.needs),food:structuredClone(state.living.care.foods)};
  const signal={...source,...target,intensity:1,distance:1,regionalNeed:1};
  withFoodStock(state,()=>updateNavigation(state,[signal],.02));
  assert.deepEqual(state.living.navigation.route?.arrival,target.arrival);
  assert.deepEqual(state.living.navigation.route.goal,target.position);
  assert.deepEqual(state.actor,before.actor);assert.deepEqual(state.needs,before.needs);assert.deepEqual(state.living.care.foods,before.food);
});
