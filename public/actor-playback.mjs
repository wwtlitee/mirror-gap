import {bodyMetrics} from './body-metrics.mjs';
// Presentation clock only. Never changes the authoritative body or neural state.
// A short snapshot buffer absorbs the 10 Hz stream cadence and arrival jitter.
const mix=(a,b,u)=>a+(b-a)*u;
const angle=(a,b,u)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*u;
const valid=a=>a?.position?.length===3&&a.position.every(Number.isFinite);
export class ActorPlayback {
  constructor({delay=.14}={}){this.delay=delay;this.frames=[];this.cursor=null;this.speed=null;this.wasPaused=false;this.wall=0;this.arrivals=[];this.rate=null;this.starvedFrames=0;}
  sample(snapshot,delta){
    const {actor,simSeconds:t,paused}=snapshot??{};
    if(!valid(actor)||!Number.isFinite(t))return {actor,contactSeconds:snapshot?.living?.contactSeconds};
    const speed=Number.isFinite(snapshot.speed)&&snapshot.speed>0?snapshot.speed:1;
    const dt=Number.isFinite(delta)?Math.max(0,Math.min(delta,.25)):0;this.wall+=dt;
    const last=this.frames.at(-1);
    if(paused||this.wasPaused||this.speed!==speed||!last||t<last.t||t-last.t>1){
      this.frames=[];this.cursor=t-this.delay*speed;this.arrivals=[];this.rate=speed;
    }
    this.wasPaused=!!paused;this.speed=speed;
    if(!this.frames.length||this.frames.at(-1).t!==t){
      this.frames.push({t,actor:{...actor,position:[...actor.position],velocity:actor.velocity?.length===3&&actor.velocity.every(Number.isFinite)?[...actor.velocity]:[0,0,0]},contactSeconds:snapshot.living?.contactSeconds??0});
      this.arrivals.push({t,wall:this.wall});while(this.arrivals.length>20)this.arrivals.shift();
    }
    if(paused)return {actor,contactSeconds:snapshot.living?.contactSeconds};
    // Do not retime playback for each packet: that reintroduces 10 Hz pulses.
    // Only recover gradually if a long backlog forms after a suspended tab.
    // The configured speed is not a wall-clock promise: a busy server may run
    // slower. Following that promise drains the buffer and creates stop/go
    // movement at a steady render FPS. Estimate the actual clock over packets.
    const start=this.arrivals[0],end=this.arrivals.at(-1),span=end.wall-start.wall;
    const measured=span>=.75?(end.t-start.t)/span:speed;
    const targetRate=measured<speed*.9?Math.max(speed*.1,measured):speed;
    this.rate+=(targetRate-this.rate)*(1-Math.exp(-dt*3));
    const backlog=t-this.cursor,catchup=backlog>(this.delay+.2)*speed?1.05:1;
    // Ease into a depleted buffer; do not extrapolate across unknown collisions.
    const reserve=backlog<dt*this.rate?Math.max(0,backlog/(2*dt*this.rate)):1;
    if(backlog<.0001)this.starvedFrames++;
    this.cursor=Math.min(t,this.cursor+dt*this.rate*catchup*reserve);
    while(this.frames.length>2&&this.frames[1].t<=this.cursor)this.frames.shift();
    const a=this.frames[0],b=this.frames[1]??a;
    const u=b.t>a.t?Math.max(0,Math.min(1,(this.cursor-a.t)/(b.t-a.t))):0;
    const bodyScale=mix(bodyMetrics(a.actor).scale,bodyMetrics(b.actor).scale,u),overshoot=.01*bodyScale;
    const duration=b.t-a.t,flight=!a.actor.contact&&!b.actor.contact;
    const position=a.actor.position.map((x,i)=>{
      const y=b.actor.position[i];
      if(!flight||!duration)return mix(x,y,u);
      const v0=a.actor.velocity[i],v1=b.actor.velocity[i];
      if(!Number.isFinite(v0)||!Number.isFinite(v1))return mix(x,y,u);
      const u2=u*u,u3=u2*u;
      const h=(2*u3-3*u2+1)*x+(u3-2*u2+u)*duration*v0+(-2*u3+3*u2)*y+(u3-u2)*duration*v1;
      // Collision corrections are discontinuities, not curves to overshoot.
      return Math.max(Math.min(x,y)-overshoot,Math.min(Math.max(x,y)+overshoot,h));
    });
    return {actor:{...(u<1?a.actor:b.actor),position,...(a.actor.bodyScale!==undefined||b.actor.bodyScale!==undefined?{bodyScale}:{}),
      velocity:a.actor.velocity.map((v,i)=>mix(v,b.actor.velocity[i],u)),
      heading:angle(a.actor.heading??0,b.actor.heading??0,u),
      pitch:mix(a.actor.pitch??0,b.actor.pitch??0,u),bank:mix(a.actor.bank??0,b.actor.bank??0,u)},
      contactSeconds:mix(a.contactSeconds,b.contactSeconds,u)};
  }
  diagnostics(){return {delaySeconds:this.delay,buffered:this.frames.length,playbackTime:this.cursor,latestTime:this.frames.at(-1)?.t??null,clockRate:this.rate,starvedFrames:this.starvedFrames};}
}
