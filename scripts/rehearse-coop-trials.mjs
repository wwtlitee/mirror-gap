import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {MirrorCoopSession} from '../src/mirror-coop-session.mjs';
import {makeMechanicalRoomResolver} from '../public/mechanical-room-collision.mjs';
import {withFoodStock} from '../public/food-stock.mjs';
import {distance3} from '../public/mirror-coop-world.mjs';
import {createPathPlanner,steering,collectRehearsalSources} from './rehearse-coop-campaign.mjs';

const [checkpointFile,out]=process.argv.slice(2),DT=.02;
if(!checkpointFile||!out||process.argv.length!==4)throw Error('Usage: node scripts/rehearse-coop-trials.mjs <actual completed checkpoint> <new output directory>');
const checkpoint=JSON.parse(await fs.readFile(checkpointFile,'utf8'));
if(checkpoint.coop?.campaign?.status!=='complete')throw Error('Trials require a genuinely completed native campaign');
await fs.mkdir(out);
const sources=await collectRehearsalSources({entrypoints:['scripts/rehearse-coop-trials.mjs']});
const sourceHash=JSON.stringify(sources),session=new MirrorCoopSession({saved:checkpoint}),resolver=makeMechanicalRoomResolver();
let state=session.snapshot(),emit='off',ticks=0;
const report={productVersion:'8.5.0',kind:'native-completed-individual-trials',seed:checkpoint.coop.seed,sourceHashes:sources,trials:[],error:null};
async function tick(){session.command('input',{move:[0,0],lift:0,emit,interact:false});session.tick(DT);await new Promise(resolve=>setImmediate(resolve));state=session.snapshot();ticks++;}
async function fly(id){
 const object=state.coop.objects.find(o=>o.id===id&&o.active);if(!object)throw Error('Missing actual trial object: '+id);
 const geometry=session.serialize().body,planner=createPathPlanner({resolveMove:q=>withFoodStock(geometry,()=>resolver(q))});
 const route=withFoodStock(geometry,()=>planner.plan(state.coop.mechanical.position,object.position)),started=state.simSeconds;
 for(const target of route.points.slice(1))while(distance3(state.coop.mechanical.position,target)>.12){
  session.command('input',steering(state.coop.mechanical.position,target,DT,emit));session.tick(DT);await new Promise(resolve=>setImmediate(resolve));state=session.snapshot();ticks++;
  if(state.simSeconds-started>60||state.coop.mechanical.battery<=0)throw Error('Trial flight failed: '+id);
 }
 await tick();
}
try{
 session.command('pause',false);
 for(const kind of ['courier','signal']){
  const before=session.serialize();session.command('trial',{kind});const after=session.serialize();
  assert.deepEqual(after.body.actor,before.body.actor);assert.deepEqual(after.body.needs,before.body.needs);assert.deepEqual(after.body.synapticMemory,before.body.synapticMemory);
  state=session.snapshot();emit=kind==='signal'?'A':'off';
  if(kind==='courier'){
   await fly('supply');session.command('interact');state=session.snapshot();assert.ok(state.coop.mechanical.cargo);
   for(const id of ['cup','shelf','table'])await fly(id);
   await fly('plate-fig');session.command('interact');state=session.snapshot();
  }else{
   let started=state.simSeconds;
   while(!state.coop.trial.decodedPhases.includes(0)&&state.simSeconds-started<5)await tick();
   await fly('phase');session.command('interact');state=session.snapshot();started=state.simSeconds;
   while(state.coop.trial.status!=='complete'&&state.simSeconds-started<12)await tick();
  }
  assert.equal(state.coop.trial.status,'complete');assert.ok(state.coop.trial.result);
  report.trials.push({kind,trial:structuredClone(state.coop.trial),historyCount:state.coop.trialHistory.length});
  await fs.writeFile(path.join(out,kind+'-completed-checkpoint.json'),JSON.stringify(session.serialize()));
  console.log(JSON.stringify({kind,result:state.coop.trial.result,history:state.coop.trialHistory.length}));
 }
 const history=structuredClone(state.coop.trialHistory),bodyBeforeRetry=session.serialize().body;
 session.command('retry');state=session.snapshot();assert.equal(state.coop.trial.status,'playing');assert.equal(state.coop.trial.attempt,2);
 assert.deepEqual(session.serialize().body,bodyBeforeRetry);
 session.command('endTrial');state=session.snapshot();assert.equal(state.coop.trial,null);assert.deepEqual(state.coop.trialHistory,history);
 assert.equal(state.coop.campaign.status,'complete');session.command('pause',true);
 await fs.writeFile(path.join(out,'final-checkpoint.json'),JSON.stringify(session.serialize()));
 report.retryPreservedBody=true;report.endTrialPreservedHistory=true;
}catch(error){report.error=error.stack??String(error);await fs.writeFile(path.join(out,'failed-checkpoint.json'),JSON.stringify(session.serialize()));}
finally{session.dispose();}
report.ticks=ticks;report.sourceUnchanged=sourceHash===JSON.stringify(await collectRehearsalSources({entrypoints:['scripts/rehearse-coop-trials.mjs']}));
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({out,trials:report.trials.length,error:report.error,sourceUnchanged:report.sourceUnchanged}));
process.exitCode=report.error||!report.sourceUnchanged?1:0;
