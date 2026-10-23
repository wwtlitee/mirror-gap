import test from 'node:test';import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {updateLiving} from '../src/living-world.mjs';
import {createMirrorGapCharacter} from '../public/character.mjs';
const motor={local:[0,0,0],drive:0,behavior:{grooming:1}};
function bed(){const sim=new EmbodiedLife(),s=sim.state;Object.assign(s.actor,{contact:true,zoneId:'rest',velocity:[0,0,0],action:'rest'});s.living.contactSeconds=3;s.needs.energy=47;return sim;}
test('sleep continues while incomplete and full energy plus sleep satisfaction starts cooldown',()=>{
 const sim=bed(),s=sim.state;updateLiving(s,motor,.1);assert.equal(s.living.sleep.active,true);
 s.needs.energy=100;s.living.physiology.sleepPressure=.4;updateLiving(s,motor,.1);
 assert.equal(s.living.behavior,'rest');assert.ok(!(s.living.activityCooldowns?.rest>0));
 s.living.physiology.sleepPressure=0;s.simSeconds+=.1;updateLiving(s,motor,.1);
 assert.ok(s.living.activityCooldowns.rest>=s.simSeconds+179.9);
 s.simSeconds+=.1;updateLiving(s,motor,.1);
 assert.equal(s.living.sleep.active,false);assert.ok(s.living.sleep.cooldown>29);
 s.needs.energy=47;updateLiving(s,motor,1);assert.notEqual(s.living.behavior,'rest');
});
test('severe thirst and disturbance interrupt; pause and checkpoint preserve sleep timer',()=>{
 for(const danger of ['thirst','alert']){const sim=bed(),s=sim.state;updateLiving(s,motor,1);if(danger==='thirst')s.living.physiology.thirst=.98;else s.living.alert=.7;updateLiving(s,motor,.1);assert.equal(s.living.sleep.active,false);}
 const sim=bed();updateLiving(sim.state,motor,12);sim.state.paused=true;sim.tick(1);assert.equal(sim.state.living.sleep.elapsed,12);
 const saved=sim.serialize();assert.deepEqual(new EmbodiedLife(saved).state.living.sleep,saved.living.sleep);
 saved.living.sleep.elapsed=-1;assert.throws(()=>new EmbodiedLife(saved),/睡眠存档/);
});
test('sleep pose lowers body, plants feet, shows floating Zs and reverses on wake',()=>{
 const c=createMirrorGapCharacter();try{c.root.scale.setScalar(.22);c.root.position.set(0,.125,.75);
 const actor={contact:true,contactSeconds:4,mode:'activity',behavior:'perch',velocity:[0,0,0]};c.update(actor,.1);const standing=c.root.userData.pose.bodyHeight;
 for(let i=0;i<30;i++)c.update({...actor,behavior:'rest'},.1);
 const pose=c.root.userData.pose;assert.ok(pose.bodyHeight<standing-.10);assert.equal(pose.feet.length,6);assert.ok(pose.feet.every(f=>f.supported&&f.gap<.002));
 const letters=c.root.children.filter(o=>o.name.startsWith('Sleep_Z_'));assert.equal(letters.length,3);assert.ok(letters.every(o=>o.visible));
 const y=letters[0].position.y;c.update({...actor,behavior:'rest'},0);assert.equal(letters[0].position.y,y);
 for(let i=0;i<30;i++)c.update(actor,.1);assert.ok(c.root.userData.pose.bodyHeight>standing-.001);assert.ok(letters.every(o=>!o.visible));
 }finally{c.dispose();}
});
