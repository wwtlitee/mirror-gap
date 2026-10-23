import test from 'node:test';
import assert from 'node:assert/strict';
import {RESOURCE_SIGNALS, resourceContact} from '../public/resource-contact.mjs';
import {resourceLandingPoses, resourceLandingPoint} from '../public/resource-landing.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';

test('every displayed food has a supported, reachable edible surface', () => {
  for (const source of RESOURCE_SIGNALS.filter(s => s.resourceKind === 'food')) {
    const poses = resourceLandingPoses(source.resourceId);
    assert.ok(poses.length, source.resourceId);
    for (const pose of poses) assert.equal(resourceContact(pose, 'food')?.id, source.resourceId);
    assert.ok(resourceLandingPoint(source, [0, 1, 0]));
  }
  assert.equal(resourceLandingPoint({resourceKind:'food',resourceId:'missing'}, [0,0,0]), null);
});

test('fries can actually be eaten for several seconds without falling or extending mouth reach', () => {
  const controller = {motor:{local:[0,0,0],drive:0},behavior:{feeding:1,grooming:0},sensory:{context:{},signals:[]},tick(){}};
  let successful = 0;
  for (const pose of resourceLandingPoses('fries')) {
    const sim = new EmbodiedLife(null, {controller}), s = sim.state;
    Object.assign(s.actor, structuredClone(pose), {velocity:[0,0,0],zoneId:'food'});
    Object.assign(s.needs,{energy:70,satiety:20});
    Object.assign(s.living.physiology,{thirst:.1,dirt:.1,waste:.1,sleepPressure:.1});
    s.living.contactSeconds=3;
    for(let i=0;i<150;i++)sim.tick(.02);
    if(s.actor.consumingResource?.id==='fries' && s.needs.satiety>21 && s.actor.contact)successful++;
  }
  assert.ok(successful >= 3, `stable consuming poses: ${successful}`);
});

test('one feeding onset sustains a supported meal through neural gaps until full',()=>{
 const controller={motor:{local:[0,0,0],drive:0},behavior:{feeding:1,grooming:0},sensory:{context:{},signals:[]},tick(){}};
 const sim=new EmbodiedLife(null,{controller}),s=sim.state;const pose=resourceLandingPoses('fries')[0];
 Object.assign(s.actor,structuredClone(pose),{velocity:[0,0,0],zoneId:'feed'});Object.assign(s.needs,{energy:70,satiety:54});Object.assign(s.living.physiology,{thirst:.1,dirt:.1,waste:.1,sleepPressure:.1});s.living.contactSeconds=3;
 sim.tick(.02);controller.behavior.feeding=0;let reached=false;
 for(let i=0;i<4000;i++){sim.tick(.02);if(s.living.activityCooldowns?.eat>s.simSeconds){reached=true;break;}}
 assert.ok(reached,'meal must complete rather than stop at the start threshold');assert.ok(s.needs.satiety>=99.5);assert.ok(s.actor.contact);
});
