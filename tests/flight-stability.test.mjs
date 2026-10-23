import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {smoothMotorVector} from '../src/functional-controller.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' != '+b);
test('holding a sampled motor command cannot rotate world thrust at either feedback rate',()=>{
 for(const intervalSeconds of [.1,1]){
 const velocities=[];
 for(const heading of [0,Math.PI/2]){
 const sim=new EmbodiedLife(),s=sim.state;Object.assign(s.actor,{position:[0,2.5,0],velocity:[0,0,0],heading,contact:false});
 sim.neural.motor={local:[0,0,.5],drive:1,referenceHeading:0};sim.neural.frame={intervalSeconds};s.neuralAccumulator=0;sim.tick(.02);velocities.push(s.actor.velocity);
 }
 velocities[0].forEach((v,i)=>close(v,velocities[1][i]));assert.ok(velocities[0][2]>0);
 }
});
test('smoothing preserves a world direction across a quarter turn and stops without neural output',()=>{
 for(const dt of [.1,1]){
 const motor={local:[0,0,1],referenceHeading:Math.PI/2};
 const next=smoothMotorVector(motor,[1,0,0],0,dt);close(next[0],1);close(next[2],0);
 assert.deepEqual(smoothMotorVector(motor,[0,0,0],0,dt,false),[0,0,0]);
 }
});
test('course changes have bounded yaw and do not teleport or create extra speed',()=>{
 const sim=new EmbodiedLife(),s=sim.state;Object.assign(s.actor,{position:[0,2.5,0],velocity:[1,0,0],heading:0,contact:false});
 sim.neural.motor={local:[0,0,0],drive:0,referenceHeading:0};s.neuralAccumulator=0;sim.tick(.02);
 assert.ok(s.actor.heading>0&&s.actor.heading<=1.8*.02+1e-9);assert.ok(s.actor.velocity[0]<1);assert.ok(s.actor.position[0]<.021);
});
