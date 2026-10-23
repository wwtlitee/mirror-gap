import test from 'node:test';
import assert from 'node:assert/strict';

let api={};try{api=await import('../public/coop-trial.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const ready=()=>assert.equal(typeof api.createCoopTrial,'function','pure coop trial API must exist');
const checkpoint=id=>({type:'checkpoint',id,carrying:true});
const delivery=(foodId='fig')=>({type:'delivery',foodId,cargoId:'native-cargo-1',amount:20});
const decoded=(phase,input=0,selected='A')=>({type:'decodedSignal',input,phase,output:input^phase,selected});
const pulse=(extra={})=>({type:'signal',odor:'A',seconds:.25,powered:true,output:1,selected:'A',...extra});
const advance=(state,events=[],extra={})=>api.advanceCoopTrial(state,{seconds:.25,events,...extra});

test('trial creation is deterministic, isolated and requires known kind/positive attempt',()=>{
 ready();const a=api.createCoopTrial('courier'),b=api.createCoopTrial('courier');assert.deepEqual(a,b);assert.notEqual(a,b);assert.notEqual(a.route,b.route);
 assert.equal(a.id,'coop-trial-courier-1');assert.equal(a.status,'playing');assert.equal(a.result,null);assert.equal(a.collisionActive,false);
 for(const kind of ['','signalx',null])assert.throws(()=>api.createCoopTrial(kind));
 for(const attempt of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>api.createCoopTrial('signal',{attempt}));
});

test('courier requires carried cup→shelf→table then real fig delivery',()=>{
 ready();let state=api.createCoopTrial('courier');state=advance(state,[checkpoint('cup'),checkpoint('shelf'),checkpoint('table')]);assert.equal(state.status,'playing');
 assert.deepEqual(state.route,['cup','shelf','table']);state=advance(state,[delivery()]);assert.equal(state.status,'complete');assert.equal(state.delivery.foodId,'fig');
 assert.deepEqual(state.result,{elapsed:.5,energySpent:0,collisions:0,mistakes:0});assert.deepEqual(api.restoreCoopTrial(state),state);
});

test('courier wrong order restarts at cup and early/wrong delivery invalidates its route',()=>{
 ready();let state=api.createCoopTrial('courier');state=advance(state,[checkpoint('shelf')]);assert.equal(state.stats.mistakes,1);assert.deepEqual(state.route,[]);
 state=advance(state,[checkpoint('cup'),checkpoint('cup')]);assert.equal(state.stats.mistakes,2);assert.deepEqual(state.route,['cup']);
 state=advance(state,[delivery()]);assert.equal(state.stats.mistakes,3);assert.deepEqual(state.route,[]);assert.equal(state.status,'playing');
 state=advance(state,[{type:'checkpoint',id:'cup',carrying:false}]);assert.deepEqual(state.route,[]);
 state=advance(state,[checkpoint('cup'),checkpoint('shelf'),checkpoint('table'),delivery('pizza')]);assert.equal(state.stats.mistakes,4);assert.deepEqual(state.route,[]);
});

test('signal needs selected A decoded facts for both phases plus two seconds of real pulses',()=>{
 ready();let state=api.createCoopTrial('signal');state=advance(state,[decoded(0,1,'B'),decoded(1,0,'off'),pulse({powered:false})]);assert.deepEqual(state.decodedPhases,[]);assert.equal(state.signalSeconds,0);
 state=advance(state,[decoded(1),decoded(0),decoded(0)]);assert.deepEqual(state.decodedPhases,[1,0]);
 for(let i=0;i<7;i++)state=advance(state,[pulse()]);assert.equal(state.status,'playing');state=advance(state,[pulse({odor:'B'})]);assert.equal(state.status,'complete');assert.equal(state.signalSeconds,2);assert.deepEqual(api.restoreCoopTrial(state),state);
});

test('duplicate pulse facts cannot make more signal time than the elapsed slice',()=>{
 ready();const state=advance(api.createCoopTrial('signal'),[decoded(0),decoded(1),pulse(),pulse(),pulse(),pulse(),pulse(),pulse(),pulse(),pulse()]);assert.equal(state.signalSeconds,.25);assert.equal(state.status,'playing');
});

test('positive energy adds, charging cannot offset it, collisions count only rising edges across restore',()=>{
 ready();let state=api.createCoopTrial('courier');state=advance(state,[],{energySpent:3,collision:true});state=api.restoreCoopTrial(state);state=advance(state,[],{energySpent:-10,collision:true});assert.equal(state.stats.energySpent,3);assert.equal(state.stats.collisions,1);
 state=advance(state,[],{collision:false});state=advance(state,[],{energySpent:1.25,collision:true});assert.equal(state.stats.energySpent,4.25);assert.equal(state.stats.collisions,2);
});

test('advance/restore never mutate the original object and completed results stay fixed',()=>{
 ready();const original=api.createCoopTrial('courier'),before=JSON.stringify(original),next=advance(original,[checkpoint('cup')]);assert.equal(JSON.stringify(original),before);assert.notEqual(next.route,original.route);
 let done=advance(next,[checkpoint('shelf'),checkpoint('table'),delivery()],{energySpent:2,collision:true});const snapshot=structuredClone(done);done=advance(done,[checkpoint('wrong')],{energySpent:4,collision:false});assert.deepEqual(done,snapshot);assert.notEqual(done,snapshot);
 const restored=api.restoreCoopTrial(done);restored.stats.mistakes++;assert.deepEqual(done,snapshot);
});

test('restoration rejects missing fields, invalid prefixes, duplicate phases, false completions and result drift',()=>{
 ready();const courier=api.createCoopTrial('courier'),signal=api.createCoopTrial('signal');
 const bad=[];for(const key of ['kind','collisionActive','delivery','stats','result']){const x=structuredClone(courier);delete x[key];bad.push(x);}
 let x=structuredClone(courier);delete x.stats.energySpent;bad.push(x);x=structuredClone(courier);x.route=['shelf'];bad.push(x);x=structuredClone(signal);x.decodedPhases=[0,0];bad.push(x);
 x=structuredClone(signal);x.signalSeconds=1;x.elapsed=.25;bad.push(x);x=structuredClone(courier);x.status='complete';x.result={elapsed:0,energySpent:0,collisions:0,mistakes:0};bad.push(x);
 x=advance(courier,[checkpoint('cup'),checkpoint('shelf'),checkpoint('table'),delivery()]);x.result.mistakes=2;bad.push(x);
 x=structuredClone(signal);x.route=['cup'];bad.push(x);x=structuredClone(courier);x.stats.collisions=Infinity;bad.push(x);
 for(const state of bad)assert.throws(()=>api.restoreCoopTrial(state));
});

test('invalid batches, time, energy, collision and contradictory facts fail atomically',()=>{
 ready();const state=api.createCoopTrial('signal'),before=JSON.stringify(state);
 for(const options of [{seconds:-1},{seconds:.3},{seconds:NaN},{energySpent:Infinity},{collision:1},{events:[{type:'decodedSignal',input:0,phase:0,output:1}]},{seconds:.1,events:[pulse()]}])assert.throws(()=>api.advanceCoopTrial(state,options));
 assert.equal(JSON.stringify(state),before);
});
