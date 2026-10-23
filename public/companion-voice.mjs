import {hashSeed} from './companion-identity.mjs';
import {VOICE_BANKS,VOICE_LINES,voiceLine} from './companion-voice-catalog.mjs';
export const voiceBankFor=(seed,bank)=>VOICE_BANKS.find(v=>v.id===bank)??VOICE_BANKS[hashSeed(seed+':voice')%VOICE_BANKS.length];
export function voiceEvent(previous,state) {
  if(!previous||state.paused||!state.companion?.identity.adoptedAt)return null;
  const l=state.living,p=previous.living;
  if(p.escape.phase==='burst'&&l.escape.phase==='recover')return 'escaped';
  if(p.sleep.active&&!l.sleep.active&&state.needs.energy>95)return 'rested';
  if(!p.sleep.active&&l.sleep.active)return 'sleepy';
  if(previous.needs.satiety<99.5&&state.needs.satiety>=99.5&&previous.actor.consumingResource?.kind==='food')return 'fed';
  if(p.behavior==='drink'&&l.behavior!=='drink'&&l.physiology.thirst<.02)return 'drink';
  if(p.workstation.phase!=='playing'&&l.workstation.phase==='playing')return 'play';
  if(['groom','bathe'].includes(p.behavior)&&!['groom','bathe'].includes(l.behavior)&&l.physiology.dirt<.02&&l.wetness<.02)return 'clean';
  const milestone=state.companion.development?.milestones.at(-1),oldMilestone=previous.companion?.development?.milestones.at(-1);
  if(milestone&&milestone.id!==oldMilestone?.id){
    if(milestone.kind==='toy'&&l.workstation.phase==='playing')return 'play';
    if(milestone.kind==='habit'&&milestone.target.startsWith('place:'))return 'familiar';
  }
  const memory=state.companion.memories.at(-1),old=previous.companion?.memories.at(-1);
  if(memory&&memory.at!==old?.at&&memory.kind==='place'&&state.companion.learning.place[memory.target]?.count>=3&&memory.reward>0)return 'familiar';
  if(p.behavior!=='flight'&&l.behavior==='flight'&&l.focus?.action==='explore')return 'explore';
  return null;
}
export class VoiceSchedule {
  constructor(){this.last=-Infinity;this.events=new Map();this.variants=new Map();}
  finish(now){if(Number.isFinite(now))this.last=now;}
  select(event,now,seed,{preview=false,bankId}={}) {
    if(!Object.hasOwn(VOICE_LINES,event)||!Number.isFinite(now))return null;
    const bank=voiceBankFor(seed,bankId),last=this.variants.get(event);
    if(!preview&&(now-this.last<(bank.gap??35)||now-(this.events.get(event)??-Infinity)<180))return null;
    const index=last===undefined?hashSeed(seed+':'+event)%2:1-last;
    this.last=now;this.events.set(event,now);this.variants.set(event,index);
    return {...voiceLine(bank.id,event,index),bank:bank.id,event,index};
  }
}
export function createCompanionVoice({onCaption=()=>{},onError=()=>{},audio=new Audio(),page=document,now=()=>performance.now()/1000}={}) {
  audio.preload='none';let previous=null,current=null,unlocked=false,generation=0;
  const schedule=new VoiceSchedule();
  audio.addEventListener('ended',()=>{schedule.finish(now());current=null;onCaption(null);});
  audio.addEventListener('error',()=>{if(current){current=null;onCaption(null);onError('语音素材暂时无法播放。');}});
  const stop=()=>{generation++;audio.pause();audio.currentTime=0;current=null;onCaption(null);};
  async function play(state,event,preview=false){
    if(!state?.companion||page.hidden||current)return false;
    const c=state.companion;
    if(!preview&&(!c.voice.enabled||!unlocked||current))return false;
    const line=schedule.select(event,now(),c.identity.seed,{preview,bankId:c.voice.bank});if(!line)return false;
    stop();const token=generation;audio.src=line.url;audio.volume=c.voice.volume;current=line;
    try{await audio.play();if(token!==generation)return false;unlocked=true;onCaption({...line,name:c.identity.name});return true;}
    catch(error){if(token!==generation)return false;current=null;onCaption(null);if(error.name==='NotAllowedError')unlocked=false;else if(error.name!=='AbortError')onError('语音素材暂时无法播放。');return false;}
  }
  const visibility=()=>{if(page.hidden){stop();previous=null;}};
  // Browsers require a gesture after reload. The first interaction resumes the
  // saved voice preference; a muted companion remains silent.
  const activate=()=>{if(!unlocked&&previous?.companion?.voice.enabled&&previous.companion.identity.adoptedAt&&!previous.paused)void play(previous,'welcome',true);};
  page.addEventListener('visibilitychange',visibility);
  page.addEventListener('pointerdown',activate);
  page.addEventListener('keydown',activate);
  return {update(state){
    if(!state.companion)return;
    audio.volume=state.companion.voice.volume;
    if(!state.companion.voice.enabled&&previous?.companion.voice.enabled)stop();
    const event=voiceEvent(previous,state);previous=state;
    if(event)void play(state,event);
  },preview:state=>play(state,'welcome',true),stop,setVolume:value=>{audio.volume=Math.max(0,Math.min(1,value));},
  diagnostics:()=>({unlocked,playing:current?.event??null,bank:previous?.companion?voiceBankFor(previous.companion.identity.seed,previous.companion.voice.bank).id:null}),
  dispose(){page.removeEventListener('visibilitychange',visibility);page.removeEventListener('pointerdown',activate);page.removeEventListener('keydown',activate);stop();audio.removeAttribute('src');audio.load();}};
}
