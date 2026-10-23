import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_TAPEOUT,TAPEOUT_PULSE_CIRCUIT,TAPEOUT_PULSE_SOURCE,parseCircuit} from '../public/tapeout-circuit.mjs';
import {verifyFrozenTapeout} from '../public/tapeout-verification.mjs';

function fixture(){
  const calls=[],native=parseCircuit(TAPEOUT_PULSE_SOURCE),xor=parseCircuit(DEFAULT_TAPEOUT);
  const pulse=parseCircuit(TAPEOUT_PULSE_CIRCUIT,{resolveRef:()=>native});
  const bridge={
    async verifyDeployment(){return {chainId:196,factory:DEFAULT_TAPEOUT.factory,cpu:DEFAULT_TAPEOUT.cpu,blockNumber:'0x123',rpcUrl:'https://rpc.example.test'};},
    async loadCircuit({id}){calls.push(['load',String(id)]);return id===1n?xor:pulse;},
    async step({id,state,inputs}){
      calls.push(['step',String(id)]);
      if(id===1n)return {newState:new Uint8Array(),outputs:Uint8Array.of((inputs[0]&1)^((inputs[0]>>1)&1))};
      const before=state[0]??0;return {newState:Uint8Array.of([1,2,0][before]),outputs:Uint8Array.of(before===0?1:0)};
    },
  };
  return {bridge,calls};
}

test('session provenance verifies fixed netlists and real remote vectors, without replacing runtime logic',async()=>{
  const {bridge,calls}=fixture(),progress=[];const result=await verifyFrozenTapeout({bridge,onProgress:p=>progress.push(p)});
  assert.equal(result.status,'verified');assert.equal(result.vectors,7);assert.equal(result.blockNumber,'0x123');
  assert.equal(calls.filter(([type])=>type==='step').length,7);assert.deepEqual(result.circuitIds,['1','4']);
  assert.equal(progress.at(-1).completed,7);assert.equal(JSON.stringify(result).includes('privateKey'),false);
});
test('wrong chain, deployment or source circuit cannot become verified',async()=>{
  for(const change of [
    b=>{b.verifyDeployment=async()=>({chainId:1,factory:DEFAULT_TAPEOUT.factory,cpu:DEFAULT_TAPEOUT.cpu});},
    b=>{const old=b.loadCircuit;b.loadCircuit=async p=>({...await old(p),netlist:'0x00'});},
  ]){const {bridge}=fixture();change(bridge);await assert.rejects(()=>verifyFrozenTapeout({bridge}));}
});
test('one mismatched chain output fails rather than accepting partial vector agreement',async()=>{
  const {bridge}=fixture(),old=bridge.step;bridge.step=async p=>{const r=await old(p);if(p.id===1n&&p.inputs[0]===3)r.outputs=Uint8Array.of(1);return r;};
  await assert.rejects(()=>verifyFrozenTapeout({bridge}),/不一致/);
});
test('RPC failure propagates once with no automatic retry or invented receipt',async()=>{
  const {bridge}=fixture();let calls=0;bridge.verifyDeployment=async()=>{calls++;throw Error('offline');};
  await assert.rejects(()=>verifyFrozenTapeout({bridge}),/offline/);assert.equal(calls,1);
});
