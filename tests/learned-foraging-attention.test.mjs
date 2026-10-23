import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {RECEPTORS,senseEnvironment} from '../src/neural-controller.mjs';

const template=new EmbodiedLife(null,{seed:8401,learningMode:'neutral'}).state;
function setup(action='eat'){
  const s=structuredClone(template);s.home.food=0;s.needs.satiety=25;s.needs.energy=80;
  Object.assign(s.actor,{position:[0,2,0],heading:Math.PI/2,contact:false,velocity:[0,0,0]});
  Object.assign(s.living.physiology,{thirst:.1,sleepPressure:.2,dirt:.1,waste:.3});
  s.living.focus.action=action;s.living.behavior='flight';s.living.alert=0;s.living.surface.blocked=0;
  s.living.navigation.targetId=null;s.living.navigation.route=null;s.living.navigation.approach=null;
  return s;
}
function cues(learned=true){return [{id:'cue-left',kind:'neutral-odor',odor:'A',position:[-.65,2,0],intensity:.5,neuralValence:learned?.3:0},
  {id:'cue-right',kind:'neutral-odor',odor:'B',position:[.65,2,0],intensity:.5,neuralValence:learned?.2:0}];}
function encodedWorld(sense,s){
  const local=[0,1,2].map(axis=>RECEPTORS.reduce((sum,dir,i)=>sum+dir[axis]*sense.inputs[i],0)*.75/.28),h=s.actor.heading;
  return [local[0]*Math.cos(h)+local[2]*Math.sin(h),local[1],-local[0]*Math.sin(h)+local[2]*Math.cos(h)];
}
const sense=(s,neutralOdors)=>senseEnvironment(s,{feed:0,mist:0,chime:0},[],{neutralOdors});

test('a learned hungry food goal receives the existing goal attention level instead of exploration reversing its sensory direction',()=>{
  const s=setup(),rawOdorX=-3*.5*.3+3*.5*.2,recovery=.75;
  assert.ok(rawOdorX+.45*(1-recovery**3)>0,'The old free-exploration term reverses the actually learned leftward cue in this controlled fixture');
  const expected=rawOdorX+.04*(1-recovery**3),before=structuredClone(s),world=encodedWorld(sense(s,cues()),s);
  assert.ok(world[0]<0,'A learned goal must reduce undirected self-motion so that total sensation retains the cue direction');
  assert.ok(Math.abs(world[0]-expected)<1e-10);
  assert.deepEqual(s,before,'Attention changes sensory encoding, never pose, focus, physiology, q or navigation');
});

test('untrained and absent cues keep the exact previous free exploration term',()=>{
  for(const values of [cues(false),[]]){const s=setup(),world=encodedWorld(sense(s,values),s);
    assert.ok(Math.abs(world[0]-.45*(1-.75**3))<1e-10);}
});

test('non-food and urgent competing goals keep their previous sensory encoding',()=>{
  for(const action of ['drink','toilet']){
    const s=setup(action);s.living.physiology[action==='drink'?'thirst':'waste']=.95;
    assert.deepEqual(sense(s,cues()).inputs,sense(s,[]).inputs,'Urgent competing goals cannot be steered by remembered food cues');
  }
});
