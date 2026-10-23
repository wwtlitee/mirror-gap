import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createBehaviorFocus} from '../public/behavior-focus.mjs';
import {groomingEligible,screenEligible,sleepEligible,stationaryActivity} from '../public/behavior-policy.mjs';
import {resourceContact,resourceIntent} from '../public/resource-contact.mjs';
import {toiletAligned,toiletPose} from '../public/toilet-contact.mjs';
import {supportedFeet} from '../public/collision-world.mjs';
import {resolveBodyContacts} from '../public/environment-spec.mjs';
import {updateLiving} from '../src/living-world.mjs';

const motor={local:[0,0,0],drive:0,behavior:{grooming:1}};
const waterPosition=[-2.82,1.212,.56];
const foodPosition=[-3.1639194285063734,1.1351,2.1381941573310335];
function focused(action,position=waterPosition,zone='feed',sim=new EmbodiedLife()){
 const s=sim.state;
 Object.assign(s.actor,{position:[...position],heading:0,contact:true,velocity:[0,0,0],zoneId:zone,action:'observe'});
 s.living.contactSeconds=5;
 s.living.focus={...createBehaviorFocus(s.simSeconds),action};
 s.needs.energy=75;s.needs.satiety=75;
 Object.assign(s.living.physiology,{thirst:.5,waste:.2,dirt:.1,sleepPressure:.2});
 return s;
}

test('the current focus prevents eating or drinking just because a different resource is within reach',()=>{
 const s=focused('drink',foodPosition);s.needs.satiety=40;
 assert.ok(resourceContact(s.actor,'food'));
 assert.equal(resourceIntent(s),null);
 s.living.focus.action='eat';assert.equal(resourceIntent(s)?.kind,'food');
 s.actor.position=[...waterPosition];assert.ok(resourceContact(s.actor,'water'));
 assert.equal(resourceIntent(s),null);
 s.living.focus.action='drink';assert.equal(resourceIntent(s)?.kind,'water');
});

test('focused drinking still requires real contact and restores water gradually',()=>{
 const s=focused('drink'),before=s.living.physiology.thirst;
 assert.equal(stationaryActivity(s),'drink');
 updateLiving(s,motor,.1);
 assert.equal(s.living.behavior,'drink');
 assert.ok(s.living.physiology.thirst<before&&s.living.physiology.thirst>before-.01);
 s.actor.contact=false;
 const after=s.living.physiology.thirst;
 updateLiving(s,motor,.1);
 assert.notEqual(s.living.behavior,'drink');
 assert.ok(s.living.physiology.thirst>=after);
});

test('an unfinished drink resumes after its contact session expires below the starting threshold',()=>{
 const s=focused('drink');
 s.living.physiology.thirst=.1;s.living.behavior='flight';
 s.living.commitment=null;s.living.resourceSession=null;s.actor.contact=false;
 assert.equal(resourceIntent(s),null);
 s.actor.contact=true;s.living.contactSeconds=5;
 assert.equal(resourceIntent(s)?.kind,'water');
 const before=s.living.physiology.thirst;
 updateLiving(s,motor,.1);
 assert.equal(s.living.behavior,'drink');
 assert.ok(s.living.physiology.thirst<before);
});

test('an unfinished meal resumes real feeding above the ordinary starting satiety',()=>{
 const sim=new EmbodiedLife(),s=focused('eat',foodPosition,'feed',sim);
 s.needs.satiety=80;s.living.behavior='flight';s.actor.action='observe';
 s.living.commitment=null;s.living.resourceSession=null;s.actor.contact=false;
 assert.equal(resourceIntent(s),null);
 s.actor.contact=true;s.living.contactSeconds=5;
 assert.equal(resourceIntent(s)?.kind,'food');
 const before=s.needs.satiety;
 for(let i=0;i<30;i++)sim.tick(.02);
 assert.equal(s.actor.consumingResource?.kind,'food');
 assert.ok(s.needs.satiety>before);
});

test('an interrupted toilet focus resumes below its ordinary starting waste threshold',()=>{
 const s=focused('toilet',[4.39,.615,.38],'toilet');
 s.actor.heading=Math.PI/2;s.living.physiology.waste=.25;
 s.living.commitment=null;s.living.hygiene.toiletElapsed=0;s.living.behavior='flight';
 s.actor.contact=false;updateLiving(s,motor,.1);
 assert.equal(s.living.hygiene.toiletElapsed,0);
 s.actor.contact=true;s.living.contactSeconds=5;
 assert.equal(stationaryActivity(s),'toilet');
 const before=s.living.physiology.waste;
 for(let i=0;i<40;i++){s.simSeconds+=.1;updateLiving(s,motor,.1);}
 assert.equal(s.living.behavior,'toilet');
 assert.ok(s.living.physiology.waste<before);
 assert.equal(s.living.hygiene.bowelMovements,1);
});

test('an unfinished rest or cleaning focus can resume without requiring a fresh strong need',()=>{
 const s=focused('rest',[0,.615,0],'rest');
 s.needs.energy=80;s.living.sleep.cooldown=30;s.living.sleep.active=false;
 s.living.commitment=null;
 assert.equal(sleepEligible(s),true);
 s.actor.contact=false;assert.equal(sleepEligible(s),false);
 s.actor.contact=true;s.living.focus.action='clean';s.living.behavior='perch';
 s.living.physiology.dirt=.05;s.living.wetness=0;s.actor.groomingDrive=0;
 assert.equal(groomingEligible(s),true);
 s.living.alert=.5;assert.equal(groomingEligible(s),false);
});

test('ordinary cleaning and toileting do not start while drinking remains the focus',()=>{
 const s=focused('drink',[4.39,.615,.38],'toilet');
 s.living.physiology.waste=.8;
 assert.notEqual(stationaryActivity(s),'toilet');
 updateLiving(s,motor,.1);
 assert.notEqual(s.living.behavior,'toilet');
 assert.equal(s.living.hygiene.toiletElapsed,0);
 s.living.behavior='groom';s.living.physiology.dirt=.6;s.actor.groomingDrive=1;
 assert.equal(groomingEligible(s),false);
 assert.notEqual(stationaryActivity(s),'groom');
 s.actor.position=[...waterPosition];s.actor.zoneId='feed';s.living.physiology.thirst=0;
 updateLiving(s,motor,.1);
 assert.notEqual(s.living.behavior,'bathe');
 assert.equal(s.living.hygiene.bathSeconds,0);
});

test('a changed focus releases the game without waiting for the old engagement grace',()=>{
 const s=focused('play',[-1.2,1.405,-3.15],'work');
 assert.equal(screenEligible(s),true);
 Object.assign(s.living.workstation,{phase:'playing',elapsed:10});
 s.living.commitment={action:'play',resourceId:null,startedAt:s.simSeconds,lastProgressAt:s.simSeconds,bestScore:0};
 s.living.focus.action='drink';s.actor.contact=false;
 updateLiving(s,motor,.1);
 assert.equal(s.living.workstation.phase,'resting');
 assert.equal(s.living.workstation.elapsed,10);
 assert.notEqual(s.living.behavior,'play');
});

test('free exploration does not silently start an unrelated ordinary activity',()=>{
 const s=focused('explore');
 assert.equal(resourceIntent(s),null);
 updateLiving(s,motor,.1);
 assert.notEqual(s.living.behavior,'drink');
 s.actor.zoneId='rest';s.needs.energy=40;
 assert.equal(sleepEligible(s),false);
});

test('danger stops actions but exhaustion cannot create a second goal',()=>{
 const s=focused('drink');s.living.alert=.6;
 const thirst=s.living.physiology.thirst;
 updateLiving(s,motor,.1);
 assert.equal(s.living.behavior,'startle');
 assert.ok(s.living.physiology.thirst>=thirst);
 s.living.alert=0;s.needs.energy=0;s.actor.zoneId='flight';
 s.actor.position=[0,.125,0];
 assert.equal(sleepEligible(s),false);
 s.actor.contact=false;assert.equal(sleepEligible(s),false);
});

test('states without a focus preserve the existing contact rules',()=>{
 const s=focused('drink');delete s.living.focus;
 assert.equal(resourceIntent(s)?.kind,'water');
 s.actor.zoneId='rest';s.needs.energy=40;
 assert.equal(sleepEligible(s),true);
 s.actor.contact=false;assert.equal(resourceIntent(s),null);
});

test('a toilet focus allows local alignment before real elimination without an escape detour',()=>{
 const sim=new EmbodiedLife(),s=sim.state;
 Object.assign(s.actor,{position:[3.96,.6851,.425],heading:0,contact:true,velocity:[0,0,0],zoneId:'toilet',action:'observe'});
 s.living.focus={...createBehaviorFocus(s.simSeconds),action:'toilet'};
 s.living.physiology.waste=1;
 assert.equal(toiletPose(s.actor),null);
 assert.equal(supportedFeet(s.actor.position,s.actor.heading),6);
 const corrected=[...s.actor.position];resolveBodyContacts(corrected,[0,0,0],s.actor.heading);
 assert.ok(Math.hypot(...corrected.map((value,index)=>value-s.actor.position[index]))<.003);
 assert.equal(stationaryActivity(s),'toilet');
 const start=[...s.actor.position];
 for(let i=0;i<180;i++)sim.tick(.1);
 assert.ok(s.living.hygiene.bowelMovements>0,'physical adjustment must finish before elimination');
 assert.ok(toiletAligned(s.actor));
 assert.ok(Math.hypot(s.actor.position[0]-start[0],s.actor.position[2]-start[2])>.02);
 assert.equal(s.living.escape.attempts,0,'a supported local adjustment must not need a flight away and retry');
});
