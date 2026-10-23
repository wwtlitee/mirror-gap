// Offline asset production only. The application never receives an API key.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {VOICE_BANKS,VOICE_LINES,voiceLine} from '../public/companion-voice-catalog.mjs';
const root=path.resolve(import.meta.dirname,'..');
const generator=process.env.FISH_TTS_GENERATOR??'E:/git热门/scripts/generate_tts_audio.mjs';
const evidence=path.join(root,'output/companion-v7/voice-generation');
await fs.mkdir(evidence,{recursive:true});
const records=[],failures=[];
const prior=await fs.readFile(path.join(evidence,'report.json'),'utf8').then(JSON.parse).catch(()=>({records:[]}));
const inventory=new Map(prior.records.map(r=>[r.url,r]));let writing=Promise.resolve();
function persist(){writing=writing.then(async()=>{const tmp=path.join(evidence,'report.tmp.json');await fs.writeFile(tmp,JSON.stringify({records:[...inventory.values()],failures},null,2));await fs.rename(tmp,path.join(evidence,'report.json'));});return writing;}
function run(command,args,timeout=180000){return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Audio command timed out'));},timeout);
  child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error(output.slice(-1200)));});
});}
const jobs=VOICE_BANKS.flatMap(bank=>Object.keys(VOICE_LINES).flatMap(event=>[0,1].map(index=>({bank,event,index}))));
if(process.argv.includes('--samples'))jobs.splice(0,jobs.length,...VOICE_BANKS.map(bank=>({bank,event:'welcome',index:0})));
let cursor=0;
async function produce(){while(cursor<jobs.length){
  const {bank,event,index}=jobs[cursor++],line=voiceLine(bank.id,event,index),name=`${bank.id}-${event}-${index}`;
  const out=path.join(root,'public',line.url),rawDir=path.join(evidence,name),raw=path.join(rawDir,'raw.mp3');
  try{
    await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(rawDir,{recursive:true});
    const exists=await fs.stat(out).then(s=>s.size>1000).catch(()=>false);
    const previous=prior.records.find(r=>r.url===line.url);
    if(!exists||previous?.text!==line.text||previous?.referenceId!==bank.referenceId){
      if(exists)await fs.copyFile(out,path.join(rawDir,'previous.mp3'));
      const input=path.join(rawDir,'text.txt');await fs.writeFile(input,line.text);
      await run(process.execPath,[generator,'--provider','fish','--reference-id',bank.referenceId,'--model','s2.1-pro-free','--input',input,'--out',raw,'--format','mp3','--sample-rate','44100']);
      await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',raw,'-af','loudnorm=I=-22:TP=-3:LRA=7','-ar','24000','-b:a','64k',out]);
    }
    const duration=Number((await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',out])).trim());
    if(!Number.isFinite(duration)||duration<.4||duration>18)throw Error('Unexpected clip duration: '+duration);
    const buffer=await fs.readFile(out);const record={bank:bank.id,event,index,text:line.text,referenceId:bank.referenceId,model:'s2.1-pro-free',duration,bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),url:line.url};records.push(record);inventory.set(line.url,record);
    console.log('VOICE_OK '+name+' '+duration.toFixed(2)+'s');
  }catch(error){failures.push({name,error:error.message});console.error('VOICE_FAILED '+name+' '+error.message);}
  await persist();
}}
await Promise.all([produce(),produce()]);
console.log(JSON.stringify({completed:records.length,failures:failures.length}));
if(failures.length)process.exitCode=1;
