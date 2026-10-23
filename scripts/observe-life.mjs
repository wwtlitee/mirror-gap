import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {observationSample,analyzeObservation} from '../src/life-observation.mjs';
// Read-only bounded observation. No service commands or save writes.
const seconds=Number(process.argv[2]??60),label=process.argv[3]??'observe';
if(!Number.isFinite(seconds)||seconds<10||seconds>1800||! /^[a-z\d-]{1,40}$/i.test(label))throw Error('Use 10..1800 seconds and a simple label');
const started=performance.now(),samples=[],abort=new AbortController(),decoder=new TextDecoder();
const timer=setTimeout(()=>abort.abort(),seconds*1000);let buffer='',failure=null;
try{
 const response=await fetch('http://127.0.0.1:4191/api/stream',{signal:abort.signal});
 if(!response.ok)throw Error('State stream HTTP '+response.status);
 for await(const bytes of response.body){
  buffer+=decoder.decode(bytes,{stream:true});let end;
  while((end=buffer.indexOf('\n\n'))>=0){
   const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
   const data=block.split('\n').find(line=>line.startsWith('data: '));if(!data)continue;
   samples.push(observationSample(JSON.parse(data.slice(6)),performance.now()-started));
  }
  if(buffer.length>2e6)throw Error('Oversized state stream frame');
 }
 if(!abort.signal.aborted)failure='state-stream-ended';
}catch(error){if(!abort.signal.aborted)failure=error.message;}
finally{clearTimeout(timer);}
if(!samples.length)throw Error(failure??'No state packets received');
const report={observedAt:new Date().toISOString(),...analyzeObservation(samples),failure};
const directory='output/observation';await fs.mkdir(directory,{recursive:true});
const file=directory+'/'+report.observedAt.replace(/[:.]/g,'-')+'-'+label+'.json';
await fs.writeFile(file,JSON.stringify({report,samples},null,2));
await fs.writeFile(directory+'/latest.json',JSON.stringify({report,samples},null,2));
console.log(JSON.stringify({file,...report},null,2));if(failure)process.exitCode=1;
