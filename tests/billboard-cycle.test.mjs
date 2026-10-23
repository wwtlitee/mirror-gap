import test from 'node:test';
import assert from 'node:assert/strict';
import {billboardFrame,AD_COUNT,AD_HOLD_SECONDS,AD_FADE_SECONDS} from '../public/billboard-cycle.mjs';
test('billboards hold, crossfade continuously and wrap through all 16 campaigns',()=>{
 const period=AD_HOLD_SECONDS+AD_FADE_SECONDS;
 assert.equal(billboardFrame(17).mix,0);assert.ok(Math.abs(billboardFrame(18.6).mix-.5)<1e-10);
 const before=billboardFrame(period-1e-7),after=billboardFrame(period+1e-7);
 assert.equal(before.to,after.from);assert.ok(before.mix>.9999);assert.equal(after.mix,0);
 const seen=new Set(Array.from({length:AD_COUNT},(_,i)=>billboardFrame(i*period+.1).from));assert.equal(seen.size,16);
 assert.notEqual(billboardFrame(0,0).from,billboardFrame(0,1).from);
 assert.deepEqual(billboardFrame(NaN),billboardFrame(0));
});
