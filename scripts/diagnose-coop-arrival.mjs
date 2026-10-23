import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resourceLandingTarget,resourceLandingPoses} from '../public/resource-landing.mjs';
import {RESOURCE_SIGNALS,resourceContact} from '../public/resource-contact.mjs';
import {withFoodStock} from '../public/food-stock.mjs';
import {routeSegmentClear,planRoute} from '../public/route-planner.mjs';
import {supportedFeet} from '../public/collision-world.mjs';

const [checkpointFile,out]=process.argv.slice(2);
if(!checkpointFile||!out||process.argv.length!==4)throw Error('Usage: node scripts/diagnose-coop-arrival.mjs <checkpoint> <new output directory>');
await fs.mkdir(out); // Never replace an earlier evidence run.
const checkpointBytes=await fs.readFile(checkpointFile),saved=JSON.parse(checkpointBytes),state=saved.body;
const before=JSON.stringify(state),actor=state.actor,results=[];
for(const source of RESOURCE_SIGNALS.filter(source=>source.resourceKind==='food'&&(state.living.care.foods[source.resourceId]??0)>0)){
  const result=withFoodStock(state,()=>{
    const poses=resourceLandingPoses(source.resourceId,actor),target=resourceLandingTarget(source,actor.position,actor);
    if(!target)return {id:source.resourceId,stablePoses:poses.length,target:null};
    const route=planRoute(actor,target.position,target.arrival);
    const finalClear=target.arrival?routeSegmentClear(target.arrival.via,target.position,target.arrival.heading,actor):null;
    const landing=target.arrival?{...actor,position:[...target.position],heading:target.arrival.heading,contact:true}:null;
    return {id:source.resourceId,stablePoses:poses.length,target,routeStatus:route.status,waypoints:route.waypoints,
      finalClear,landingFeet:landing?supportedFeet(landing.position,landing.heading,actor):null,landingResource:landing?resourceContact(landing,'food')?.id??null:null};
  });results.push(result);
}
if(JSON.stringify(state)!==before)throw Error('Static diagnosis mutated the saved body');
const report={productVersion:'8.5.0',kind:'static-geometry-only',brainRun:false,sourceCheckpoint:path.resolve(checkpointFile),checkpointSha256:createHash('sha256').update(checkpointBytes).digest('hex'),actor:structuredClone(actor),bodyUnchanged:true,results};
await fs.writeFile(path.join(out,'geometry-receipt.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({out,bodyUnchanged:true,brainRun:false,results:results.map(result=>({id:result.id,stablePoses:result.stablePoses,arrival:Boolean(result.target?.arrival),routeStatus:result.routeStatus,finalClear:result.finalClear,feet:result.landingFeet,resource:result.landingResource}))}));
