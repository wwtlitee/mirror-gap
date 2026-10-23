// Presentation only: never feeds back into neural or physical control.
export const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
export class CalmFollow {
  constructor(){this.velocity=[0,0];this.heading=0;this.initialized=false;}
  reset(heading){this.heading=heading;this.velocity=[0,0];this.initialized=true;}
  update(actor,dt){
    if(!this.initialized)this.reset(actor.heading??0);
    if(!(dt>0))return this.heading;
    dt=Math.min(dt,.1);
    const v=actor.velocity??[0,0,0],blend=1-Math.exp(-dt/1.1);
    const active=!actor.contact&&Math.hypot(v[0],v[2])>.22;
    for(let i=0;i<2;i++)this.velocity[i]+=((active?v[i===0?0:2]:0)-this.velocity[i])*blend;
    if(!active||Math.hypot(...this.velocity)<.20)return this.heading;
    const error=angleDifference(Math.atan2(...this.velocity),this.heading),deadZone=Math.PI/9;
    const beyond=Math.sign(error)*Math.max(0,Math.abs(error)-deadZone);
    this.heading+=Math.max(-.35*dt,Math.min(.35*dt,beyond*(1-Math.exp(-dt/1.5))));
    this.heading=angleDifference(this.heading,0);return this.heading;
  }
}
