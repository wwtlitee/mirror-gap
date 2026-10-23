import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {rememberInteraction,observeCompanion,interactionSummary} from '../public/companion-learning.mjs';
import {recordHabit,developmentSummary} from '../public/companion-development.mjs';
import {habitEvidence,careObservationText} from '../public/companion-evidence.mjs';
function state(){const companion=createCompanion();adoptCompanion(companion,'验收豆');return {companion,paused:false,simSeconds:0,needs:{satiety:60,comfort:85,energy:80},actor:{contact:false,zoneId:'flight',consumingResource:null},living:{alert:0,wetness:0,behavior:'flight',focus:{action:null},escape:{phase:'calm'},sleep:{active:false},physiology:{thirst:.2,sleepPressure:.2,waste:.2,dirt:.1},care:{rain:0,wind:0,footstep:0,weakness:0},workstation:{phase:'idle',gameId:'racer',elapsed:0,feedback:0}}};}
function tick(s,seconds,fn=()=>{}){for(let i=0;i<seconds;i++){fn(s);s.simSeconds++;observeCompanion(s,1);}}
test('a care click and elapsed calm time cannot report recovery without actual benefit',()=>{
  const s=state();rememberInteraction(s,'replace-food');const id=interactionSummary(s).pending[0].id;
  assert.equal(interactionSummary(s).results.length,0);tick(s,89);assert.equal(interactionSummary(s).pending.length,1);
  tick(s,1);const result=interactionSummary(s).results[0];assert.equal(result.id,id);assert.equal(result.status,'unconfirmed');assert.equal(result.benefit,0);
  assert.match(careObservationText(result),/没有确认/);assert.equal(s.companion.development.relationship.encounters,0);
});
test('observed food contact and real nutrition create a result only after the care window',()=>{
  const s=state();rememberInteraction(s,'feed');s.actor.consumingResource={kind:'food',id:'apple'};
  tick(s,11,v=>v.needs.satiety+=.5);assert.equal(interactionSummary(s).results.length,0);
  tick(s,1,v=>v.needs.satiety+=.5);const result=interactionSummary(s).results[0];assert.equal(result.status,'recovered');assert.ok(result.benefit>=1);assert.equal(s.companion.development.relationship.encounters,1);
  assert.match(careObservationText(result,true),/actual recovery/);
  const copied=interactionSummary(s);copied.results[0].status='corrupted';assert.equal(interactionSummary(s).results[0].status,'recovered');
});
test('pause freezes pending care and restored identity does not replay unfinished care',()=>{
  const s=state();rememberInteraction(s,'water');s.paused=true;tick(s,200);assert.equal(interactionSummary(s).pending[0].elapsed,0);
  const reopened=state();reopened.companion=structuredClone(s.companion);assert.deepEqual(interactionSummary(reopened),{pending:[],results:[]});
});
test('all habit evidence including early and lower-ranked habits remains visible',()=>{
  const s=state();for(const [index,target]of ['rest','feed','work','garden','flight','entry','perch','nook','toilet'].entries()){s.companion.activeSeconds=index*140;recordHabit(s.companion,'place',target,.8,{duration:20});}
  const summary=developmentSummary(s.companion);assert.equal(summary.habits.length,9);
  for(const h of summary.habits){assert.equal(h.established,false);const e=habitEvidence(h,s.companion.activeSeconds);assert.equal(e.neededCount,2);assert.equal(e.neededSpan,240);assert.equal(e.confidence,0);}
});
