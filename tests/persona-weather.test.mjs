import {VERSION} from '../public/world-spec.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {VOICE_BANKS,VOICE_EVENTS,voiceLine} from '../public/companion-voice-catalog.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {createCompanionVoice,VoiceSchedule} from '../public/companion-voice.mjs';
import {weatherAt,weatherChoice,WEATHER_SLOT_MS} from '../public/home-weather.mjs';
test('all nineteen personalities have twenty complete bilingual lines and unique voice IDs',()=>{
  assert.equal(VOICE_BANKS.length,19);assert.equal(new Set(VOICE_BANKS.map(b=>b.referenceId)).size,19);
  for(const bank of VOICE_BANKS){const seen=new Set();for(const event of VOICE_EVENTS)for(let i=0;i<2;i++){const line=voiceLine(bank.id,event,i);assert.ok(line.text.length>=4&&line.english.length>3);assert.ok(!seen.has(line.text));seen.add(line.text);}assert.equal(seen.size,20);}
});
test('new companions express their voice persona in bounded initial temperament',()=>{
  for(let i=0;i<100;i++){const c=createCompanion({seed:i.toString(16).padStart(32,'0')}),bank=VOICE_BANKS.find(b=>b.id===c.voice.bank);for(const k of ['curiosity','caution','sociability'])assert.ok(Math.abs(c.temperament[k]-bank[k])<=.061);}
});
class FakeAudio extends EventTarget{constructor(){super();this.currentTime=0;this.volume=1;this.pauses=0;this.starts=0;}async play(){this.starts++;}pause(){this.pauses++;}removeAttribute(){}load(){}}
test('speech survives repeated preview, volume updates and simulation pause until real ended',async()=>{
  const audio=new FakeAudio(),page=new EventTarget();page.hidden=false;let time=0,caption=null;
  const c=createCompanion();adoptCompanion(c,'小豆');c.voice.enabled=true;
  const state={companion:c,paused:false,living:{escape:{phase:'calm'},sleep:{active:false},workstation:{phase:'idle'},physiology:{thirst:0,dirt:0},behavior:'idle'},actor:{},needs:{energy:80,satiety:80}};
  const voice=createCompanionVoice({audio,page,now:()=>time,onCaption:v=>caption=v});voice.update(state);await voice.preview(state);const pauses=audio.pauses;
  time=70;assert.equal(await voice.preview(state),false);voice.setVolume(.3);voice.update({...state,paused:true});
  assert.equal(audio.starts,1);assert.equal(audio.pauses,pauses);assert.ok(caption);assert.equal(voice.diagnostics().playing,'welcome');
  audio.dispatchEvent(new Event('ended'));assert.equal(caption,null);assert.equal(voice.diagnostics().playing,null);voice.dispose();
});
test('user mute and leaving the page remain immediate stop controls',async()=>{
  const audio=new FakeAudio(),page=new EventTarget();page.hidden=false;const c=createCompanion();adoptCompanion(c,'小豆');c.voice.enabled=true;
  const voice=createCompanionVoice({audio,page});const s={companion:c,paused:false};await voice.preview(s);const n=audio.pauses;page.hidden=true;page.dispatchEvent(new Event('visibilitychange'));assert.ok(audio.pauses>n);assert.equal(voice.diagnostics().playing,null);voice.dispose();
});
test('quiet interval begins after the utterance ends, with personality-specific spacing',()=>{
  const q=new VoiceSchedule();q.select('welcome',0,'seed',{bankId:'guardian'});q.finish(20);
  assert.equal(q.select('play',100,'seed',{bankId:'guardian'}),null);assert.ok(q.select('play',106,'seed',{bankId:'guardian'}));
});
test('random weather favours rain without re-rolling on refresh, and manual choices work',()=>{
  let rain=0;for(let slot=0;slot<10000;slot++)if(['rain','drizzle'].includes(weatherChoice('test',slot)))rain++;
  assert.ok(rain>7000&&rain<8000);assert.deepEqual(weatherAt('x',1234567),weatherAt('x',1234567));
  assert.equal(weatherAt('x',1234567,'clear').rain,0);assert.equal(weatherAt('x',1234567,'rain').rain,1);
});
test('automatic weather transitions are continuous across ten-minute boundaries',()=>{
  const t=WEATHER_SLOT_MS*10;const a=weatherAt('seed',t-1),b=weatherAt('seed',t);assert.ok(Math.abs(a.rain-b.rain)<.001);assert.ok(Math.abs(a.cloud-b.cloud)<.001);
});

test('the previous 7.0.0 server save remains compatible',async()=>{const {EmbodiedLife}=await import('../src/embodied-life.mjs');const old=new EmbodiedLife().serialize();old.version='7.0.0';const restored=new EmbodiedLife(old);assert.equal(restored.state.version,VERSION);assert.deepEqual(restored.state.needs,old.needs);});
