import test from 'node:test';import assert from 'node:assert/strict';import{EmbodiedLife}from '../src/embodied-life.mjs';import{updateRegions,regionDemand}from '../public/region-life.mjs';import{signalOccluded}from '../public/environment-spec.mjs';import{senseEnvironment}from '../src/neural-controller.mjs';
test('every region has a recovering need, engagement depletes only the current area',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.actor,{zoneId:'perch',contact:true});s.living.contactSeconds=2;
 for(let i=0;i<100;i++)updateRegions(s,.1);
 assert.ok(s.living.regions.perch.need<.3);assert.ok(s.living.regions.garden.need>.5);assert.ok(s.living.regions.perch.settled>9.9);assert.equal(s.living.regions.perch.visits,1);assert.equal(s.living.regions.garden.visits,0);
 s.actor.zoneId='garden';s.actor.contact=false;updateRegions(s,1);assert.equal(s.living.regions.garden.settled,0);assert.equal(s.living.regions.garden.presence,1);
});
test('water under a shelf is occluded, an accessible source is not',()=>{
 assert.equal(signalOccluded([-4.95,1.15,2.1],[-4.95,.85,2.1]),true);
 assert.equal(signalOccluded([-4.6,1.305,2.1],[-4.6,1.25,2.1]),false);
 assert.equal(signalOccluded([4,2,.1],[5,2.68,.1]),false);
});
test('all eight primary sources are present, hunger urgency remains, forgotten perch gains signal',()=>{
 const s=new EmbodiedLife().state;s.actor.position=[0,2.8,0];const p={feed:0,mist:0,chime:0};s.living.regions.perch.need=.05;
 const low=senseEnvironment(s,p).signals.find(v=>v.id==='high-perch').intensity;s.living.regions.perch.need=1;
 const high=senseEnvironment(s,p);assert.ok(high.signals.find(v=>v.id==='high-perch').intensity>low*3);assert.ok(high.signals.some(v=>v.id==='open-air'));
 s.needs.satiety=5;assert.ok(regionDemand(s,'feed').urgency);
});
test('region migration uses familiarity only for initial need and never fabricates past dwell',()=>{
 const old=new EmbodiedLife().serialize();old.version='4.2.0';delete old.living.regions;old.living.familiar={nook:1,perch:0};
 const sim=new EmbodiedLife(old);assert.ok(sim.state.living.regions.perch.need>sim.state.living.regions.nook.need);assert.ok(Object.values(sim.state.living.regions).every(r=>r.settled===0));assert.deepEqual(sim.neural.serialize(),old.neural);
 const bad=sim.serialize();bad.living.regions.perch.need=2;assert.throws(()=>new EmbodiedLife(bad),/存档无效/);
});


test('free exploration above ecological rocks finds a real surface and remains active',()=>{
 const s=new EmbodiedLife();Object.assign(s.state.actor,{position:[4.96,2.2,-.1],heading:0,velocity:[0,0,0],contact:false,zoneId:'perch',mode:'travel'});
 Object.assign(s.state.needs,{energy:90,satiety:95,comfort:95,curiosity:0});
 Object.assign(s.state.living.physiology,{thirst:.05,sleepPressure:.05,dirt:0,waste:.05});
 s.state.living.focus.action='explore';
 for(const[k,v]of Object.entries(s.state.living.regions))v.need=k==='perch'?1:.05;
 let dwell=0;for(let i=0;i<300;i++){s.tick(.1);if(s.state.actor.contact&&s.state.actor.zoneId==='perch')dwell+=.1;}
 assert.ok(dwell>2,`perch contact ${dwell}s; final focus ${s.state.living.focus.action}`);assert.ok(s.state.living.regions.perch.visits>0);
});
