import test from 'node:test';
import assert from 'node:assert/strict';
import {senseLocalObstacles,BODY_OFFSETS,BODY_RADIUS} from '../public/environment-spec.mjs';
import {meshClearance} from '../public/collision-world.mjs';

const trapped=()=>({position:[3.8930556964,.3851,.325120334],heading:2.84476106,contact:true});

test('actual mushroom and leaf gap is detected across the full body envelope',()=>{
  const actor=trapped(),before=structuredClone(actor),cue=senseLocalObstacles(actor);
  assert.ok(meshClearance(actor.position,.2).distance>=BODY_RADIUS);
  assert.equal(cue.blocked,true);
  assert.equal(cue.blockedAbove,true);
  assert.ok(cue.clearance<0,'a body end is squeezed although the centre is clear');
  assert.ok(cue.escape[0]<-.5 && cue.escape[2]>.5,'the open corridor is west and forward in world z');
  assert.equal(cue.escape[1],0,'an obstructed ceiling must not invite upward escape');
  assert.ok(cue.turn<-.2 && cue.turn>-.8,'the body can align with the gap by a small turn');
  assert.deepEqual(actor,before,'sensing must never change actor state');

  const facing=actor.heading+cue.turn;
  for(const distance of [.07,.14,.20])for(const offset of BODY_OFFSETS){
    const point=[actor.position[0]+cue.escape[0]*distance+Math.sin(facing)*offset,
      actor.position[1],actor.position[2]+cue.escape[2]*distance+Math.cos(facing)*offset];
    const surface=meshClearance(point,.2);
    assert.ok(!surface || surface.distance>=BODY_RADIUS-.002,'the indicated corridor fits every body sphere');
  }
});

test('unobstructed air and supported floor do not produce escape cues',()=>{
  for(const position of [[0,3,0],[0,.1251,.75]]){
    const cue=senseLocalObstacles({position,heading:0,contact:position[1]<1});
    assert.equal(cue.blocked,false);
    assert.equal(cue.blockedAbove,false);
    assert.deepEqual(cue.escape,[0,0,0]);
    assert.equal(cue.turn,0);
  }
});

test('invalid inputs remain finite and sensory results are deterministic',()=>{
  assert.deepEqual(senseLocalObstacles(trapped()),senseLocalObstacles(trapped()));
  for(const actor of [null,{position:'abc',heading:0},{position:[NaN,0,0],heading:0},{position:[0,1],heading:0},{position:[0,1,0],heading:Infinity}]){
    const cue=senseLocalObstacles(actor);
    assert.equal(cue.blocked,false);
    assert.ok([...cue.escape,cue.turn,cue.strength,cue.clearance].every(Number.isFinite));
  }
});
