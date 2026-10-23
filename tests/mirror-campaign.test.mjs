import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN_CHAPTERS,CAMPAIGN_STAGES,createCampaignProgress,advanceCampaign,continueCampaign,retryCampaign,restoreCampaignProgress} from '../public/mirror-campaign.mjs';

const step=(s,events=[],seconds=.02)=>advanceCampaign(s,{seconds,events});
const delivery=(foodId='fig')=>({type:'delivery',foodId,amount:20,cargoId:'nutrient-1'});
const consumption=(foodId='fig')=>({type:'consumption',foodId,amount:.01});
function playFirstChapter(){let s=createCampaignProgress();s=step(s,[delivery()]);s=continueCampaign(s);s=step(s,[consumption()]);return continueCampaign(s);}

test('campaign has six authored chapters and twelve different connected stages',()=>{
  assert.equal(CAMPAIGN_CHAPTERS.length,6);assert.equal(CAMPAIGN_STAGES.length,12);
  assert.equal(new Set(CAMPAIGN_STAGES.map(s=>s.id)).size,12);
  assert.equal(new Set(CAMPAIGN_STAGES.map(s=>s.rule.kind)).size,12);
  assert.equal(createCampaignProgress().stage,0);
});
test('time, emission and fake eating intent cannot clear the first physical delivery',()=>{
  let s=createCampaignProgress();for(let i=0;i<40;i++)s=step(s,[],.25);
  assert.equal(s.status,'playing');assert.throws(()=>step(s,[{type:'eat'}]));
  assert.throws(()=>step(s,[{...delivery(),amount:0}]));
  assert.equal(step(s,[delivery()]).status,'cleared');
});
test('actual consumption is required after a delivery and progression needs explicit acknowledgement',()=>{
  const initial=createCampaignProgress(),delivered=step(initial,[delivery()]);
  assert.equal(delivered.stage,0);assert.equal(delivered.status,'cleared');assert.equal(initial.stats.deliveries,0);
  let s=continueCampaign(delivered);assert.equal(s.stage,1);assert.equal(s.status,'playing');
  s=step(s,[{type:'signal',odor:'A',seconds:.02,powered:true,output:0}]);assert.equal(s.status,'playing');
  s=step(s,[consumption()]);assert.equal(s.status,'cleared');assert.deepEqual(s.completed,[0,1]);
  assert.throws(()=>continueCampaign(initial));
});
test('relay order is a genuine choice and a wrong order resets only the puzzle sequence',()=>{
  let s=playFirstChapter();assert.equal(s.stage,2);
  s=step(s,[{type:'relay',id:'east'}]);assert.equal(s.status,'playing');assert.equal(s.stats.mistakes,1);
  s=step(s,[{type:'relay',id:'west'},{type:'relay',id:'east'}]);assert.equal(s.status,'cleared');
});
test('mixed malformed event batches reject atomically and negative time cannot advance a run',()=>{
  const s=createCampaignProgress(),before=structuredClone(s);
  assert.throws(()=>step(s,[delivery(),{type:'consumption',foodId:'fig',amount:NaN}]));
  assert.deepEqual(s,before);assert.throws(()=>step(s,[],-.01));assert.throws(()=>step(s,[],.251));
});
test('retry preserves completed history and totals while clearing current puzzle state',()=>{
  let s=playFirstChapter();s=step(s,[{type:'relay',id:'west'}]);
  const next=retryCampaign(s);assert.equal(next.stage,2);assert.equal(next.attempt,2);
  assert.equal(next.stats.deliveries,s.stats.deliveries);assert.deepEqual(next.completed,[0,1]);
  assert.deepEqual(next.progress.relaySequence,[]);assert.equal(next.stageSeconds,0);
});
test('complete campaign reaches an honest ending without requiring a preferred probe direction',()=>{
  let s=playFirstChapter();
  const stages=[
    [{type:'relay',id:'west'},{type:'relay',id:'east'}],
    [{type:'decodedSignal',input:0,phase:0,output:0},{type:'decodedSignal',input:0,phase:1,output:1}],
    ['cup','shelf','table'].map(id=>({type:'checkpoint',id,carrying:true})),
    [delivery('pizza'),{...delivery('burger'),cargoId:'nutrient-2'}],
    [{type:'charge',id:'shelf'},{type:'charge',id:'table'},{type:'energyArrival',battery:15,carrying:true}],
    [{type:'signal',odor:'A',seconds:.25,powered:true,output:1}],
    [{type:'pairedLearning',odor:'A',consumedAmount:.02,teachingEvents:2,changedSynapses:3,elapsed:12}],
    [{type:'neutralObservation',odor:'B',seconds:.25,rewardPulses:0}],
    [{type:'probe',elapsed:20,completed:true,frozen:true,rewardEnabled:false,weightsUnchanged:true,preferenceIndex:-.6}],
    [{type:'reunion',foodId:'fig',amount:.02}],
  ];
  for(const events of stages){
    for(let i=0;i<12&&s.status==='playing';i++)s=step(s,events,.25);
    assert.equal(s.status,'cleared',CAMPAIGN_STAGES[s.stage]?.id);s=continueCampaign(s);
  }
  assert.equal(s.status,'complete');assert.equal(s.completed.length,12);
  assert.equal(s.observations.at(-1).preferenceIndex,-.6);
  assert.equal(s.scientificLearningSuccess,null);
});
test('repeated cargo receipts do not create free progress or inventory awards',()=>{
  let s=playFirstChapter();s=step(s,[{type:'relay',id:'west'},{type:'relay',id:'east'}]);s=continueCampaign(s);
  s=step(s,[{type:'decodedSignal',input:0,phase:0,output:0},{type:'decodedSignal',input:0,phase:1,output:1}]);s=continueCampaign(s);
  s=step(s,['cup','shelf','table'].map(id=>({type:'checkpoint',id,carrying:true})));s=continueCampaign(s);
  s=step(s,[delivery('pizza'),delivery('burger')]);assert.equal(s.status,'playing');
  s=step(s,[{...delivery('burger'),cargoId:'different-cargo'}]);assert.equal(s.status,'cleared');
});
test('restore checks chapter continuity and cannot silently accept an impossible completion',()=>{
  const s=playFirstChapter(),restored=restoreCampaignProgress(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored,s);restored.stats.deliveries=99;assert.notEqual(restored.stats.deliveries,s.stats.deliveries);
  assert.throws(()=>restoreCampaignProgress({...s,stage:10}));
  assert.throws(()=>restoreCampaignProgress({...s,elapsed:Infinity}));
  assert.throws(()=>restoreCampaignProgress({...s,completed:[0,1,7]}));
});
test('the first meal wait contains optional real exploration without replacing actual feeding',()=>{
  let s=continueCampaign(step(createCampaignProgress(),[delivery()]));
  s=step(s,[{type:'discovery',id:'work'}]);assert.equal(s.stats.discoveries,1);assert.equal(s.status,'playing');
  s=step(s,[{type:'discovery',id:'work'}]);assert.equal(s.stats.discoveries,1);
  s=step(s,[{type:'discovery',id:'water'},{type:'discovery',id:'window'}]);assert.equal(s.stats.discoveries,3);assert.equal(s.status,'playing');
  s=step(s,[consumption()]);assert.equal(s.status,'cleared');assert.equal(continueCampaign(s).stats.discoveries,3);
});
test('early 8.5 development checkpoints acquire only the new exploration defaults',()=>{
  const s=createCampaignProgress();delete s.discoveries;delete s.stats.discoveries;
  const restored=restoreCampaignProgress(s);assert.deepEqual(restored.discoveries,[]);assert.equal(restored.stats.discoveries,0);assert.equal(restored.stage,0);
});

test('incomplete counters and unrelated observations cannot become accepted campaign saves',()=>{
  const saved=createCampaignProgress();delete saved.stats.deliveries;
  assert.throws(()=>restoreCampaignProgress(saved));
  const unrelated=createCampaignProgress();unrelated.observations=[delivery()];
  assert.throws(()=>restoreCampaignProgress(unrelated));
});

test('missing learning and a cleared flag without matching facts cannot skip a stage',()=>{
  const missing=createCampaignProgress();missing.stage=8;missing.completed=Array.from({length:8},(_,i)=>i);delete missing.progress.learning;
  assert.throws(()=>restoreCampaignProgress(missing));
  const falseClear=createCampaignProgress();falseClear.status='cleared';falseClear.completed=[0];
  assert.throws(()=>restoreCampaignProgress(falseClear));
  const badSequence=playFirstChapter();badSequence.progress.relaySequence=['unrelated','not-east'];
  assert.throws(()=>restoreCampaignProgress(badSequence));
});

test('one brief pairing cannot replace two actual pairings and twelve natural seconds',()=>{
  let s=createCampaignProgress();s.stage=8;s.completed=Array.from({length:8},(_,i)=>i);
  const fact={type:'pairedLearning',odor:'A',consumedAmount:.01,teachingEvents:1,changedSynapses:3,elapsed:1};
  s=step(s,[fact]);assert.equal(s.status,'playing');
  s=step(s,[{...fact,teachingEvents:2,elapsed:11.99}]);assert.equal(s.status,'playing');
  s=step(s,[{...fact,teachingEvents:2,elapsed:12}]);assert.equal(s.status,'cleared');
});
