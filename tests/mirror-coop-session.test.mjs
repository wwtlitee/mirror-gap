import test from 'node:test';
import assert from 'node:assert/strict';
import {MirrorCoopSession} from '../src/mirror-coop-session.mjs';
import {createCoopTrial,advanceCoopTrial} from '../public/coop-trial.mjs';
import {createCoopPairing} from '../public/coop-pairing.mjs';

test('learning diagnostics expose live samples without changing or owning body state',()=>{
  const seedSession=new MirrorCoopSession({seed:8501});let session;
  try{
    const saved=seedSession.serialize();saved.coop.mechanical.emit='A';saved.coop.circuit.pulseOutput=1;
    session=new MirrorCoopSession({saved});const before=session.serialize(),snapshot=session.snapshot();
    const diagnostics=snapshot.coop.diagnostics.learning;
    assert.equal(diagnostics.rewardWindowRemainingMs,0);assert.equal(diagnostics.cueSamples.length,1);
    const sample=diagnostics.cueSamples[0],distance=Math.hypot(...sample.position.map((v,i)=>v-snapshot.actor.position[i]));
    assert.equal(sample.odor,'A');assert.equal(sample.distance,distance);assert.equal(sample.intensity,Math.exp(-distance/1.2));
    diagnostics.cueSamples[0].position[0]=999;diagnostics.rewardWindowRemainingMs=250;
    assert.deepEqual(session.serialize(),before);assert.notEqual(session.snapshot().coop.diagnostics.learning.cueSamples[0].position[0],999);
  }finally{session?.dispose();seedSession.dispose();}
});

test('cooperation starts with separate real subjects and empty plates rather than pre-awarded learning',()=>{
  const s=new MirrorCoopSession({seed:8501});try{const p=s.snapshot();assert.equal(p.coop.campaign.stage,0);assert.equal(p.coop.mechanical.cargo,null);
    assert.ok(Object.values(p.living.care.foods).every(n=>n===0));assert.equal(p.neural.learning.rewardPulses,0);assert.equal(p.neural.learning.changedSynapses,0);assert.equal(p.actor.supportFeet,6);
  }finally{s.dispose();}
});
test('mechanical commands cannot grant food, rewards, routes or move the neural body',()=>{
  const s=new MirrorCoopSession();try{const before=s.serialize();s.command('input',{move:[1,0],lift:1,emit:'A'});s.command('interact');const after=s.serialize();
    assert.deepEqual(after.body.actor,before.body.actor);assert.deepEqual(after.body.synapticMemory,before.body.synapticMemory);assert.deepEqual(after.body.living.care.foods,before.body.living.care.foods);
    assert.ok(after.coop.mechanical.cargo);assert.equal(s.snapshot().neural.learning.rewardPulses,0);
  }finally{s.dispose();}
});
test('invalid input and an invalid import leave the preceding complete state intact',()=>{
  const s=new MirrorCoopSession();try{const before=s.serialize();assert.throws(()=>s.command('input',{move:[NaN,0],lift:0,emit:'A'}));assert.throws(()=>s.command('import',{checkpoint:{format:1}}));assert.deepEqual(s.serialize(),before);assert.throws(()=>s.command('newGame',{confirm:false}));
  }finally{s.dispose();}
});
test('whole cooperation backup restores brain memory, body, cargo and campaign together',()=>{
  const a=new MirrorCoopSession();try{a.command('interact');const saved=a.serialize(),b=new MirrorCoopSession({saved:JSON.parse(JSON.stringify(saved))});
    try{const restored=b.serialize();assert.deepEqual(restored.body.actor,saved.body.actor);assert.deepEqual(restored.body.synapticMemory,saved.body.synapticMemory);assert.deepEqual(restored.coop,saved.coop);}
    finally{b.dispose();}
  }finally{a.dispose();}
});
test('pause freezes the life, mechanical subject and chain-derived pulse clock',()=>{
  const s=new MirrorCoopSession();try{s.command('input',{move:[1,0],lift:0,emit:'A'});s.command('pause',true);const before=s.serialize();s.tick(.1);assert.deepEqual(s.serialize(),before);s.command('pause',false);s.tick(.02);assert.ok(s.snapshot().simSeconds>before.body.simSeconds);}
  finally{s.dispose();}
});
test('probe and chapter skipping are unavailable before real campaign work',()=>{
  const s=new MirrorCoopSession();try{assert.throws(()=>s.command('probe'));assert.throws(()=>s.command('continue'));assert.equal(s.snapshot().coop.campaign.stage,0);}
  finally{s.dispose();}
});
test('a full plate keeps the cargo and cannot award a delivery',()=>{
  const a=new MirrorCoopSession();let b;
  try{
    a.command('interact');const saved=a.serialize();saved.body.living.care.foods.fig=100;
    saved.body.home.food=100/7;saved.coop.mechanical.position=[-3.62,1.327,2.24];saved.coop.mechanical.lastChargingPoint=[-2.1,1.6,1.6];
    b=new MirrorCoopSession({saved});const cargo=b.snapshot().coop.mechanical.cargo;
    b.command('interact');assert.deepEqual(b.snapshot().coop.mechanical.cargo,cargo);assert.equal(b.snapshot().coop.campaign.stats.deliveries,0);
  }finally{a.dispose();b?.dispose();}
});

test('the first snack is a small real portion rather than a full meal before the learning chapter',()=>{
  const initial=new MirrorCoopSession();let atPlate;
  try{initial.command('interact');const saved=initial.serialize();saved.coop.mechanical.position=[-3.62,1.327,2.24];
    atPlate=new MirrorCoopSession({saved});atPlate.command('interact');
    assert.equal(atPlate.snapshot().living.care.foods.fig,2);assert.equal(atPlate.snapshot().coop.mechanical.cargo,null);
    assert.equal(atPlate.snapshot().neural.learning.rewardPulses,0);
  }finally{initial.dispose();atPlate?.dispose();}
});
test('a corrupt notice or relay state is rejected before replacing a running save',()=>{
  const a=new MirrorCoopSession();try{
    for(const alter of [s=>{s.coop.notice=null;},s=>{s.coop.level.relays=null;},s=>{s.coop.level.visited='bad';}]){
      const saved=a.serialize();alter(saved);assert.throws(()=>new MirrorCoopSession({saved}));
      const before=a.serialize();assert.throws(()=>a.command('import',{checkpoint:saved}));assert.deepEqual(a.serialize(),before);
    }
  }finally{a.dispose();}
});
test('a physically occluded symmetric probe is rejected without masking food or modifying the fly',()=>{
  const a=new MirrorCoopSession();let b;
  try{const saved=a.serialize();saved.coop.campaign.stage=10;saved.coop.campaign.completed=Array.from({length:10},(_,i)=>i);
    Object.assign(saved.body.actor,{position:[-4.3,1.5,.5],contact:false,supportFeet:0,velocity:[0,0,0]});
    b=new MirrorCoopSession({saved});const before=b.serialize();assert.throws(()=>b.command('probe'),/遮挡|开阔/);assert.deepEqual(b.serialize(),before);
  }finally{a.dispose();b?.dispose();}
});
test('the unpaired observation has a declared natural no-signal interval after actual feeding',()=>{
  const a=new MirrorCoopSession();let b;
  try{const saved=a.serialize();saved.coop.campaign.stage=8;saved.coop.campaign.status='cleared';saved.coop.campaign.completed=Array.from({length:9},(_,i)=>i);
    saved.coop.campaign.progress.learning={type:'pairedLearning',odor:'A',consumedAmount:.01,teachingEvents:2,changedSynapses:1,elapsed:12};
    b=new MirrorCoopSession({saved});b.command('continue');const checkpoint=b.serialize();
    assert.ok(checkpoint.coop.level.neutralReadyAt>=checkpoint.body.simSeconds+3);
    checkpoint.coop.mechanical.emit='B';checkpoint.coop.circuit={pulseState:[1],elapsed:.1,steps:1,pulseOutput:1};
    const c=new MirrorCoopSession({saved:checkpoint});try{assert.equal(c.snapshot().coop.circuit.selected,'B');assert.equal(c.snapshot().coop.circuit.actual,'off');}finally{c.dispose();}
  }finally{a.dispose();b?.dispose();}
});

test('the phase task requires actual powered A selection, rather than off or an empty battery',()=>{
  const initial=new MirrorCoopSession();
  try{const base=initial.serialize();base.coop.campaign.stage=3;base.coop.campaign.completed=[0,1,2];
    base.coop.mechanical.position=[-2.8,1.65,.7];base.coop.circuit={pulseState:[1],elapsed:.05,steps:1,pulseOutput:1};
    for(const [emit,battery] of [['off',100],['A',0]]){
      const saved=structuredClone(base);saved.coop.mechanical.battery=battery;const s=new MirrorCoopSession({saved});
      try{s.command('input',{move:[0,0],lift:0,emit});s.tick(.02);s.command('interact');s.tick(.02);
        assert.deepEqual(s.snapshot().coop.campaign.progress.decodedPhases,[]);assert.equal(s.snapshot().coop.campaign.status,'playing');}
      finally{s.dispose();}
    }
    const s=new MirrorCoopSession({saved:base});try{s.command('input',{move:[0,0],lift:0,emit:'A'});s.tick(.02);s.command('interact');s.tick(.02);assert.equal(s.snapshot().coop.campaign.status,'cleared');}finally{s.dispose();}
  }finally{initial.dispose();}
});

test('a wrong charge order can be corrected by leaving and charging at the required station again',()=>{
  const initial=new MirrorCoopSession();const sessions=[];
  try{let saved=initial.serialize();saved.coop.campaign.stage=6;saved.coop.campaign.completed=Array.from({length:6},(_,i)=>i);saved.coop.mechanical.battery=35;
    const stations=[['table',[-3.5,1.6,1.4]],['shelf',[-4.3,1.7,-.4]],['table',[-3.5,1.6,1.4]]];
    for(const [,position] of stations){
      saved.coop.mechanical.position=[-2.1,1.6,1.6];const s=new MirrorCoopSession({saved});sessions.push(s);s.tick(.02);saved=s.serialize();
      saved.coop.mechanical.position=position;const at=new MirrorCoopSession({saved});sessions.push(at);at.tick(.02);saved=at.serialize();
    }
    assert.deepEqual(saved.coop.campaign.progress.charges,['shelf','table']);
    assert.equal(saved.coop.campaign.stats.mistakes,1);
  }finally{initial.dispose();sessions.forEach(s=>s.dispose());}
});

test('replayable trials unlock after the complete campaign and preserve the autonomous life',()=>{
  const initial=new MirrorCoopSession();let s;
  try{
    assert.throws(()=>initial.command('trial',{kind:'courier'}));
    const saved=initial.serialize();Object.assign(saved.coop.campaign,{stage:11,status:'complete',completed:Array.from({length:12},(_,i)=>i)});
    saved.coop.campaign.progress.reunionAmount=.005;s=new MirrorCoopSession({saved});
    const before=s.serialize();s.command('trial',{kind:'courier'});const after=s.serialize();
    assert.equal(after.coop.trial.kind,'courier');assert.equal(after.coop.trial.attempt,1);assert.equal(s.snapshot().coop.phase,'trial');
    assert.deepEqual(after.body,before.body);assert.deepEqual(after.coop.campaign,before.coop.campaign);
    assert.ok(s.snapshot().coop.objects.some(object=>object.kind==='delivery'&&object.foodId==='fig'));
    const restored=new MirrorCoopSession({saved:after});try{assert.deepEqual(restored.serialize().coop.trial,after.coop.trial);}finally{restored.dispose();}
    s.command('retry');assert.equal(s.snapshot().coop.trial.attempt,2);assert.deepEqual(s.serialize().body,before.body);
    s.command('endTrial');assert.equal(s.snapshot().coop.phase,'complete');assert.equal(s.snapshot().coop.trial,null);assert.deepEqual(s.serialize().body,before.body);
  }finally{initial.dispose();s?.dispose();}
});

test('completed trial history round-trips and cannot lose its attempt counters',()=>{
  const initial=new MirrorCoopSession();let restored;
  try{const saved=initial.serialize();Object.assign(saved.coop.campaign,{stage:11,status:'complete',completed:Array.from({length:12},(_,i)=>i)});saved.coop.campaign.progress.reunionAmount=.005;
    const trial=advanceCoopTrial(createCoopTrial('courier'),{events:[...['cup','shelf','table'].map(id=>({type:'checkpoint',id,carrying:true})),{type:'delivery',foodId:'fig',amount:1,cargoId:'actual-cargo'}]});
    saved.coop.trial=trial;saved.coop.trialHistory=[{...trial,completedAtSimSeconds:saved.body.simSeconds}];saved.coop.trialCounts={courier:1,signal:0};
    restored=new MirrorCoopSession({saved});assert.deepEqual(restored.serialize().coop.trialHistory,saved.coop.trialHistory);
    const broken=structuredClone(saved);delete broken.coop.trialCounts;assert.throws(()=>new MirrorCoopSession({saved:broken}));
  }finally{initial.dispose();restored?.dispose();}
});

test('an active pairing checkpoint must match its actual body time and authoritative q before import',()=>{
  const current=new MirrorCoopSession();
  try{for(const mismatch of ['time','weights']){
    const saved=current.serialize();saved.coop.campaign.stage=8;saved.coop.campaign.completed=Array.from({length:8},(_,i)=>i);
    const weights=structuredClone(saved.body.synapticMemory);if(mismatch==='weights')weights.efficacy[0]=.8;
    saved.coop.level.pairedStart=createCoopPairing({simSeconds:saved.body.simSeconds+(mismatch==='time'?1:0),weights});
    const before=current.serialize();assert.throws(()=>current.command('import',{checkpoint:saved}));assert.deepEqual(current.serialize(),before);
  }}finally{current.dispose();}
});

test('fractional public ticks buffer a complete physics step for both subjects and pairing',()=>{
  const initial=new MirrorCoopSession();let s;
  try{const saved=initial.serialize();saved.coop.campaign.stage=8;saved.coop.campaign.completed=Array.from({length:8},(_,i)=>i);s=new MirrorCoopSession({saved});
    const before=s.snapshot();s.command('input',{move:[1,0],lift:0,emit:'off'});s.tick(.01);
    assert.equal(s.snapshot().simSeconds,before.simSeconds);assert.deepEqual(s.snapshot().coop.mechanical.position,before.coop.mechanical.position);
    const restored=new MirrorCoopSession({saved:s.serialize()});try{restored.tick(.01);assert.ok(Math.abs(restored.snapshot().simSeconds-before.simSeconds-.02)<1e-8);}finally{restored.dispose();}
    s.tick(.24);assert.ok(Math.abs(s.snapshot().simSeconds-before.simSeconds-.24)<1e-8);assert.equal(s.snapshot().coop.paused,false);
  }finally{initial.dispose();s?.dispose();}
});
