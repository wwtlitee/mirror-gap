// Local CC0 window recording plus procedural wind, wings and footsteps.
export function createHomeAmbience({random=Math.random}={}){
  let ctx,master,duck,rain,wind,wings,wingTone,footBus,noiseBuffer,settings={enabled:true,volume:.28},nextFoot=0,steps=[],disposed=false;
  const nodes=[];let audible=false,footCount=0,lastFoot=null,lastCare=null,careSounds=0,rainLoaded=false,rainError=null;
  const gain=(value=0)=>{const n=ctx.createGain();n.gain.value=value;nodes.push(n);return n;};
  function bed(type,frequency){const source=ctx.createBufferSource();source.buffer=noiseBuffer;source.loop=true;const filter=ctx.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;const level=gain();source.connect(filter).connect(level).connect(duck);source.start();nodes.push(source,filter);return level;}
  async function activate(){if(disposed)return;try{
    if(!ctx){const AudioContext=globalThis.AudioContext??globalThis.webkitAudioContext;if(!AudioContext)return;ctx=new AudioContext();
      master=gain();duck=gain(1);const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-18;limiter.ratio.value=8;duck.connect(limiter).connect(master).connect(ctx.destination);nodes.push(limiter);
      noiseBuffer=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=random()*2-1;
      rain=gain();rain.connect(duck);
      fetch('/assets/ambience/window-rain.ogg').then(r=>{if(!r.ok)throw Error('Rain asset unavailable');return r.arrayBuffer();}).then(b=>ctx.decodeAudioData(b)).then(buffer=>{if(disposed)return;const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(rain);source.start();nodes.push(source);rainLoaded=true;}).catch(e=>rainError=e.message);
      wind=bed('lowpass',380);wings=bed('bandpass',240);
      const oscillator=ctx.createOscillator();oscillator.type='sine';oscillator.frequency.value=210;wingTone=gain();oscillator.connect(wingTone).connect(duck);oscillator.start();nodes.push(oscillator);
      footBus=gain(.5);footBus.connect(duck);nextFoot=ctx.currentTime+35+random()*55;
    }if(!document.hidden)await ctx.resume();
  }catch{ /* Unsupported or blocked audio leaves a fully usable silent room. */ }}
  function step(pan){
    const source=ctx.createBufferSource();source.buffer=noiseBuffer;const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=220;
    const envelope=ctx.createGain(),stereo=ctx.createStereoPanner(),t=ctx.currentTime;stereo.pan.value=pan;
    envelope.gain.setValueAtTime(0,t);envelope.gain.linearRampToValueAtTime(.2,t+.016);envelope.gain.exponentialRampToValueAtTime(.001,t+.16);
    source.connect(filter).connect(envelope).connect(stereo).connect(footBus);source.start(t,random(),.18);
    source.onended=()=>{source.disconnect();filter.disconnect();envelope.disconnect();stereo.disconnect();};footCount++;
  }
  function careSound(kind){
    const source=ctx.createBufferSource();source.buffer=noiseBuffer;
    const filter=ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=kind==='water'?1400:kind==='food'?700:2200;filter.Q.value=.6;
    const envelope=ctx.createGain(),t=ctx.currentTime,duration=kind==='water'?1.2:.45;
    envelope.gain.setValueAtTime(0,t);envelope.gain.linearRampToValueAtTime(.12,t+.08);envelope.gain.exponentialRampToValueAtTime(.001,t+duration);
    source.connect(filter).connect(envelope).connect(duck);source.start(t,0,duration);
    source.onended=()=>{source.disconnect();filter.disconnect();envelope.disconnect();};careSounds++;
  }
  const visibility=()=>{if(document.hidden){steps=[];if(ctx){master.gain.cancelScheduledValues(ctx.currentTime);master.gain.value=0;void ctx.suspend();}}else if(ctx)void activate();};
  document.addEventListener('pointerdown',activate);document.addEventListener('keydown',activate);document.addEventListener('visibilitychange',visibility);
  return {configure(value){settings=value;if(ctx&&!value.enabled){master.gain.cancelScheduledValues(ctx.currentTime);master.gain.value=0;steps=[];}},
    update(state,weather,speaking){if(!ctx||ctx.state!=='running')return;
      const t=ctx.currentTime,allowed=settings.enabled&&!document.hidden&&!state.paused&&(!state.companion||Boolean(state.companion.identity.adoptedAt));audible=allowed;
      master.gain.setTargetAtTime(allowed?settings.volume:0,t,.08);duck.gain.setTargetAtTime(speaking?.82:1,t,speaking?.18:.7);
      rain.gain.setTargetAtTime(weather.rain*.32,t,.8);wind.gain.setTargetAtTime(weather.wind*(.13+Math.sin(t*.27)*.025),t,.8);
      const flying=allowed&&!state.actor?.contact&&state.actor?.mode!=='rest'&&!state.living?.sleep?.active;
      wings.gain.setTargetAtTime(flying?.12:0,t,.08);wingTone.gain.setTargetAtTime(flying?.018:0,t,.08);
      const foot=state.living?.care?.footstep;
      if(foot!==undefined){if(lastFoot!==null&&foot>lastFoot&&allowed)step(-.8+((foot-1)%6)*.32);lastFoot=foot;}
      const maintenance=state.living?.care?.maintenance;
      if(maintenance){if(lastCare!==null&&maintenance.soundSequence>lastCare&&allowed&&!['quiet','enrich'].includes(maintenance.soundKind))careSound(maintenance.soundKind);lastCare=maintenance.soundSequence??0;}
      if(!allowed){steps=[];nextFoot=t+35+random()*55;return;}
      if(foot===undefined&&t>=nextFoot){const direction=random()<.5?1:-1;steps=Array.from({length:6},(_,i)=>({at:t+i*.48,pan:direction*(-.8+i*.32)}));nextFoot=t+70+random()*110;}
      while(steps.length&&steps[0].at<=t){const s=steps.shift();step(s.pan);}
    },diagnostics:()=>({supported:Boolean(globalThis.AudioContext??globalThis.webkitAudioContext),state:ctx?.state??'locked',enabled:settings.enabled,volume:settings.volume,audible,rainLoaded,rainError,careSounds,footsteps:footCount,duck:duck?.gain.value??1,rainGain:rain?.gain.value??0,windGain:wind?.gain.value??0,wingGain:wings?.gain.value??0,masterGain:master?.gain.value??0}),
    dispose(){disposed=true;document.removeEventListener('pointerdown',activate);document.removeEventListener('keydown',activate);document.removeEventListener('visibilitychange',visibility);steps=[];for(const node of nodes){try{node.stop?.();node.disconnect();}catch{}}void ctx?.close();}
  };
}
