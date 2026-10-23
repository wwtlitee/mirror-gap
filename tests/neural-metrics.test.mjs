import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbodiedLife } from '../src/embodied-life.mjs';
import { NeuralMetrics } from '../src/neural-metrics.mjs';
import { senseEnvironment } from '../src/neural-controller.mjs';

test('rates are per-cell per neural second; missing sides are unknown rather than zero',()=>{
  const graph={neurons:3,dt_ms:.1,channels:[[0]],channelNames:['test'],motorIndices:[1,2],behaviorIndices:{},
    labels:[{root:'720575940660219265',type:'EPG',side:'left',anchor:true},
      {root:'720575940660219266',type:'DNa02',side:'left',anchor:true},{root:'720575940660219267',type:'DNa02',side:'left',anchor:true}]};
  const metrics=new NeuralMetrics(graph);assert.equal(metrics.snapshot([.5]).groups[0].hz,null);
  metrics.sample([0,0,1,1,1,2],400,1);
  const s=metrics.snapshot([.5]);assert.equal(s.windowMs,40);assert.equal(s.inputs[0].hz,50);
  assert.equal(s.groups[0].hz,50);assert.equal(s.groups[0].rightHz,null);
});

test('all cells are queryable with exact root strings; read-only queries do not change the brain',()=>{
  const s=new EmbodiedLife();s.tick(.3);const before=s.neural.serialize();
  const page=s.neural.cells({});assert.equal(page.total,4386);assert.equal(page.cells.length,24);
  assert.equal(s.neural.cells({role:'motor'}).total,80);
  const root=page.cells[0].root;assert.equal(typeof root,'string');assert.equal(s.neural.cells({query:root}).cells[0].root,root);
  const dn=s.neural.cells({query:'DNa02'});assert.equal(dn.total,2);assert.ok(dn.cells.every(c=>Number.isFinite(c.voltage)));
  assert.equal(s.neural.cells({query:'no-match-type'}).total,0);
  for(const options of [{page:-1},{page:1.5},{query:'x'.repeat(81)},{role:'invalid'}])assert.throws(()=>s.neural.cells(options),/参数/);
  assert.deepEqual(s.neural.serialize(),before);
});

test('a satiated curious fly at food is not kept in zero-drive feeding hold',()=>{
  const s=new EmbodiedLife();Object.assign(s.state.actor,{position:[-3.11246,1.355,1.87911],heading:2.575,
    velocity:[0,0,0],contact:true,zoneId:'feed',action:'observe',mode:'activity'});
  Object.assign(s.state.needs,{energy:100,satiety:68,curiosity:71,comfort:100});s.state.living.contactSeconds=937;
  const sensory=senseEnvironment(s.state,{feed:0,mist:0,chime:0});assert.equal(sensory.context.holdReason,'none');
  assert.ok(sensory.inputs.every(v=>v>.05));const p=[...s.state.actor.position];let travelled=0;
  // Allow a supported stance to settle before judging departure.
  for(let i=0;i<200;i++){s.tick(.1);travelled+=Math.hypot(...s.state.actor.position.map((v,j)=>v-p[j]));p.splice(0,3,...s.state.actor.position);}
  assert.ok(travelled>.5, `actual travel ${travelled}`);
});

test('rest, actual eating and screen attention retain their intended quiet context',()=>{
  const s=new EmbodiedLife(),pulses={feed:0,mist:0,chime:0};
  Object.assign(s.state.actor,{position:[-2.9199685114040452,1.2760313196157012,1.890058057098792],heading:3.9269908169872414,contact:true,zoneId:'feed',action:'eat'});
  s.state.needs.satiety=68;s.state.living.contactSeconds=10;
  assert.equal(senseEnvironment(s.state,pulses).context.holdReason,'feeding');
  s.state.actor.position=[-4.35,1.0,-2.15];s.state.actor.zoneId='rest';s.state.actor.action='rest';s.state.needs.energy=30;
  assert.equal(senseEnvironment(s.state,pulses).context.holdReason,'recovery');
  s.state.living.workstation.phase='attention';s.state.actor.zoneId='work';
  assert.equal(senseEnvironment(s.state,pulses).context.holdReason,'screen');
});
