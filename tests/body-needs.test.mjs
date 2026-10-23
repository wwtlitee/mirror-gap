import test from 'node:test';import assert from 'node:assert/strict';
import{EmbodiedLife}from '../src/embodied-life.mjs';import{updateLiving}from '../src/living-world.mjs';
import{senseEnvironment}from '../src/neural-controller.mjs';import{SIGNAL_SOURCES}from '../public/environment-spec.mjs';
import{regionDemand}from '../public/region-life.mjs';import{createMirrorGapCharacter}from '../public/character.mjs';
const motor={local:[0,0,0],drive:0,behavior:{grooming:1}},pulses={feed:0,mist:0,chime:0};
const setup=zone=>{const s=new EmbodiedLife().state;Object.assign(s.actor,{position:zone==='entry'?[4.5,.385,3.1]:[4.39,.615,.38],velocity:[0,0,0],contact:true,zoneId:zone,action:'observe'});s.living.contactSeconds=3;return s;};
test('decoration has no demand or attraction; dirt and waste increase relevant sensory signals',()=>{
 const s=setup('flight');assert.equal(regionDemand(s,'nook').level,0);assert.ok(!SIGNAL_SOURCES.some(v=>v.zone==='nook'));
 const before=senseEnvironment(s,pulses);s.living.physiology.dirt=.95;s.living.physiology.waste=.95;const after=senseEnvironment(s,pulses);
 for(const id of ['water','toilet'])assert.ok(after.signals.find(v=>v.id===id).intensity>before.signals.find(v=>v.id===id).intensity,id);
});
test('shallow-water washing reduces dirt, increases wetness; airborne passing cannot wash',()=>{
 const s=setup('entry');Object.assign(s.living.physiology,{dirt:.9,thirst:.05});const before=s.living.physiology.dirt;
 for(let i=0;i<100;i++)updateLiving(s,motor,.1);assert.equal(s.living.behavior,'bathe');assert.ok(s.living.physiology.dirt<before-.20);assert.ok(s.living.wetness>.1);
 s.actor.contact=false;const dirt=s.living.physiology.dirt;updateLiving(s,motor,1);assert.ok(s.living.physiology.dirt>=dirt);
});
test('toilet contact is sustained before elimination; demand drops and one event is recorded',()=>{
 const s=setup('toilet');s.actor.heading=Math.PI/2;s.living.physiology.waste=.9;updateLiving(s,motor,1);assert.equal(s.living.hygiene.bowelMovements,0);
 for(let i=0;i<180;i++){s.simSeconds+=.1;updateLiving(s,motor,.1);}assert.equal(s.living.hygiene.bowelMovements,1);assert.ok(s.living.physiology.waste<.12);assert.equal(s.living.hygiene.lastDropPosition.length,3);
 const air=setup('toilet');air.actor.contact=false;air.living.physiology.waste=.9;updateLiving(air,motor,10);assert.equal(air.living.hygiene.bowelMovements,0);assert.ok(air.living.physiology.waste>=.9);
});
test('grooming strokes reach the head while four stance feet remain on the floor',()=>{
 const c=createMirrorGapCharacter();try{c.root.scale.setScalar(.22);c.root.position.set(0,.125,.75);c.update({contact:true,contactSeconds:4,mode:'activity',behavior:'groom',velocity:[0,0,0]},.1);
 const feet=c.root.userData.pose.feet;assert.equal(feet.filter(f=>f.swing).length,2);assert.ok(feet.filter(f=>!f.swing).every(f=>f.gap<.002));const front=feet.filter(f=>f.swing);assert.ok(front.every(f=>f.position[1]>.10));const first=front[0].position;c.update({contact:true,contactSeconds:4,mode:'activity',behavior:'groom',velocity:[0,0,0]},.1);assert.notDeepEqual(c.root.userData.pose.feet[0].position,first);
 }finally{c.dispose();}
});
test('idle curiosity rises, observation satisfies it; sleep relieves sleep pressure',()=>{
 const idle=setup('flight');idle.needs.curiosity=50;updateLiving(idle,motor,1);assert.ok(idle.needs.curiosity>50);
 const window=setup('garden');window.needs.curiosity=50;updateLiving(window,motor,1);assert.ok(window.needs.curiosity<50);
 const bed=setup('rest');bed.living.physiology.sleepPressure=.8;updateLiving(bed,motor,1);assert.ok(bed.living.physiology.sleepPressure<.8);
});

test('being stuck for minutes is not endless entertainment',()=>{
 const s=setup('perch');s.needs.curiosity=50;s.living.contactSeconds=120;s.living.surface.blocked=10;
 updateLiving(s,motor,1);assert.ok(s.needs.curiosity>50);
});
