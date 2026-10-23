import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {FunctionalController,NEURAL_FRAME_SECONDS} from '../src/functional-controller.mjs';
import {RuntimeClock} from '../src/runtime-clock.mjs';
import {motorFeedbackInterval} from '../public/neural-cadence.mjs';

const fixture=()=>{const s=new EmbodiedLife().state;s.living.clock={mode:'preview',hour:12,anchor:0};return s;};
test('five slices preserve the exact full neural readout and all checkpoint state',()=>{
 const state=fixture(),whole=new FunctionalController(),sliced=new FunctionalController();
 for(let frame=0;frame<4;frame++){
  whole.tick(state,NEURAL_FRAME_SECONDS);
  for(let i=0;i<5;i++)sliced.advanceSlice(state,80,NEURAL_FRAME_SECONDS);
  assert.deepEqual(sliced.serialize(),whole.serialize());
 }
});
test('a partial neural frame survives save/load including spikes, delays and RNG',()=>{
 const state=fixture(),a=new FunctionalController();a.advanceSlice(state,80,1);a.advanceSlice(state,80,1);
 const saved=a.serialize();assert.equal(saved.pending.steps,160);
 const b=new FunctionalController({saved});
 for(let i=0;i<3;i++){a.advanceSlice(state,80,1);b.advanceSlice(state,80,1);}
 assert.deepEqual(b.serialize(),a.serialize());
 const corrupt=structuredClone(saved);corrupt.pending.spikes=[999999];assert.throws(()=>new FunctionalController({saved:corrupt}),/pending neural/);
});
test('one decision per second retains 50 Hz body steps and pauses partial computation',()=>{
 const s=new EmbodiedLife();s.neural.brain.disconnect();s.state.living.clock={mode:'preview',hour:12,anchor:0};
 Object.assign(s.state.needs,{energy:95,satiety:95,curiosity:5,comfort:95});
 Object.assign(s.state.living.physiology,{thirst:.05,sleepPressure:.05,dirt:.05,waste:.05});
 s.state.actor.position=[0,3,0];s.tick(3.1);
 assert.equal(s.neural.brain.step,1200);assert.ok(Math.abs(s.state.simSeconds-3.1)<1e-8);
 assert.equal(s.neural.snapshot().timeScale,.04);
 // Landing may now introduce an intentional idle pause and change feedback cadence.
 // Pause a real in-progress frame rather than assuming an exact landing timestamp.
 for(let i=0;i<60&&!s.neural.pending;i++)s.tick(.02);
 const before=s.neural.serialize();assert.ok(before.pending);
 s.setPaused(true);s.tick(2);assert.deepEqual(s.neural.serialize(),before);
});
test('precision feedback accelerates near a waypoint, then returns to low frequency during real consumption',()=>{
 const s=fixture();s.actor.position=[0,2,0];s.actor.contact=false;s.living.behavior='flight';
 s.living.navigation.route={status:'ready',index:0,waypoints:[[4,2,0]]};assert.equal(motorFeedbackInterval(s),1);
 s.living.navigation.route.waypoints=[[.5,2,0]];assert.equal(motorFeedbackInterval(s),.1);
 s.actor.contact=true;s.living.behavior='drink';assert.equal(motorFeedbackInterval(s),1);
});
test('runtime catch-up yields after one expensive step and caps suspension debt',()=>{
 let now=0;const calls=[],sim={state:{paused:false},tick(dt){calls.push(dt);now+=24;}};
 const clock=new RuntimeClock(sim,{now:()=>now,budgetMs:8});clock.advance(.18);
 assert.deepEqual(calls,[.02]);assert.ok(Math.abs(clock.debt-.16)<1e-8);
 clock.advance(60);assert.equal(calls.length,2);assert.ok(clock.debt<=.25);assert.ok(clock.droppedSeconds>59);
 sim.state.paused=true;clock.advance(.1);assert.equal(clock.debt,0);
});
