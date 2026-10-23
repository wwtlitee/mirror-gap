import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {demandScores,updateBehaviorFocus} from '../public/behavior-focus.mjs';
import {updateNavigation} from '../public/navigation-attention.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {learnedForagingAvailable} from '../public/learned-foraging.mjs';

const retainedFixture=JSON.parse(readFileSync(new URL('./fixtures/learned-foraging-8.4.0.json',import.meta.url)));

let template;
function state(){
  template??=new EmbodiedLife(null,{seed:8401,learningMode:'neutral'}).state;
  const s=structuredClone(template);s.home.food=0;s.needs.satiety=25;s.needs.energy=80;
  s.living.physiology={...s.living.physiology,waste:.3,thirst:.15,sleepPressure:.2,dirt:.1};
  s.living.focus.action='eat';s.simSeconds=12;return s;
}
const cue=(valence=.6)=>({id:'cue-left',kind:'neutral-odor',odor:'A',position:[-1,1,0],distance:1,
  intensity:.5,neuralValence:valence});

test('a hungry individual can keep food-seeking from an actually learned neutral odor with no food present',()=>{
  const s=state(),before=structuredClone(s.actor),scores=demandScores(s,[cue()]);
  assert.ok(scores.eat>0,'Learned sensory evidence must keep hunger eligible without inventing an edible resource');
  updateBehaviorFocus(s,[cue()],1);
  assert.equal(s.living.focus.action,'eat');assert.deepEqual(s.actor,before);
  assert.equal(s.home.food,0);
});

test('an untrained, absent, aversive or malformed cue supplies no food-seeking affordance',()=>{
  for(const signals of [[],[cue(0)],[cue(-.5)],[{...cue(),kind:'odor'}],[{...cue(),neuralValence:NaN}],
    [{...cue(),intensity:0}],[{...cue(),odor:'pizza'}]])assert.equal(demandScores(state(),signals).eat,0);
  const fed=state();fed.needs.satiety=80;assert.equal(demandScores(fed,[cue()]).eat,0);
});

test('learned foraging retires an exhausted food route without assigning the neutral odor as a navigation target',()=>{
  const s=state();s.living.navigation.targetId='resource-pizza';
  s.living.navigation.route={status:'ready',targetId:'resource-pizza',waypoints:[[1,1,1]],direction:[1,0,0],index:0};
  updateNavigation(s,[cue()],1);
  assert.equal(s.living.navigation.targetId,null);assert.equal(s.living.navigation.route,null);
  assert.equal(s.living.navigation.approach,null);
});

test('urgent water and toilet needs preempt the learned food-seeking intent',()=>{
  for(const [key,value,action] of [['thirst',.95,'drink'],['waste',.95,'toilet']]){
    const s=state();s.living.physiology[key]=value;
    assert.equal(demandScores(s,[cue()]).eat,0);
    updateBehaviorFocus(s,[cue()],1);assert.equal(s.living.focus.action,action);
  }
});

test('a stale food route cannot mute a hungry learned cue in original neural senses',()=>{
  const s=state();s.actor.position=[0,1,0];s.actor.contact=false;s.living.behavior='flight';
  s.living.navigation.targetId='resource-pizza';
  s.living.navigation.route={status:'ready',targetId:'resource-pizza',waypoints:[[1,1,1]],direction:[1,0,0],index:0};
  const learned=senseEnvironment(s,{feed:0,mist:0,chime:0},[],{neutralOdors:[cue()]});
  const erased=senseEnvironment(s,{feed:0,mist:0,chime:0},[],{neutralOdors:[cue(0)]});
  assert.equal(learned.context.neutralCueProjected,true);
  assert.notDeepEqual(learned.inputs,erased.inputs);
  assert.equal(s.living.navigation.targetId,'resource-pizza','Sensing itself must not mutate navigation');
});

test('the affordance is driven by the actual MBON readout of retained pilot q, with an exact q=1 negative control',()=>{
  const sim=new EmbodiedLife(null,{seed:8401,learningMode:'neutral'}),s=state(),learning=sim.neural.learning;
  learning.setCues([{id:'cue-A',odor:'A',position:[...s.actor.position],strength:1,range:1.2}]);
  assert.equal(learnedForagingAvailable(s,learning.sense(s)),false);
  learning.restoreWeights({...learning.serializeWeights(),efficacy:retainedFixture.trainedWeights});
  const signals=learning.sense(s);
  assert.ok(signals[0].neuralValence>0);assert.equal(learnedForagingAvailable(s,signals),true);
  assert.equal(signals[0].resourceKind,undefined);assert.equal(signals[0].resourceId,undefined);
});

test('q=1 with and without neutral cues preserves the complete prechange 20ms body and original-brain trajectory',()=>{
  const baseline=retainedFixture.q1Trajectory;
  for(const kind of ['none','A']){
    const sim=new EmbodiedLife(null,{seed:8401,learningMode:'neutral'});
    sim.neural.learning.frozen=true;sim.neural.learning.rewardEnabled=false;sim.state.needs.satiety=25;sim.state.home.food=0;
    if(kind==='A')sim.neural.learning.setCues([{id:'cue-A',odor:'A',position:[1,1,1],strength:1,range:1.2}]);
    const samples=[];
    for(let i=0;i<baseline.steps;i++){sim.tick(baseline.step);const s=sim.state,n=sim.neural,b=n.serialize();
      samples.push(structuredClone({position:s.actor.position,velocity:s.actor.velocity,heading:s.actor.heading,
        focus:s.living.focus,navigation:s.living.navigation,motor:n.motor,
        brain:{rng:b.rng,step:b.step,v:b.v,g:b.g,ref:b.ref,queue:b.queue,pending:b.pending}}));}
    assert.equal(createHash('sha256').update(JSON.stringify(samples)).digest('hex'),baseline.cases[kind]);
  }
});
