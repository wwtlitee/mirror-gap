import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createBehaviorFocus} from '../public/behavior-focus.mjs';
import {NEWBORN_LENGTH,MATURE_LENGTH,LEGACY_LENGTH} from '../public/companion-growth.mjs';
import {toiletRimStations,toiletAligned} from '../public/toilet-contact.mjs';
import {updateToiletManeuver,toiletManeuverActive,toiletManeuverMotion,toiletManeuverProgressing,toiletManeuverReady} from '../public/toilet-maneuver.mjs';
import {updateBodyNeeds} from '../public/body-needs.mjs';
import {updateLiving} from '../src/living-world.mjs';
import {updateEscape} from '../public/escape-reflex.mjs';
import {supportedFeet} from '../public/collision-world.mjs';
import {moveBody,resolveBodyContacts} from '../public/environment-spec.mjs';

const stages=[['newborn',NEWBORN_LENGTH/LEGACY_LENGTH],['mature',MATURE_LENGTH/LEGACY_LENGTH]];
const zeroMotor={local:[0,0,0],drive:0};
function fixture(scale,{position='inner',heading='out',phase=null}={}){
  const controller={motor:structuredClone(zeroMotor),behavior:{feeding:0,grooming:0},sensory:{context:{},signals:[]},tick(){}};
  const sim=new EmbodiedLife(null,{controller}),s=sim.state,station=toiletRimStations(scale)[0];
  assert.ok(station,'the actual collision mesh must offer a rim station');
  Object.assign(s.actor,{bodyScale:scale,position:[...(position==='entry'?station.entry:station.position)],heading:heading==='in'?station.walkHeading:station.heading,velocity:[0,0,0],contact:true,supportFeet:6,zoneId:'toilet',action:'observe'});
  assert.ok(supportedFeet(s.actor.position,s.actor.heading,s.actor)>=3,'fixture has genuine mesh support');
  Object.assign(s.needs,{energy:90,satiety:90,comfort:90,curiosity:10});
  Object.assign(s.living.physiology,{waste:.8,thirst:.1,dirt:.1,sleepPressure:.1});
  s.living.focus={...createBehaviorFocus(s.simSeconds),action:'toilet'};s.living.contactSeconds=2;s.living.behavior='perch';
  if(phase)s.living.toiletManeuver={phase,stationId:station.id,startedAt:s.simSeconds,phaseAt:s.simSeconds,lastProgressAt:s.simSeconds,bestDistance:null,recorded:false};
  return {sim,s,station};
}
function requestedElimination(s,seconds){
  for(let i=0;i<Math.round(seconds/.02);i++){
    s.simSeconds+=.02;
    // Deliberately inject an old true caller flag: the final metabolism gate
    // must still reject an invalid phase, orientation or physical contact.
    updateBodyNeeds(s,{atWater:false,drinking:false,resting:false,bathing:false,toileting:true},.02);
  }
}
function actualLocalStep(s,dt=.02){
  s.simSeconds+=dt;updateToiletManeuver(s,dt);
  const motion=toiletManeuverMotion(s);
  if(motion){
    const angle=Math.atan2(Math.sin(motion.heading-s.actor.heading),Math.cos(motion.heading-s.actor.heading));
    s.actor.heading+=Math.max(-2*dt,Math.min(2*dt,angle));s.actor.velocity=[...motion.velocity];
    const support=moveBody(s.actor.position,s.actor.velocity,dt,s.actor.heading,undefined,undefined,s.actor);
    const resolved=resolveBodyContacts(s.actor.position,s.actor.velocity,s.actor.heading,undefined,undefined,s.actor)??support;
    s.actor.supportFeet=resolved?supportedFeet(s.actor.position,s.actor.heading,s.actor):0;
    s.actor.contact=Boolean(resolved)&&s.actor.supportFeet>=3;
  }
  updateEscape(s,{local:[0,0,.2],drive:.3},toiletManeuverActive(s)?'toilet':null,dt);
}

for(const [name,scale] of stages){
  test(name+' air, stale foot counts and a wrong heading cannot eliminate even with a stale true request',()=>{
    for(const invalid of ['air','wrong-heading']){
      const {s}=fixture(scale,{phase:'eliminate'});assert.ok(toiletAligned(s.actor));
      if(invalid==='air'){s.actor.contact=false;s.actor.supportFeet=6;}else s.actor.heading+=Math.PI;
      const waste=s.living.physiology.waste;requestedElimination(s,4);
      assert.equal(s.living.hygiene.bowelMovements,0,invalid);
      assert.equal(s.living.hygiene.toiletElapsed,0,invalid);
      assert.ok(s.living.physiology.waste>=waste,invalid+' cannot reduce waste');
    }
  });

  test(name+' all non-elimination phases reject discharge despite an already aligned physical stance',()=>{
    for(const phase of ['approach','land','walk','turn','leave','done','failed']){
      const {s}=fixture(scale,{phase});assert.ok(toiletAligned(s.actor));
      assert.equal(toiletManeuverReady(s),false,phase);
      requestedElimination(s,4);
      assert.equal(s.living.hygiene.bowelMovements,0,phase);
      assert.equal(s.living.hygiene.toiletElapsed,0,phase);
      assert.ok(s.living.physiology.waste>=.8,phase);
    }
  });

  test(name+' a brief loss of support pauses elimination without double-counting the same session',()=>{
    const {s}=fixture(scale,{phase:'eliminate'});
    requestedElimination(s,3.4);assert.equal(s.living.hygiene.bowelMovements,1);assert.equal(s.living.toiletManeuver.recorded,true);
    const waste=s.living.physiology.waste;s.actor.contact=false;s.actor.supportFeet=0;requestedElimination(s,.3);
    assert.equal(s.living.hygiene.toiletElapsed,0);assert.ok(s.living.physiology.waste>=waste);
    s.actor.contact=true;s.actor.supportFeet=supportedFeet(s.actor.position,s.actor.heading,s.actor);
    requestedElimination(s,4);assert.equal(s.living.hygiene.bowelMovements,1,'one session may resume without a second pellet record');
  });

  test(name+' real supported inward steps and turning reach elimination without an escape override',()=>{
    const {s}=fixture(scale,{position:'entry',heading:'in'}),start=[...s.actor.position];
    const phases=[];let progressObservations=0;
    for(let i=0;i<700&&s.living.toiletManeuver?.phase!=='eliminate';i++){
      actualLocalStep(s);
      const phase=s.living.toiletManeuver?.phase;if(phases.at(-1)!==phase)phases.push(phase);
      if(toiletManeuverProgressing(s))progressObservations++;
      assert.notEqual(phase,'failed',JSON.stringify({phase,position:s.actor.position,heading:s.actor.heading}));
      assert.equal(s.living.escape.attempts,0);
    }
    assert.ok(phases.includes('walk')&&phases.includes('turn')&&phases.at(-1)==='eliminate',JSON.stringify(phases));
    assert.ok(Math.hypot(...s.actor.position.map((v,i)=>v-start[i]))>.01,'actual movement, not just a phase change');
    assert.ok(progressObservations>10);assert.ok(toiletAligned(s.actor));
    assert.equal(s.living.hygiene.bowelMovements,0,'movement alone does not run metabolism');
  });

  test(name+' a blocked walk loses its progress exemption and releases local control within a bounded time',()=>{
    const {s}=fixture(scale,{position:'entry',heading:'in',phase:'walk'}),before=[...s.actor.position];
    updateToiletManeuver(s,.02);assert.equal(toiletManeuverProgressing(s),true);
    for(let i=0;i<46;i++){
      s.simSeconds+=.1;updateToiletManeuver(s,.1);
      updateEscape(s,{local:[0,0,.5],drive:.5},toiletManeuverActive(s)?'toilet':null,.1);
      if(i>=22)assert.equal(toiletManeuverProgressing(s),false,'elapsed time is not physical progress');
    }
    assert.deepEqual(s.actor.position,before,'controller does not teleport a blocked actor');
    assert.equal(s.living.toiletManeuver.phase,'failed');assert.equal(toiletManeuverActive(s),false);
    assert.equal(toiletManeuverMotion(s),null);assert.equal(toiletManeuverReady(s),false);
  });

  test(name+' repeated retries at the same unmoving pose cannot continually reset confinement detection',()=>{
    const {s}=fixture(scale,{position:'entry',heading:'in'}),before=[...s.actor.position];
    for(let i=0;i<600&&s.living.escape.attempts===0;i++){
      s.simSeconds+=.1;updateToiletManeuver(s,.1);
      // The blocked actor never executes the requested footfall. Only real
      // displacement/turning may earn another progress exemption.
      updateEscape(s,{local:[0,0,.5],drive:.5},toiletManeuverActive(s)?'toilet':null,.1);
    }
    assert.deepEqual(s.actor.position,before);
    assert.ok(s.living.escape.attempts>0,JSON.stringify({time:s.simSeconds,maneuver:s.living.toiletManeuver,escape:s.living.escape}));
  });

  test(name+' alarm and a changed high-level goal immediately release every preparatory local phase',()=>{
    for(const phase of ['land','walk','turn','eliminate'])for(const reason of ['alarm','goal']){
      const {s}=fixture(scale,{phase}),before=structuredClone(s.actor);
      if(reason==='alarm')s.living.alert=.7;else s.living.focus.action='drink';
      updateToiletManeuver(s,.02);
      assert.equal(s.living.toiletManeuver,null,phase+' '+reason);assert.equal(toiletManeuverActive(s),false);
      assert.equal(toiletManeuverMotion(s),null);assert.deepEqual(s.actor,before,'release itself cannot reposition the body');
      const waste=s.living.physiology.waste;
      for(let i=0;i<200;i++){s.simSeconds+=.02;updateLiving(s,{...zeroMotor,behavior:{grooming:0}},.02);}
      assert.equal(s.living.hygiene.bowelMovements,0);assert.ok(s.living.physiology.waste>=waste);
    }
  });

  test(name+' a depleted body may preempt the short leave motion',()=>{
    for(const urgent of ['hunger','thirst','energy']){
      const {s}=fixture(scale,{phase:'leave'});s.living.physiology.waste=0;
      if(urgent==='hunger')s.needs.satiety=5;else if(urgent==='thirst')s.living.physiology.thirst=.98;else s.needs.energy=5;
      updateToiletManeuver(s,.02);assert.equal(s.living.toiletManeuver,null,urgent);assert.equal(toiletManeuverMotion(s),null,urgent);
    }
  });

  test(name+' the complete physical/metabolic cycle counts once, leaves and cannot immediately return',()=>{
    const {sim,s,station}=fixture(scale,{position:'entry',heading:'in'}),phases=[];let completedAt=null;
    for(let i=0;i<3000;i++){
      const before=[...s.actor.position],waste=s.living.physiology.waste;sim.tick(.02);
      const phase=s.living.toiletManeuver?.phase;if(phases.at(-1)!==phase)phases.push(phase);
      assert.equal(s.living.escape.attempts,0,JSON.stringify({phase,position:s.actor.position}));
      assert.ok(Math.hypot(...s.actor.position.map((v,j)=>v-before[j]))<.01,'one 20 ms step cannot jump between rim stations');
      if(s.living.physiology.waste<waste-1e-8){assert.ok(s.actor.contact);assert.ok(toiletAligned(s.actor));assert.equal(phase,'eliminate');}
      if(s.living.activityCooldowns?.toilet>s.simSeconds&&completedAt===null)completedAt=s.simSeconds;
      if(completedAt!==null&&s.simSeconds-completedAt>5)break;
    }
    assert.ok(completedAt!==null,'waste must reach the ordinary completion threshold');
    assert.ok(phases.includes('walk')&&phases.includes('turn')&&phases.includes('eliminate')&&phases.includes('leave'),JSON.stringify(phases));
    assert.equal(s.living.hygiene.bowelMovements,1);assert.ok(s.living.physiology.waste<.015);
    assert.ok(Math.hypot(s.actor.position[0]-station.entry[0],s.actor.position[2]-station.entry[2])<.004,'leave returns to the broad outer seat');
    assert.notEqual(s.living.toiletManeuver?.phase,'eliminate');assert.notEqual(s.living.behavior,'toilet');
    for(let i=0;i<250;i++)sim.tick(.02);
    assert.equal(s.living.hygiene.bowelMovements,1);assert.ok(s.living.activityCooldowns.toilet>s.simSeconds);
    assert.notEqual(s.living.toiletManeuver?.phase,'eliminate');
  });
}
