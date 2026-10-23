import test from 'node:test';import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
const start=[3.89305586373408,.3851,.3251194244312541];
function trapped(){const sim=new EmbodiedLife(),s=sim.state;Object.assign(s.actor,{position:[...start],heading:2.844761,contact:true,zoneId:'perch',mode:'activity',action:'observe',velocity:[0,0,0]});Object.assign(s.needs,{energy:83,satiety:0,curiosity:0,comfort:0});Object.assign(s.living.physiology,{thirst:1,sleepPressure:1,dirt:.96,waste:1});Object.assign(s.living.surface,{blocked:20,contactAge:40});s.living.contactSeconds=40;return sim;}
test('real neural motor turns and leaves the leaf-mushroom trap without teleporting',()=>{
 const sim=trapped();let furthest=0;
 for(let i=0;i<1000;i++){const before=[...sim.state.actor.position];sim.tick(.02);const p=sim.state.actor.position;assert.ok(Math.hypot(...p.map((v,j)=>v-before[j]))<.16);furthest=Math.max(furthest,Math.hypot(...p.map((v,j)=>v-start[j])));assert.equal(sim.state.actor.targetZoneId,null);}
 assert.ok(furthest>.35,`Moved only ${furthest}`);assert.equal(sim.neural.error,null);
});
test('local obstacle sensing cannot propel a disconnected neural body',()=>{
 const sim=trapped();sim.neural.brain.disconnect();
 for(let i=0;i<50;i++)sim.tick(.1);
 assert.deepEqual(sim.neural.motor.local,[0,0,0]);assert.ok(Math.hypot(...sim.state.actor.position.map((v,j)=>v-start[j]))<.03);
});
