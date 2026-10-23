import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {idlePose} from '../public/idle-life.mjs';
import {stationaryActivity} from '../public/behavior-policy.mjs';
function quiet(){
 const sim=new EmbodiedLife(),s=sim.state;
 Object.assign(s.actor,{position:[-1.28,1.5131,-3.18],velocity:[0,0,0],heading:0,contact:true,zoneId:'work'});
 Object.assign(s.needs,{energy:90,satiety:90,curiosity:0});
 Object.assign(s.living.physiology,{thirst:.1,waste:.1,sleepPressure:.1,dirt:.01});
 s.living.focus.action='explore';s.living.contactSeconds=1;s.living.surface.contactAge=1;
 return sim;
}
test('supported exploration can pause without being mistaken for trapped movement, then releases',()=>{
 const sim=quiet(),s=sim.state;assert.equal(stationaryActivity(s),'idle');
 for(let i=0;i<60;i++)sim.tick(.1);
 assert.equal(s.living.behavior,'idle');assert.equal(s.living.surface.blocked,0);assert.equal(s.living.escape.attempts,0);
 s.living.surface.contactAge=30;assert.equal(idlePose(s),null);
});
test('needs, threat, unsupported feet and actual obstruction interrupt a pause immediately',()=>{
 for(const change of [s=>s.living.focus.action='drink',s=>s.living.alert=.2,s=>s.actor.contact=false,s=>s.actor.position[1]=3,s=>s.living.surface.blocked=1,s=>s.living.physiology.thirst=.9]){
  const s=quiet().state;change(s);assert.equal(idlePose(s),null);
 }
});
test('casual head rub does not complete cleaning and saves resume deterministically',()=>{
 const sim=quiet(),s=sim.state;s.lastVisited.work=8;
 let found=false;
 for(let i=0;i<200;i++){
  const dirt=s.living.physiology.dirt;sim.tick(.1);
  if(s.living.behavior==='idle-groom'){found=true;assert.ok(s.living.physiology.dirt>=dirt);assert.equal(s.living.hygiene.groomSeconds,0);break;}
 }
 assert.ok(found);const copy=new EmbodiedLife(sim.serialize());
 sim.tick(.1);copy.tick(.1);assert.deepEqual(copy.serialize(),sim.serialize());
});
