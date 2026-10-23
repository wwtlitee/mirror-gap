import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {rememberInteraction,cueResponse} from '../public/companion-learning.mjs';
test('paired chime changes real sensory direction during exploration but never steals a physiological goal',()=>{
  const sim=new EmbodiedLife(),s=sim.state;s.companion=createCompanion();adoptCompanion(s.companion,'回声');
  s.companion.activeSeconds=1000;Object.assign(s.needs,{satiety:90,energy:90});Object.assign(s.living.physiology,{thirst:.1,waste:.1,sleepPressure:.1});
  s.living.focus.action='explore';s.living.behavior='flight';s.living.navigation.targetId=null;
  const source={id:'bell',kind:'vibration',position:[2,2.2,1],zone:'entry',range:20};
  const pulse={feed:0,mist:0,chime:1};
  const naive=senseEnvironment(s,pulse,[source]);
  Object.assign(s.companion.development.cues.chime,{association:.7,paired:5,lastAt:900});rememberInteraction(s,'chime');
  assert.ok(cueResponse(s)>0);
  const learned=senseEnvironment(s,pulse,[source]);assert.notDeepEqual(learned.inputs,naive.inputs);
  s.living.focus.action='drink';assert.equal(cueResponse(s),0);
  s.living.focus.action='explore';s.needs.satiety=10;assert.equal(cueResponse(s),0);
});
