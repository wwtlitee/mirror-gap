import {weatherAt,WEATHER_TYPES} from './home-weather.mjs';
import {createHomeAmbience} from './home-ambience.mjs';
const KEY='mirror-gap-atmosphere-v1';
export function setupHomeAtmosphere({api,command}={}){
  let preferences={mode:'auto',enabled:true,volume:.28};
  try{const p=JSON.parse(localStorage.getItem(KEY));if(p&&['auto',...Object.keys(WEATHER_TYPES)].includes(p.mode)&&typeof p.enabled==='boolean'&&Number.isFinite(p.volume)&&p.volume>=0&&p.volume<=1)preferences=p;}catch{}
  const box=document.createElement('section');box.className='atmosphere-controls settings-group';box.dataset.noLocale='';
  box.innerHTML='<h3>环境与天气</h3><label for="home-weather">窗外天气</label><select id="home-weather"></select><p id="home-weather-state" role="status"></p><label><input id="home-ambience-enabled" type="checkbox"> <span id="home-ambience-label"></span></label><label for="home-ambience-volume" id="home-ambience-volume-label"></label><input id="home-ambience-volume" type="range" min="0" max="100" step="1">';
  document.querySelector('#settings-atmosphere').append(box);
  const select=box.querySelector('select'),check=box.querySelector('#home-ambience-enabled'),slider=box.querySelector('input[type=range]'),status=box.querySelector('p');
  check.checked=preferences.enabled;slider.value=preferences.volume*100;
  const audio=createHomeAmbience();audio.configure(preferences);let current=null,last=0,lastLanguage='',weatherSent=-Infinity,weatherPending=false;
  function save(){audio.configure(preferences);try{localStorage.setItem(KEY,JSON.stringify(preferences));}catch{status.textContent='设置暂时无法保存 / Settings cannot be saved.';}}
  select.addEventListener('change',()=>{preferences.mode=select.value;save();});
  check.addEventListener('change',()=>{preferences.enabled=check.checked;save();});
  slider.addEventListener('input',()=>{preferences.volume=Number(slider.value)/100;save();});
  return {update(state,speaking,now=Date.now()){
    const target=weatherAt(state.companion?.identity.seed??'mirror-home',(state.companion?.activeSeconds??state.simSeconds??0)*1000,preferences.mode);
    const blend=last?1-Math.exp(-Math.min(1,(now-last)/1000)/2.5):1;last=now;
    current=current?{...target,rain:current.rain+(target.rain-current.rain)*blend,wind:current.wind+(target.wind-current.wind)*blend,cloud:current.cloud+(target.cloud-current.cloud)*blend}:target;
    audio.update(state,current,speaking);
    if(api&&state.companion?.identity.adoptedAt&&!state.paused&&!weatherPending&&now-weatherSent>1000){weatherSent=now;weatherPending=true;void api('/api/command',{type:'weather',value:{rain:current.rain,wind:current.wind}}).catch(()=>{}).finally(()=>weatherPending=false);}
    const language=document.documentElement.lang,en=language==='en';
    if(language!==lastLanguage){lastLanguage=language;box.querySelector('h3').textContent=en?'Environment & weather':'环境与天气';select.replaceChildren(...['auto',...Object.keys(WEATHER_TYPES)].map(type=>{const el=document.createElement('option');el.value=type;el.textContent=type==='auto'?(en?'Automatic · rain often':'随机天气 · 多些雨天'):(en?WEATHER_TYPES[type].en:WEATHER_TYPES[type].label);return el;}));select.value=preferences.mode;
      box.querySelector('label[for=home-weather]').textContent=en?'Weather outside':'窗外天气';box.querySelector('#home-ambience-label').textContent=en?'Wind, rain, wings and distant footsteps':'风雨、振翅与屋外脚步声';box.querySelector('#home-ambience-volume-label').textContent=en?'Environment volume':'环境音量';
    }
    const description=(en?target.en:target.label)+(preferences.mode==='auto'?(en?' · changes gently':' · 自然变化'):'');if(status.textContent!==description)status.textContent=description;
    return current;
  },diagnostics:()=>({weather:current,...audio.diagnostics()}),dispose:()=>audio.dispose()};
}
