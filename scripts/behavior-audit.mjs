import fs from 'node:fs';import {EmbodiedLife}from '../src/embodied-life.mjs';
const [label='baseline',source='runtime-v5.7.0/home-state.json',durationText='600']=process.argv.slice(2),duration=Number(durationText),out='output/behavior-v5.8.0';if(!/^[a-z0-9-]+$/i.test(label)||!Number.isInteger(duration)||duration<1||duration>86400)throw Error('Invalid audit label/duration');fs.mkdirSync(out,{recursive:true});
const sim=new EmbodiedLife(source==='fresh'?null:JSON.parse(fs.readFileSync(source,'utf8')));sim.setPaused(false);fs.writeFileSync(out+'/'+label+'-initial.json',JSON.stringify(sim.serialize()));sim.state.speed=50;
const start=performance.now(),regions={},settled={},behaviors={},rows=[],stalls=[];let still=0,stillStart=0,last=[...sim.state.actor.position],maxStill=0;
for(let i=1;i<=duration;i++){
 sim.tick(.02);const s=sim.state,a=s.actor,l=s.living;const moved=Math.hypot(...a.position.map((v,j)=>v-last[j]));last=[...a.position];
 if(!a.position.every(Number.isFinite)||sim.neural.error)throw Error('Invalid physics/brain at '+i);
 for(const value of Object.values(s.needs))if(!Number.isFinite(value)||value<0||value>100)throw Error('Invalid need');
 regions[a.zoneId]=(regions[a.zoneId]??0)+1;if(a.contact)settled[a.zoneId]=(settled[a.zoneId]??0)+1;behaviors[l.behavior]=(behaviors[l.behavior]??0)+1;
 const purposeful=['eat','drink','rest','play','toilet','bathe','groom','observe'].includes(l.behavior)&&l.surface.blocked<1;
 if(moved<.025&&!purposeful){if(!still)stillStart=i;still++;maxStill=Math.max(maxStill,still);}else{if(still>=15)stalls.push({start:stillStart,duration:still,position:last});still=0;}
 rows.push({second:i,zone:a.zoneId,behavior:l.behavior,position:[...a.position],contact:a.contact,move:moved,blocked:l.surface.blocked,hold:sim.neural.sensory?.context?.holdReason,needs:{...s.needs},physiology:{...l.physiology},resource:a.consumingResource?.id,top:sim.neural.sensory?.signals?.filter(x=>x.scope!=='surface').sort((a,b)=>b.intensity-a.intensity).slice(0,3).map(x=>[x.id,x.intensity])});
 if(i%60===0){fs.writeFileSync(out+'/'+label+'-rows.json',JSON.stringify(rows));console.log(JSON.stringify({label,seconds:i,wallSeconds:Math.round((performance.now()-start)/1000),regions,behaviors,maxStill,position:a.position,needs:s.needs,physiology:l.physiology}));}
}
if(still>=15)stalls.push({start:stillStart,duration:still,position:last});sim.state.speed=1;
const report={label,configuredSpeed:50,seconds:duration,wallSeconds:(performance.now()-start)/1000,regions,settled,behaviors,maxStill,stalls,finalNeeds:sim.state.needs,finalPhysiology:sim.state.living.physiology};
fs.writeFileSync(out+'/'+label+'-report.json',JSON.stringify(report,null,2));fs.writeFileSync(out+'/'+label+'-checkpoint.json',JSON.stringify(sim.serialize()));console.log(JSON.stringify(report));
