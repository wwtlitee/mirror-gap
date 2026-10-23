import test from 'node:test';
import assert from 'node:assert/strict';

async function api(){let result;try{result=await import('../scripts/audit-motor-decoder.mjs');}catch{}
  assert.equal(typeof result?.declareMotorAudit,'function','A bounded direction-blind decoder audit must be declared before calibration changes');return result;}

test('audit fixes four cardinal directions, two existing calibration seeds and a finite side-channel grid',async()=>{
  const {declareMotorAudit,encodeAuditInputs}=await api(),p=declareMotorAudit();
  assert.deepEqual(p.seeds,[719,1901]);assert.equal(p.directions.length,4);assert.equal(p.profiles.length,4);
  assert.equal(p.stepsPerFrame,400);assert.equal(p.framesPerCondition,10);assert.equal(p.warmupSteps,1200);
  assert.equal(p.ridgeFraction,.1);assert.equal(p.emaAlpha,.25);
  assert.throws(()=>declareMotorAudit({framesPerCondition:100}),/fixed|option/i);
  const a=encodeAuditInputs(p.directions[0].vector,p.profiles[0]),b=encodeAuditInputs(p.directions[1].vector,p.profiles[0]);
  assert.equal(a.length,9);assert.ok(a.every(x=>x>=0&&x<=.8));
  assert.ok(a[0]>b[0]);assert.deepEqual(a.slice(4),[0,0,0,0,0]);
});

test('offline decoder retains clipping and shows a positive receptor population projection',async()=>{
  const {decodeFrameCounts}=await api();
  const c={baseline:[0,0,0,0],inverse:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]};
  const result=decodeFrameCounts([200,0,0,200],c);
  assert.ok(result.local[0]>0);assert.ok(Math.abs(result.local[2])<1e-12);
  for(let i=0;i<4;i++)assert.ok(Math.abs(result.populations[i]-[.84,.34,.34,.84][i])<1e-12);
  const clipped=decodeFrameCounts([1000,0,0,0],c);
  assert.equal(clipped.clippedChannels,1);assert.equal(clipped.populations[0],1.2);
  assert.deepEqual(decodeFrameCounts([0,0,0,0],c).local,[0,0,0]);
});

test('angle errors retain reversed and absent directions instead of manufacturing success',async()=>{
  const {horizontalAngleDegrees}=await api();
  assert.equal(horizontalAngleDegrees([1,0,0],[1,0,0]),0);
  assert.equal(horizontalAngleDegrees([1,0,0],[-1,0,0]),180);
  assert.equal(horizontalAngleDegrees([1,0,0],[0,0,1]),90);
  assert.equal(horizontalAngleDegrees([1,0,0],[0,0,0]),null);
});

test('ridge inverse uses the fixed existing neural response matrix and has no cue or condition label input',async()=>{
  const {regularizedInverse}=await api();
  const identity=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  const inverse=regularizedInverse(identity,.1);
  for(let i=0;i<4;i++)for(let j=0;j<4;j++)assert.ok(Math.abs(inverse[i][j]-(i===j?1/1.1:0))<1e-12);
  assert.throws(()=>regularizedInverse([[0,0,0,0]],.1),/response|rank|scale/i);
});
