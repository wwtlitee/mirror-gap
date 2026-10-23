import {stepCircuit} from './tapeout-circuit.mjs';

// 400ms is a game-provided hardware clock. The on-chain three-state TAP circuit is unchanged.
// Consecutive 3s food rewards sample opposite phases of its 1.2s cycle.
export const COOP_CLOCK_SECONDS=.4;
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
export const createCoopClock=()=>({clockStepSeconds:COOP_CLOCK_SECONDS,pulseState:[],elapsed:0,steps:0,pulseOutput:0});

export function restoreCoopClock(saved){
 const period=saved?.clockStepSeconds??.5;
 if(!saved||![.4,.5].includes(period)||!Array.isArray(saved.pulseState)||saved.pulseState.length>32
  ||saved.pulseState.some(value=>!Number.isInteger(value)||value<0||value>255)
  ||!finite(saved.elapsed,0,period)||!Number.isSafeInteger(saved.steps)||saved.steps<0||![0,1].includes(saved.pulseOutput))throw Error('Invalid cooperation clock');
 return {clockStepSeconds:COOP_CLOCK_SECONDS,pulseState:[...saved.pulseState],elapsed:saved.elapsed/period*COOP_CLOCK_SECONDS,steps:saved.steps,pulseOutput:saved.pulseOutput};
}

/** Only advances the electrical model; never reads or alters any neural or body state. */
export function advanceCoopClock(saved,seconds,circuit){
 if(!finite(seconds,0,.25))throw Error('Invalid cooperation clock interval');
 const clock=restoreCoopClock(saved);clock.elapsed+=seconds;
 while(clock.elapsed>=COOP_CLOCK_SECONDS-1e-9){
  const next=stepCircuit(circuit,{state:Uint8Array.from(clock.pulseState),inputs:new Uint8Array()});
  clock.pulseState=Array.from(next.newState);clock.pulseOutput=next.outputs[0]&1;clock.steps++;
  clock.elapsed=Math.max(0,clock.elapsed-COOP_CLOCK_SECONDS);
 }
 return clock;
}
