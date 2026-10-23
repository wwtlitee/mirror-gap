import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOD_PROPS, PERCH_POST, PERCH_PLATFORMS, GARDEN_RINGS } from '../public/habitat-layout.mjs';
import { SOLIDS, SIGNAL_SOURCES, moveBody, applyContactFriction, signalOccluded } from '../public/environment-spec.mjs';
import { skyState } from '../public/sky-clock.mjs';
import { daylightState } from '../src/living-world.mjs';
import { EmbodiedLife } from '../src/embodied-life.mjs';

test('food vessels have clear space and the drinking bowl is outside the shelf footprint',()=>{
  const props=Object.values(FOOD_PROPS);
  for(let i=0;i<props.length;i++)for(let j=i+1;j<props.length;j++){
    const a=props[i],b=props[j];assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>a.radius+b.radius+.08);
  }
  const water=SIGNAL_SOURCES.find(s=>s.id==='drinking-bowl');
  const shelf=SOLIDS.find(s=>s.id==='nook-shelf-1');
  assert.ok(FOOD_PROPS.water.x-FOOD_PROPS.water.radius>shelf.max[0]);
  assert.equal(signalOccluded([water.position[0],2,water.position[2]],water.position),false);
});

test('contact friction holds weak residual drift while walking and takeoff remain possible',()=>{
  const v=[.012,0,-.01];applyContactFriction(v,[.2,-.2,.1],.02,true);assert.deepEqual(v,[0,0,0]);
  const walking=[.3,0,.1];applyContactFriction(walking,[1,0,0],.02,true);assert.ok(walking[0]>.29);
  const launch=[.01,.1,.02];applyContactFriction(launch,[0,1,0],.02,true);assert.deepEqual(launch,[.01,.1,.02]);
  const air=[.01,0,.02];applyContactFriction(air,[0,0,0],.02,false);assert.deepEqual(air,[.01,0,.02]);
});

test('local daylight follows wall time, cycle and preview remain deterministic',()=>{
  const sim=new EmbodiedLife();const state=sim.state;
  state.living.clock={mode:'local',anchor:0,hour:3};state.simSeconds=900000;
  assert.equal(daylightState(state,new Date(2026,8,20,12,0,0)).hour,12);
  assert.equal(daylightState(state,new Date(2026,8,20,23,0,0)).daylight,0);
  state.living.clock={mode:'preview',anchor:0,hour:18};assert.equal(daylightState(state).hour,18);
  state.living.clock={mode:'cycle',anchor:state.simSeconds,hour:6};state.simSeconds+=60;assert.equal(daylightState(state).hour,7);
});

test('sun and moon rise, cross the sky and set on opposite arcs',()=>{
  const dawn=skyState(6),noon=skyState(12),dusk=skyState(18),night=skyState(0);
  assert.ok(dawn.sun[0]<noon.sun[0] && noon.sun[0]<dusk.sun[0]);
  assert.ok(noon.sun[1]>dawn.sun[1]+10);assert.ok(noon.sunVisible&&!noon.moonVisible);
  assert.ok(night.moonVisible&&!night.sunVisible);assert.equal(night.daylight,0);
  assert.deepEqual(skyState(24),night);
});
