import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint,restoreCompanion} from '../public/companion-checkpoint.mjs';
import {createCare,updateCare,replenish,receiveWeather,maintenance,careAction,updateMaintenance} from '../public/pet-care.mjs';
import {daylightState} from '../src/living-world.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {applyGrowthSize} from '../public/companion-growth.mjs';
import {resourceLandingPoses} from '../public/resource-landing.mjs';
const make=()=>{const sim=new EmbodiedLife();sim.state.companion=createCompanion();adoptCompanion(sim.state.companion,'雨点');sim.state.living.care=createCare();return sim;};
test('empty supplies stay empty and adding food does not add water',()=>{
 const sim=make();sim.state.home={food:0,water:0};sim.tick(.1);assert.deepEqual(sim.state.home,{food:0,water:0});
 sim.interact('feed');assert.equal(sim.state.home.food,40);assert.equal(sim.state.home.water,0);
 sim.environmentCommand('water');assert.equal(sim.state.home.water,40);assert.equal(sim.state.home.food,40);
 assert.throws(()=>sim.environmentCommand('water'));assert.throws(()=>sim.environmentCommand('weather',{rain:NaN,wind:0}));
});
test('habitat backup preserves supplies, weakness, active clock, and habituation without offline catch-up',()=>{
 const a=make().state;a.home={food:3,water:7};a.simSeconds=900;a.living.clock={mode:'cycle',hour:9,anchor:0};a.living.care.weakness=.6;a.living.care.habituation=.4;
 const cp=companionCheckpoint(a),b=make().state;cp.savedAt=1;restoreCompanion(b,cp);
 assert.deepEqual(b.home,a.home);assert.deepEqual(b.living.care,a.living.care);assert.equal(daylightState(b).hour,daylightState(a).hour);assert.equal(b.simSeconds,900);
 const old={...cp};delete old.habitat;restoreCompanion(b,old);assert.equal(b.living.clock.mode,'cycle');
 cp.habitat.food=-1;const prior=structuredClone(b.home);assert.throws(()=>restoreCompanion(b,cp));assert.deepEqual(b.home,prior);
});
test('prolonged deprivation causes bounded reversible weakness, not death or immobilization',()=>{
 const s=make().state;s.needs.satiety=0;s.living.physiology.thirst=1;
 for(let i=0;i<1200;i++){s.simSeconds++;updateCare(s,1);}assert.equal(s.living.care.weakness,1);
 s.needs.satiety=70;s.living.physiology.thirst=.1;
 for(let i=0;i<200;i++)updateCare(s,1);assert.equal(s.living.care.weakness,0);assert.equal(s.living.care.deprivation,600);
 s.paused=true;const prior=structuredClone(s.living.care);updateCare(s,100);assert.deepEqual(s.living.care,prior);
});
test('rain and distant footsteps generate bounded neural input independently of playback',()=>{
 const s=make().state;receiveWeather(s,{rain:1,wind:.5});assert.ok(s.living.care.stimulus>0);
 const pulses={feed:0,mist:0,chime:0};assert.ok(senseEnvironment(s,pulses).signals.find(x=>x.id==='bell').intensity>0);
 s.simSeconds=45;updateCare(s,.02);assert.equal(s.living.care.footstep,1);assert.ok(s.living.alert<.1);
 s.living.care.habituation=1;s.living.care.rain=0;s.living.care.stimulus=0;receiveWeather(s,{rain:1,wind:.5});assert.ok(s.living.care.stimulus<.03);
 s.home={food:0,water:0};assert.ok(senseEnvironment(s,pulses).signals.every(x=>!x.resourceKind));
});
test('autonomous clock advances only by simulation seconds',()=>{
 const s=make().state;restoreCompanion(s,null);const before=daylightState(s,new Date('2020-01-01')).hour;
 assert.equal(daylightState(s,new Date('2030-01-01')).hour,before);s.simSeconds+=60;assert.equal(daylightState(s).hour,before+1);
});
test('real feeding consumes only food and the weakened fly retains feeding ability',()=>{
 const sim=make(),s=sim.state;s.needs.satiety=10;s.living.care.weakness=1;s.home={food:100,water:10};
 applyGrowthSize(s);
 Object.assign(s.actor,structuredClone(resourceLandingPoses('apple',s.actor)[0]),{contact:true,zoneId:'feed',mode:'activity',velocity:[0,0,0]});
 for(let i=0;i<400;i++)sim.tick(.02);
 assert.ok(s.needs.satiety>12);assert.ok(s.home.food<100);assert.equal(s.home.water,10);
});
test('actual drinking consumes water independently of food even when weakened',()=>{
 const sim=make(),s=sim.state;s.home={food:10,water:10};s.living.care.weakness=1;
 Object.assign(s.actor,{position:[-2.70,1.8,.56],heading:0,velocity:[0,0,0],contact:false,zoneId:'feed'});
 s.needs.satiety=90;s.living.physiology.thirst=.65;
 for(let i=0;i<250;i++)sim.tick(.02);
 assert.ok(s.living.physiology.thirst<.65);assert.ok(s.home.water<10);assert.equal(s.home.food,10);
});
test('adding old supplies blends freshness; replacing supplies refreshes them',()=>{
 const s=make().state,m=maintenance(s);s.home.food=60;m.foodFresh=.2;replenish(s,'food');assert.equal(s.home.food,100);assert.equal(m.foodFresh,.52);
 careAction(s,'replace-food');assert.equal(m.foodFresh,1);assert.throws(()=>careAction(s,'clean'));s.simSeconds+=2;careAction(s,'replace-water');assert.equal(s.home.water,100);assert.equal(m.waterFresh,1);
});
test('cleaning removes room waste without magically emptying the stomach',()=>{
 const s=make().state,m=maintenance(s);s.living.hygiene.bowelMovements=3;s.living.hygiene.lastDropPosition=[1,.3,1];updateMaintenance(s,1);assert.ok(m.cleanliness<.5);
 const before=s.living.physiology.waste;careAction(s,'clean');assert.equal(m.cleanliness,1);assert.equal(s.living.physiology.waste,before);assert.equal(s.living.hygiene.lastDropPosition,null);
});
test('brushing waits for safe contact and improves dirt gradually; drying and sleep are protected',()=>{
 const s=make().state,m=maintenance(s);s.living.physiology.dirt=.8;s.living.wetness=.8;careAction(s,'brush');s.actor.contact=false;updateMaintenance(s,1);assert.equal(s.living.physiology.dirt,.8);
 s.actor.contact=true;s.actor.velocity=[0,0,0];s.actor.action='observe';updateMaintenance(s,1);assert.ok(s.living.physiology.dirt>.7&&s.living.physiology.dirt<.8);
 s.simSeconds=2;careAction(s,'dry');const wet=s.living.wetness;updateMaintenance(s,1,{resting:true});assert.equal(s.living.wetness,wet);updateMaintenance(s,1);assert.ok(s.living.wetness<wet&&s.living.wetness>0);
 s.simSeconds=100;updateMaintenance(s,1);assert.equal(m.brush,0);assert.equal(m.dry,0);
});
test('clean bedding improves actual rest; preparing play alone cannot fill entertainment',()=>{
 const a=make().state,b=make().state;maintenance(a).bedding=1;maintenance(b).bedding=0;
 updateMaintenance(a,1,{resting:true});updateMaintenance(b,1,{resting:true});assert.ok(a.needs.energy>b.needs.energy);assert.ok(a.living.physiology.sleepPressure<b.living.physiology.sleepPressure);
 const curiosity=a.needs.curiosity;careAction(a,'enrich');updateMaintenance(a,1);assert.equal(a.needs.curiosity,curiosity);a.living.workstation.phase='playing';updateMaintenance(a,1);assert.ok(a.needs.curiosity<curiosity);
 a.simSeconds=3;careAction(a,'quiet');assert.equal(a.living.workstation.enabled,false);
});
test('maintenance persists and invalid values reject the entire backup',()=>{
 const a=make().state;maintenance(a).bedding=.25;maintenance(a).cleanliness=.4;careAction(a,'quiet');a.living.hygiene.bowelMovements=3;a.living.hygiene.lastDropPosition=[4,.3,1];const cp=companionCheckpoint(a),b=make().state;restoreCompanion(b,cp);assert.equal(maintenance(b).bedding,.25);assert.equal(b.living.workstation.enabled,false);assert.equal(b.living.hygiene.bowelMovements,3);assert.deepEqual(b.living.hygiene.lastDropPosition,[4,.3,1]);
 cp.habitat.care.maintenance.foodFresh=NaN;assert.throws(()=>restoreCompanion(b,cp));assert.equal(maintenance(b).cleanliness,.4);
});
