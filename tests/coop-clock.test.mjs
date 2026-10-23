import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCircuit,TAPEOUT_PULSE_SOURCE} from '../public/tapeout-circuit.mjs';
import {COOP_CLOCK_SECONDS,createCoopClock,restoreCoopClock,advanceCoopClock} from '../public/coop-clock.mjs';
const circuit=parseCircuit(TAPEOUT_PULSE_SOURCE);

test('every steady clock phase overlaps at least two of five natural food reward windows',()=>{
 const phaseCount=Math.round(3*COOP_CLOCK_SECONDS/.02);let phase=createCoopClock();
 for(let i=0;i<phaseCount;i++)phase=advanceCoopClock(phase,.02,circuit);
 let minimum=5;
 for(let initial=0;initial<phaseCount;initial++){
  let state=structuredClone(phase),windows=new Set();
  for(let tick=0;tick<613;tick++){
   state=advanceCoopClock(state,.02,circuit);
   const teacher=Math.floor(tick/150),within=tick%150;
   if(teacher<5&&within<12&&state.pulseOutput===1)windows.add(teacher);
  }
  minimum=Math.min(minimum,windows.size);phase=advanceCoopClock(phase,.02,circuit);
 }
 assert.ok(minimum>=2,`only ${minimum} reward windows overlapped`);
});

test('legacy 500ms checkpoints retain latch state and fractional phase when retimed',()=>{
 const legacy={pulseState:[2],elapsed:.48,steps:42,pulseOutput:0},before=structuredClone(legacy);
 const restored=restoreCoopClock(legacy);
 assert.equal(restored.clockStepSeconds,.4);assert.equal(restored.elapsed,.384);
 assert.deepEqual(restored.pulseState,[2]);assert.equal(restored.steps,42);assert.equal(restored.pulseOutput,0);
 assert.deepEqual(legacy,before);assert.deepEqual(restoreCoopClock(restored),restored);
});

test('clock advancement uses actual TAP states, preserves remainders and rejects invalid timing',()=>{
 let state=createCoopClock();const before=structuredClone(state);
 state=advanceCoopClock(state,.25,circuit);assert.equal(state.steps,0);assert.deepEqual(before,createCoopClock());
 state=advanceCoopClock(state,.15,circuit);assert.equal(state.steps,1);assert.equal(state.pulseOutput,1);assert.ok(state.elapsed<1e-9);
 for(let cycle=0;cycle<2;cycle++){state=advanceCoopClock(state,.2,circuit);state=advanceCoopClock(state,.2,circuit);}
 assert.equal(state.steps,3);assert.equal(state.pulseOutput,0);
 assert.throws(()=>restoreCoopClock({...state,clockStepSeconds:.3}),/clock/i);
 assert.throws(()=>restoreCoopClock({...state,elapsed:.41}),/clock/i);
 assert.throws(()=>advanceCoopClock(state,NaN,circuit),/clock/i);
});
