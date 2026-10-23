import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';
import {growthSummary} from '../public/companion-growth.mjs';
import {FOOD_IDS,withFoodStock} from '../public/food-stock.mjs';
import {resourceLandingPoses} from '../public/resource-landing.mjs';
import {resourceContact,nearestResource} from '../public/resource-contact.mjs';
import {createMirrorGapCharacter} from '../public/character.mjs';
import {createCare} from '../public/pet-care.mjs';

for(const hour of [12,23])for(const amount of [100,12.5])test(`newborn really feeds on banana at hour ${hour} with ${amount}% stock`,()=>{
  const sim=new EmbodiedLife(),s=sim.state;
  s.companion=createCompanion({id:'banana-contact',seed:'banana-contact',now:1});adoptCompanion(s.companion,'banana-contact',2);
  const scale=growthSummary(s.companion).bodyScale;
  s.living.care=createCare();
  s.living.care.foods=Object.fromEntries(FOOD_IDS.map(id=>[id,id==='banana'?amount:100]));
  s.living.clock={mode:'preview',hour,anchor:0};
  const pose=withFoodStock(s,()=>resourceLandingPoses('banana',scale)[0]);assert.ok(pose,'real shared mesh supplies a stable landing');
  Object.assign(s.actor,structuredClone(pose),{zoneId:'feed',mode:'activity',velocity:[0,0,0]});
  s.needs.satiety=25;s.living.physiology.thirst=.1;s.living.contactSeconds=4;
  let eating=0;
  for(let tick=0;tick<200;tick++){
    sim.tick(.02);
    if(s.actor.action==='eat'){
      eating++;
      assert.equal(withFoodStock(s,()=>resourceContact(s.actor,'food')?.id),'banana');
    }
  }
  assert.equal(sim.neural.error,null);assert.ok(eating>150,'continuous real neural output sustains feeding');
  assert.ok(s.needs.satiety>27);assert.ok(s.living.care.foods.banana<amount,'actual stock is consumed');
  assert.equal(s.actor.consumingResource?.id,'banana');
  const metrics=bodyMetrics(s.actor);
  assert.ok(Math.hypot(...s.actor.position.map((value,index)=>value-pose.position[index]))<metrics.radius*.5,'body stays planted under gravity');
  const character=createMirrorGapCharacter();
  try{
    character.root.position.set(...s.actor.position);character.root.rotation.y=s.actor.heading;character.root.scale.setScalar(metrics.characterScale);
    withFoodStock(s,()=>{
      character.update({...s.actor,behavior:s.living.behavior,contactSeconds:4},.1);
      assert.ok(character.root.userData.pose.feet.every(foot=>foot.supported),'all visible feet remain supported');
      assert.ok(nearestResource(character.root.userData.pose.feedingTip,'food',{id:'banana'}).distance<1e-7,'visible mouth meets the edible skin');
    });
  }finally{character.dispose();}
});
