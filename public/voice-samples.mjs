import {VOICE_BANKS,VOICE_EVENTS,voiceLine} from './companion-voice-catalog.mjs';
const labels=['初次见面','吃饱了','喝够水','睡醒了','困了','玩游戏','脱困了','收拾干净','去探索','熟悉的地方'];
const event=document.querySelector('#sample-event'),variant=document.querySelector('#sample-variant'),audio=document.querySelector('#sample-player'),status=document.querySelector('#sample-status');
let current=null;
for(const [i,key] of VOICE_EVENTS.entries()){const option=document.createElement('option');option.value=key;option.textContent=labels[i];event.append(option);}
function lock(value){for(const el of document.querySelectorAll('.sample-play,select'))el.disabled=value;}
function finish(){current=null;lock(false);status.textContent='这句说完了，可以听下一位。';}
for(const bank of VOICE_BANKS){const card=document.createElement('article'),title=document.createElement('h2'),persona=document.createElement('p'),line=document.createElement('p'),button=document.createElement('button');
  card.dataset.bank=bank.id;title.textContent=bank.name;persona.textContent=bank.persona;line.className='line';button.textContent='听听它怎么说';button.className='sample-play';button.type='button';
  const update=()=>{line.textContent=voiceLine(bank.id,event.value,Number(variant.value)).text;};update();event.addEventListener('change',update);variant.addEventListener('change',update);
  button.addEventListener('click',async()=>{if(current)return;current=bank.id;lock(true);const clip=voiceLine(bank.id,event.value,Number(variant.value));audio.src=clip.url;status.textContent=bank.name+'：'+clip.text;
    try{await audio.play();}catch{finish();status.textContent='暂时无法播放，请重试。';}});
  card.append(title,persona,line,button);document.querySelector('#samples').append(card);
}
audio.addEventListener('ended',finish);audio.addEventListener('error',()=>{finish();status.textContent='音频无法加载，请稍后重试。';});
document.querySelector('#sample-stop').addEventListener('click',()=>{audio.pause();audio.currentTime=0;finish();status.textContent='已停止试听。';});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&current){audio.pause();audio.currentTime=0;finish();status.textContent='页面已离开，试听已停止。';}});
