import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoutePlanner,planRoute,routeSegmentClear,updateRoute,validateRoute} from '../public/route-planner.mjs';
import {moveBody} from '../public/environment-spec.mjs';

const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));

test('an arrival keeps its turning waypoint and ends at the real contact coordinate',()=>{
 const planner=createRoutePlanner({clearance:()=>null,occluded:()=>false,bounds:[[-3,.1,-3],[3,4,3]]});
 const actor={position:[1,1,-1],heading:0,bodyScale:.025},goal=[0,1,0],arrival={via:[0,1.002,-.256],heading:0};
 const before=structuredClone({actor,goal,arrival}),route=planner.plan(actor,goal,arrival);
 assert.equal(route.status,'ready');assert.deepEqual(route.waypoints.slice(-2),[arrival.via,goal]);
 assert.deepEqual(route.goal,goal);assert.deepEqual({actor,goal,arrival},before);
});

test('an obstructed final entry cannot be replaced by a hovering endpoint',()=>{
 const planner=createRoutePlanner({clearance:p=>p[2]>-.12&&p[2]<-.08?{distance:0}:null,occluded:()=>false,bounds:[[-3,.1,-3],[3,4,3]]});
 const actor={position:[1,1,-1],heading:0,bodyScale:.025};
 assert.equal(planner.plan(actor,[0,1,0],{via:[0,1,-.256],heading:0}).status,'unreachable');
 assert.throws(()=>planner.plan(actor,[0,1,0],{via:[0,1,0],heading:NaN}),/arrival/i);
});
function boxGeometry(boxes){
 return {
  clearance(position,radius){let nearest=Infinity;for(const box of boxes){const d=Math.hypot(...position.map((v,i)=>Math.max(box.min[i]-v,0,v-box.max[i])));nearest=Math.min(nearest,d);}return nearest<=radius?{distance:nearest}:null;},
  occluded(a,b){return boxes.some(box=>{let near=0,far=1;for(let i=0;i<3;i++){const d=b[i]-a[i];if(Math.abs(d)<1e-10){if(a[i]<box.min[i]||a[i]>box.max[i])return false;continue;}const x=(box.min[i]-a[i])/d,y=(box.max[i]-a[i])/d;near=Math.max(near,Math.min(x,y));far=Math.min(far,Math.max(x,y));if(near>far)return false;}return far>0&&near<1;});}
 };
}
test('three dimensional search finds a real route around a wall and caches static geometry',()=>{
 const planner=createRoutePlanner({...boxGeometry([{min:[-.4,.1,-1.1],max:[.4,3.8,1.1]}]),bounds:[[-3,.1,-3],[3,4,3]]});
 const actor={position:[-2,1,0],heading:0},goal=[2,1,0],before=structuredClone(actor),route=planner.plan(actor,goal);
 assert.equal(route.status,'ready');assert.ok(route.waypoints.length>1);assert.ok(route.expanded>0);
 let from=actor.position;for(const point of route.waypoints){assert.ok(planner.segmentClear(from,point,0));from=point;}
 assert.ok(route.waypoints.some(p=>Math.abs(p[2])>1.3));assert.deepEqual(actor,before);
 const stats=planner.cacheStats();assert.deepEqual(planner.plan(actor,goal),route);assert.deepEqual(planner.cacheStats(),stats);
});
test('an enclosed goal reports unreachable and never returns a collision crossing shortcut',()=>{
 const planner=createRoutePlanner({...boxGeometry([{min:[-.4,.1,-3],max:[.4,4,3]}]),bounds:[[-3,.1,-3],[3,4,3]]});
 const route=planner.plan({position:[-2,1,0],heading:0},[2,1,0]);assert.equal(route.status,'unreachable');assert.equal(route.reason,'no-route');assert.deepEqual(route.waypoints,[]);assert.ok(route.expanded<=5000);
});
test('blocked starting body and blocked destination remain distinct failure causes',()=>{
 const planner=createRoutePlanner({...boxGeometry([{min:[-1,.1,-1],max:[1,4,1]}]),bounds:[[-3,.1,-3],[3,4,3]]});
 const trapped=planner.plan({position:[0,1,0],heading:0},[2,1,2]);assert.equal(trapped.reason,'start-blocked');assert.equal(trapped.expanded,0);
 const blocked=planner.plan({position:[2,1,2],heading:0},[0,1,0]);assert.equal(blocked.reason,'goal-blocked');assert.equal(blocked.expanded,0);
 const saved=updateRoute({position:[6,2,0],heading:0},'water',[0,2,0],null,2);assert.equal(saved.status,'unreachable');assert.equal(saved.reason,'start-blocked');validateRoute(saved);
 const restored=JSON.parse(JSON.stringify(saved));assert.deepEqual(updateRoute({position:[6,2,0],heading:0},'water',[0,2,0],restored,3),saved);
 delete restored.reason;validateRoute(restored);assert.throws(()=>validateRoute({...saved,reason:'unknown'}));
});
test('a thin wall remains blocked even when its endpoints are closer than arrival tolerance',()=>{
 const planner=createRoutePlanner({...boxGeometry([{min:[-.005,.1,-3],max:[.005,4,3]}]),bounds:[[-3,.1,-3],[3,4,3]]});
 assert.equal(planner.plan({position:[-.04,1,0],heading:0},[.04,1,0]).status,'unreachable');
});
test('real room routes clear the desk edge, bed and canopy using physical collision movement',()=>{
 const cases=[
  {name:'desk underside',from:[-1.2,1,-3.2],goal:[-1.2,1.42,-3.15]},
  {name:'food table edge',from:[-3.3,.7,3.2],goal:[-2.82,1.24,.56]},
  {name:'bed edge',from:[-2.5,.5,-2.1],goal:[-4.27,1.14,-2.67]},
  {name:'canopy',from:[3.3,1.4,.6],goal:[4.95,2.7,.2]},
  {name:'toilet rim from supported base',from:[4,.3851,.85],goal:[4.225,.6021,.54]}
 ];
 for(const {name,from,goal} of cases){
  const actor={position:[...from],heading:0},route=planRoute(actor,goal);assert.equal(route.status,'ready',name);assert.ok(route.waypoints.length>1,name);
  let previous=[...from];const body=[...from];
  for(const waypoint of route.waypoints){
   const heading=Math.atan2(waypoint[0]-previous[0],waypoint[2]-previous[2]);
   assert.ok(routeSegmentClear(previous,waypoint,heading),name+' clearance');
   const steps=Math.ceil(distance(previous,waypoint)/.015);
   for(let i=1;i<=steps;i++){
    const expected=previous.map((v,k)=>v+(waypoint[k]-v)*i/steps),velocity=expected.map((v,k)=>(v-body[k])/.02);
    moveBody(body,velocity,.02,heading);assert.ok(distance(body,expected)<.016,name+' physical segment');
   }
   previous=waypoint;
  }
  assert.ok(distance(body,route.waypoints.at(-1))<.016,name);
 }
});
test('progress follows the route, rejects indefinite hovering and survives JSON checkpoints',()=>{
 const actor={position:[0,2,0],heading:0},goal=[1,2,1];let route=updateRoute(actor,'water',goal,null,0);
 validateRoute(route);const saved=JSON.parse(JSON.stringify(route));
 route=updateRoute(actor,'water',goal,route,3);assert.deepEqual(updateRoute(actor,'water',goal,saved,3),route);
 assert.equal(route.status,'ready');route=updateRoute(actor,'water',goal,route,11);assert.equal(route.status,'stalled');
 const moved={position:[.2,2,.2],heading:0};route=updateRoute(moved,'other',goal,route,12);assert.equal(route.status,'ready');assert.equal(route.replans,0);
 route=updateRoute({position:goal,heading:0},'other',goal,route,13);assert.equal(route.status,'arrived');
 route=updateRoute(moved,'other',goal,route,14);assert.equal(route.status,'ready');
 assert.throws(()=>validateRoute({...route,direction:[NaN,0,0]}));assert.throws(()=>planRoute({position:[NaN,1,1],heading:0},goal));
});
test('replanning a route does not reset its consecutive failures until observed movement makes progress',()=>{
 const actor={position:[0,2,0],heading:0},goal=[1,2,1];let route=updateRoute(actor,'water',goal,null,0);
 route.replans=1;route.waypoints=[[-3.2,.7,1.2]];
 route=updateRoute(actor,'water',goal,route,2.1);assert.equal(route.status,'ready');assert.equal(route.replans,2,'a newly computed distance is only a baseline');
 route=updateRoute({...actor,position:[.04,2,.04]},'water',goal,route,2.2);assert.equal(route.replans,2,'less than 8 cm progress is not recovery');
 route=updateRoute({...actor,position:[.08,2,.08]},'water',goal,route,2.3);assert.equal(route.replans,0,'real progress clears consecutive failures');
 const saved=JSON.parse(JSON.stringify(route));validateRoute(saved);assert.deepEqual(updateRoute({...actor,position:[.1,2,.1]},'water',goal,saved,2.4),updateRoute({...actor,position:[.1,2,.1]},'water',goal,route,2.4));
});
