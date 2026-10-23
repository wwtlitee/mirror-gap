import test from 'node:test';
import assert from 'node:assert/strict';
import {createBehaviorFocus,updateBehaviorFocus,demandScores,validateBehaviorFocus} from '../public/behavior-focus.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';

function fixture() {
  return {simSeconds:0, actor:{contact:false,zoneId:'flight'}, home:{food:100,water:100},
    needs:{satiety:90,energy:80,curiosity:20,comfort:90}, living:{focus:createBehaviorFocus(),
      physiology:{thirst:.8,sleepPressure:.1,dirt:.1,waste:.1}, wetness:0,sleep:{active:false},
      workstation:{enabled:true,cooldown:0}, regions:{garden:{}},navigation:{targetId:null}}};
}
function advance(s, seconds, signals = []) {
  for(let i=0;i<Math.round(seconds/.1);i++){s.simSeconds+=.1;updateBehaviorFocus(s,signals,.1);}
}
test('a severe low score dominates optional cues without counting duplicate resources as extra needs',()=>{
  const s=fixture();s.needs.curiosity=100;s.living.physiology.thirst=.95;
  const cue={id:'screen',intensity:100};
  assert.deepEqual(demandScores(s,[cue]),demandScores(s,[cue,cue,cue]));
  advance(s,3,[cue]);assert.equal(s.living.focus.action,'drink');validateBehaviorFocus(s.living.focus);
});
test('isolated strong impulses and alternating similar needs do not repeatedly switch activity',()=>{
  const s=fixture();advance(s,3);assert.equal(s.living.focus.action,'drink');
  for(let i=0;i<100;i++){s.needs.satiety=i%2?19:90;advance(s,.1,[{id:'fruit',resourceKind:'food',intensity:100}]);}
  assert.equal(s.living.focus.action,'drink');assert.equal(s.living.focus.changes,1);
});
test('a stronger secondary need waits until the current drink is complete',()=>{
 const s=fixture();advance(s,3);s.living.physiology.thirst=.4;s.needs.satiety=0;
 advance(s,30);assert.equal(s.living.focus.action,'drink');assert.equal(s.living.focus.candidate,'eat');
 s.living.physiology.thirst=0;advance(s,1);assert.equal(s.living.focus.action,'eat');
});
test('completing a need discards its earlier strong evidence and lets a new need win',()=>{
  const s=fixture();advance(s,3);s.living.physiology.thirst=0;s.needs.satiety=35;
  advance(s,.1);assert.notEqual(s.living.focus.action,'drink');assert.equal(s.living.focus.scores.drink,0);
  advance(s,8);assert.equal(s.living.focus.action,'eat');
});
test('depleted energy cannot inject a second goal into an unfinished meal',()=>{
 const s=fixture();s.needs.satiety=0;s.living.physiology.thirst=1;advance(s,8);
 assert.equal(s.living.focus.action,'eat');s.needs.energy=0;advance(s,20);assert.equal(s.living.focus.action,'eat');
 s.needs.satiety=100;advance(s,1);assert.equal(s.living.focus.action,'rest');
});
test('travel and partial recovery never count as goal completion',()=>{
 const s=fixture();s.needs.satiety=0;s.living.physiology.thirst=1;advance(s,20);
 for(const satiety of [1,15,35,60,90,99]){s.needs.satiety=satiety;advance(s,20);assert.equal(s.living.focus.action,'eat');}
 s.needs.satiety=100;advance(s,1);assert.equal(s.living.focus.action,'drink');
});
test('focus filters and pending switch survive checkpoints, corrupt values are rejected',()=>{
  const sim=new EmbodiedLife(),s=sim.state;advance(s,3);s.needs.satiety=2;advance(s,.2);
  const restored=new EmbodiedLife(sim.serialize());assert.deepEqual(restored.state.living.focus,s.living.focus);
  const bad=sim.serialize();bad.living.focus.scores.drink=NaN;assert.throws(()=>new EmbodiedLife(bad),/focus checkpoint/);
  const legacy=sim.serialize();delete legacy.living.focus;assert.equal(new EmbodiedLife(legacy).state.living.focus.action,null);
});

 test('selected rest crosses old recovery thresholds and completes both rest meters',()=>{
 const s=fixture();s.actor.zoneId='rest';s.needs.energy=0;s.needs.satiety=0;s.living.physiology.thirst=1;advance(s,1);
 for(const energy of [11,12,15,35,75,100]){s.needs.energy=energy;advance(s,5);assert.equal(s.living.focus.action,'rest');}
 s.living.physiology.sleepPressure=0;advance(s,1);assert.ok(['eat','drink'].includes(s.living.focus.action));assert.equal(s.living.focus.changes,2);
});

test('all simultaneous deficits keep the selected main goal and expose a secondary candidate',()=>{
 for(const action of ['eat','drink','toilet']){
 const s=fixture();s.needs.energy=40;s.needs.satiety=0;s.living.physiology.thirst=1;s.living.physiology.waste=1;s.living.focus.action=action;
 for(let i=0;i<60;i++){advance(s,1,[{id:i%2?'nest':'toilet',intensity:100}]);assert.equal(s.living.focus.action,action);assert.notEqual(s.living.focus.candidate,action);}
 }
});
test('resource exhaustion releases a goal without treating it as successful completion',()=>{
 const s=fixture();s.needs.satiety=0;advance(s,3);assert.equal(s.living.focus.action,'eat');
 s.home.food=0;advance(s,1);assert.equal(s.living.focus.action,'drink');assert.equal(s.needs.satiety,0);
});
