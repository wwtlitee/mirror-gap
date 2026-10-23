import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {RESOURCE_DEFINITIONS} from '../public/resource-spec.mjs';
import {createResourceIndex,resourceContact,nearestResource,resourceIntent} from '../public/resource-contact.mjs';
import {createMirrorGapCharacter} from '../public/character.mjs';
// Apple, banana and fries use verified six-foot landings on the v8.1.0c food contours.
const stances=[{"id":"apple","position":[-3.1874151621111615,1.2754599002118072,1.2610225787547757],"heading":0.25839221306456966},{"id":"banana","position":[-3.01222381526149,1.3590130174789878,1.7106751467150032],"heading":-1.7103630065546365},{"id":"burger","position":[-4.262744531541296,1.1350999301722935,0.1982195119557026],"heading":0.39269908169872414},{"id":"pizza","position":[-3.1639194285063734,1.1351,2.1381941573310335],"heading":0},{"id":"fries","position":[-3.576562746788899,1.4795124922862486,1.1672835255371852],"heading":-1.5007594151475958},{"id":"sandwich","position":[-4.370064652773559,1.1100999999999999,1.6500019081547754],"heading":0.39269908169872414},{"id":"fig","position":[-3.6044708620622203,1.2543688807724986,2.2979555591140874],"heading":2.5417009034726936},{"id":"water-bowl","position":[-2.82,1.212,0.56],"heading":0},{"id":"shallow-pool","position":[4.18,0.3851,2.7800000000000002],"heading":0}];
for(const stance of stances)test('real neural contact and visible mouth: '+stance.id,()=>{
 const resource=RESOURCE_DEFINITIONS.find(r=>r.id===stance.id),sim=new EmbodiedLife();
 Object.assign(sim.state.actor,{position:[...stance.position],heading:stance.heading,contact:true,velocity:[0,0,0],zoneId:resource.zone,mode:'activity'});
 sim.state.needs.satiety=resource.kind==='food'?25:85;sim.state.living.physiology.thirst=resource.kind==='water'?.8:.1;sim.state.living.contactSeconds=4;
 for(let i=0;i<200;i++)sim.tick(.02);
 const a=sim.state.actor;assert.equal(a.consumingResource?.id,resource.id);assert.equal(resourceContact(a,resource.kind)?.id,resource.id);
 if(resource.kind==='food')assert.ok(sim.state.needs.satiety>27);else assert.ok(sim.state.living.physiology.thirst<.75);
 const c=createMirrorGapCharacter();try{c.root.position.set(...a.position);c.root.rotation.y=a.heading;c.root.scale.setScalar(.22);c.update({...a,behavior:sim.state.living.behavior,contactSeconds:4},.1);
 assert.ok(nearestResource(c.root.userData.pose.feedingTip,resource.kind,{id:resource.id}).distance<1e-7);assert.ok(c.root.userData.pose.feet.every(f=>f.supported));assert.ok(c.root.userData.pose.feedingLength<=.088001);}finally{c.dispose();}
 if(process.env.WRITE_RESOURCE_FIXTURES)fs.writeFileSync('output/resources-v5.7.0/'+resource.id+'.json',JSON.stringify(sim.serialize()));
});
test('arbitrary resource IDs and positions are usable without a privileged zone',()=>{
 const index=createResourceIndex([{id:'new-dish',label:'新食物',kind:'food',zone:'garden',faces:[8,2,8,9,2,8,8,2,9]}]);
 const a={position:[8.2,2.08,8.2],heading:0,contact:true,zoneId:'flight'};
 assert.equal(index.contact(a,'food')?.id,'new-dish');assert.equal(index.contact({...a,contact:false},'food'),null);assert.equal(index.contact(a,'water'),null);
 assert.equal(index.signals[0].resourceKind,'food');assert.throws(()=>createResourceIndex([{id:'bad',kind:'food',faces:[NaN]}]));
});
test('blocked bowl side cannot be drunk through or cause a permanent drinking hold',()=>{
 const sim=new EmbodiedLife();Object.assign(sim.state.actor,{position:[-3.168836734801735,1.1101,.21408342436904182],heading:.8,contact:true,zoneId:'feed'});sim.state.needs.satiety=90;sim.state.living.physiology.thirst=.9;
 assert.equal(resourceContact(sim.state.actor,'water'),null);assert.equal(resourceIntent(sim.state),null);
});
