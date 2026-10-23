import test from 'node:test';import assert from 'node:assert/strict';
import {foodContact,nearestFood} from '../public/food-contact.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createMirrorGapCharacter} from '../public/character.mjs';
// v8.1.0c: an exposed apple surface with six real feet after adjacent food contours changed.
const position=[-3.1874151621111615,1.2754599002118072,1.2610225787547757],heading=.25839221306456966;
function resident(){const sim=new EmbodiedLife();Object.assign(sim.state.actor,{position:[...position],heading,contact:true,zoneId:'feed',mode:'activity',velocity:[0,0,0]});sim.state.needs.satiety=25;sim.state.living.physiology.thirst=.1;sim.state.living.contactSeconds=4;return sim;}
test('fruit behind the head, empty plate and airborne passing cannot be food contact',()=>{
 const a=resident().state.actor;assert.ok(foodContact(a));assert.equal(foodContact({...a,heading:heading+Math.PI}),null);
 assert.equal(foodContact({...a,position:[-4.6,1.15,1.5]}),null);assert.equal(foodContact({...a,contact:false}),null);
 assert.ok(nearestFood([-3.0392570192290034,1.21,1.786614089046865]).distance>.005,'brown banana stalk is not edible');
});
test('real neural feeding stays planted with a tip on the actual fruit mesh',()=>{
 const sim=resident();let eating=0;const start=sim.state.needs.satiety;
 for(let i=0;i<200;i++){sim.tick(.02);const a=sim.state.actor;if(a.action==='eat'){eating++;assert.ok(foodContact(a));assert.ok(nearestFood(a.feedingTarget).distance<1e-8);}}
 assert.ok(eating>150);assert.ok(sim.state.needs.satiety>start+2);assert.ok(Math.hypot(...sim.state.actor.position.map((v,i)=>v-position[i]))<.003);
 const c=createMirrorGapCharacter();try{c.root.position.set(...sim.state.actor.position);c.root.rotation.y=sim.state.actor.heading;c.root.scale.setScalar(.22);c.update({...sim.state.actor,contactSeconds:4},.1);
  assert.ok(nearestFood(c.root.userData.pose.feedingTip).distance<1e-8);assert.ok(c.root.userData.pose.feet.every(f=>f.supported));
 }finally{c.dispose();}
});
test('strong feeding output cannot increase satiety from an empty plate',()=>{
 const controller={error:null,motor:{local:[0,0,0],drive:0},behavior:{feeding:1,grooming:0},sensory:{context:{}},tick(){}};
 const sim=new EmbodiedLife(null,{controller});Object.assign(sim.state.actor,{position:[-4.6,1.15,1.5],heading:0,contact:true,zoneId:'feed',mode:'activity',velocity:[0,0,0]});sim.state.needs.satiety=25;
 for(let i=0;i<50;i++)sim.tick(.02);assert.ok(sim.state.needs.satiety<25);assert.equal(sim.state.stats.ateSeconds,0);assert.equal(sim.state.actor.feedingTarget,null);
});
test('reaching food cannot feed when neural feeding output is absent',()=>{
 const controller={error:null,motor:{local:[0,0,0],drive:0},behavior:{feeding:0,grooming:0},sensory:{context:{}},tick(){}};
 const sim=new EmbodiedLife(null,{controller});Object.assign(sim.state.actor,{position:[...position],heading,contact:true,zoneId:'feed',mode:'activity',velocity:[0,0,0]});sim.state.needs.satiety=25;
 for(let i=0;i<50;i++)sim.tick(.02);assert.ok(sim.state.needs.satiety<25);assert.equal(sim.state.stats.ateSeconds,0);
});
