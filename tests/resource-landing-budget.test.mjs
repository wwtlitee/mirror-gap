import test from 'node:test';
import assert from 'node:assert/strict';
import {withFoodStock} from '../public/food-stock.mjs';
import {resourceContact,RESOURCE_SIGNALS} from '../public/resource-contact.mjs';
import {resourceLandingPoses,resourceLandingPoint} from '../public/resource-landing.mjs';
const fresh=label=>import('../public/resource-landing.mjs?budget-test='+label);

test('incremental newborn search converges to the same fully validated poses without moving the actor',async()=>{
 const {resourceLandingPoses:sliced}=await fresh('newborn'),scale=.0193;
 const actor={bodyScale:scale,position:[3.1,1.365,-3.88],heading:0,contact:false},before=structuredClone(actor);
 for(const id of ['apple','fries','water-bowl']){
  const complete=resourceLandingPoses(id,actor),initial=structuredClone(sliced(id,actor,{candidateBudget:1}));
  assert.ok(initial.length<=1,'one candidate can expose at most one validated pose');
  for(let call=1;call<256;call++)sliced(id,actor,{candidateBudget:1});
  const result=sliced(id,actor,{candidateBudget:1});assert.deepEqual(result,complete,id);
  assert.ok(result.length>0,id+' remains reachable');
  for(const pose of result)assert.equal(resourceContact(pose,id==='water-bowl'?'water':'food')?.id,id);
 }
 assert.deepEqual(actor,before);
});

test('incremental adult search and synchronous completion retain original candidate order',async()=>{
 const {resourceLandingPoses:sliced}=await fresh('adult');
 const initial=sliced('fries',1,{candidateBudget:2});assert.ok(initial.length<=2);
 for(let call=1;call<96;call++)sliced('fries',1,{candidateBudget:2});
 assert.deepEqual(sliced('fries',1),resourceLandingPoses('fries',1));
});

test('separate living runtimes cannot advance each other’s unfinished geometry search',()=>{
 const first=new Map(),second=new Map();
 const a=resourceLandingPoses('fries',.0193,{candidateBudget:2,searchCache:first});
 const before=structuredClone(a);
 for(let call=0;call<128;call++)resourceLandingPoses('fries',.0193,{candidateBudget:2,searchCache:first});
 assert.deepEqual(resourceLandingPoses('fries',.0193,{candidateBudget:2,searchCache:second}),before);
 assert.notEqual(first.values().next().value,second.values().next().value);
});

test('a food-geometry change discards pending and completed poses before searching again',async()=>{
 const {resourceLandingPoses:sliced}=await fresh('depletion');
 const state={companion:{},home:{food:100},living:{care:{foods:{apple:100,banana:100,burger:100,pizza:100,fries:100,sandwich:100,fig:100}}}};
 withFoodStock(state,()=>{sliced('fries',.0193,{candidateBudget:2});sliced('fries',.0193);});
 state.living.care.foods.fries=0;
 withFoodStock(state,()=>assert.deepEqual(sliced('fries',.0193,{candidateBudget:2}),[]));
 state.living.care.foods.fries=100;
 withFoodStock(state,()=>assert.deepEqual(sliced('fries',.0193),resourceLandingPoses('fries',.0193)));
});

test('invalid search budgets fail explicitly and an unknown resource has no invented target',()=>{
 for(const candidateBudget of [0,-1,1.5,257,NaN])assert.throws(()=>resourceLandingPoses('apple',.0193,{candidateBudget}),/budget/);
 assert.equal(resourceLandingPoint({resourceKind:'food',resourceId:'missing'},[0,0,0],.0193,{candidateBudget:2}),null);
 const source=RESOURCE_SIGNALS.find(s=>s.resourceId==='fries');assert.ok(source);
 assert.ok(resourceLandingPoint(source,[0,1,0],1,{candidateBudget:2}));
});
