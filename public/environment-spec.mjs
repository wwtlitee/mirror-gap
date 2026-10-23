import {bodyMetrics,BASE_BODY_RADIUS,BASE_CHARACTER_SCALE,BASE_BODY_OFFSETS} from './body-metrics.mjs';
import {resolveMeshContact,meshClearance} from './collision-world.mjs';
import {RESOURCE_SIGNALS,resourceContact} from './resource-contact.mjs';
import { SURFACE_CUES } from './surface-life.mjs';
import { FOOD_TOP, FOOD_PROPS, PERCH_POST, GARDEN_TOP, GARDEN_POOL, HABITAT_BRANCHES, TERRARIUM, BOOKCASE, boxForProp } from './habitat-layout.mjs';
// Metres. These solids and signal sources are shared by sensing and contact physics.
// A signal is information, never an instruction or a destination.
export const BODY_RADIUS = BASE_BODY_RADIUS;
export const CHARACTER_SCALE = BASE_CHARACTER_SCALE;
// Head, thorax and abdomen: same envelope used by physics and rendering.
export const BODY_OFFSETS = BASE_BODY_OFFSETS;
export const BRANCHES = [];
export const BRANCH_SEGMENTS = BRANCHES.flatMap(branch => branch.points.slice(1).map((end, i) => ({ start: branch.points[i], end, radius: branch.radius, zone: branch.zone ?? 'garden' })));
export function closestOnBranch(position, branch) {
  const line = branch.end.map((v, i) => v - branch.start[i]);
  const lengthSq = line.reduce((sum, v) => sum + v * v, 0);
  const t = Math.max(0, Math.min(1, line.reduce((sum, v, i) => sum + (position[i] - branch.start[i]) * v, 0) / lengthSq));
  return line.map((v, i) => branch.start[i] + t * v);
}
export const SOLIDS = [
  { id: 'bed', zone: 'rest', min: [-5.62, 0, -3.78], max: [-2.93, 1.04, -1.53] },
  { id: 'headboard', zone: 'rest', min: [-5.64, .6, -4.04], max: [-2.89, 2.79, -3.44] },
  { id: 'pillow', zone: 'rest', min: [-5.12, .90, -3.43], max: [-3.72, 1.30, -2.85] },
  { id: 'books', zone: 'flight', min: [-2.78, .04, 3.70], max: [-1.21, 1.05, 4.22] },
  { id: 'food-table', zone: 'feed', min: [-4.56, 0, -.18], max: [-2.29, 1.02, 2.89] },
  boxForProp('fruit-bowl','feed',FOOD_PROPS.fruit.x,FOOD_PROPS.fruit.z,.36,FOOD_TOP,1.24),
  boxForProp('water-bowl','feed',FOOD_PROPS.water.x,FOOD_PROPS.water.z,.28,FOOD_TOP,FOOD_TOP+.102),
  ...Array.from({length:12},(_,i)=>{const a=i*Math.PI/6,x=FOOD_PROPS.water.x+Math.cos(a)*.31,z=FOOD_PROPS.water.z+Math.sin(a)*.31;return boxForProp(`water-rim-${i}`,'feed',x,z,.05,FOOD_TOP+.08,FOOD_TOP+.157);}),
  boxForProp('nectar-bottle','feed',FOOD_PROPS.bottle.x,FOOD_PROPS.bottle.z,.18,FOOD_TOP,FOOD_TOP+.54),
  boxForProp('fig-plate','feed',FOOD_PROPS.fig.x,FOOD_PROPS.fig.z,.27,FOOD_TOP,FOOD_TOP+.12),
  { id: 'desk', zone: 'work', min: [-2.65, 0, -3.99], max: [.61, 1.32, -2.88] },
  { id: 'screen', zone: 'work', min: [-2.28, 1.58, -3.96], max: [-.12, 2.85, -3.64] },
  {id:'beanbag-seat',zone:'work',min:[-1.82,.04,-2.60],max:[-.54,.58,-1.55]},
  {id:'beanbag-back',zone:'work',min:[-1.84,.30,-1.79],max:[-.52,1.19,-1.27]},
  {id:'window-platform',zone:'garden',min:[.75,1.18,-4.09],max:[5.45,1.28,-3.67]},
  ...[1.18,5.02].map(x=>({id:`window-leg-${x}`,zone:'garden',min:[x-.04,0,-4.02],max:[x+.04,1.18,-3.80]})),
  {id:'terrarium-soil',zone:'perch',min:[2.65,.04,-.95],max:[5.58,.32,2.3]},
  {id:'wet-stone',zone:'entry',min:[2.65,.04,2.3],max:[5.58,.32,4.02]},
  ...BOOKCASE.levels.map((y,i)=>({id:`nook-shelf-${i}`,zone:'nook',min:[-5.55,y-.09,3.24],max:[-3.12,y,4.12]})),
  {id:'nook-back',zone:'nook',min:[-5.55,.04,4.04],max:[-3.12,3.34,4.12]},
  ...[-5.495,-3.175].map(x=>({id:`nook-side-${x}`,zone:'nook',min:[x-.055,.04,3.24],max:[x+.055,3.34,4.12]})),
  ...[1.03,1.84,2.65].map(y=>({id:`nook-divider-${y}`,zone:'nook',min:[-4.4175,y,3.28],max:[-4.3425,y+.72,4.08]})),
  ...BOOKCASE.levels.slice(0,4).flatMap((y,shelf)=>Array.from({length:9},(_,i)=>{
    if(i===4||shelf===1&&i>3)return null;
    const x=-5.33+i*.235,h=.38+((i*7+shelf*3)%5)*.05;
    return {id:`book-${shelf}-${i}`,zone:'nook',min:[x-.095,y,3.545],max:[x+.095,y+h+.025,4.03]};
  }).filter(Boolean)),
  boxForProp('burger','feed',-3.94,.48,.25,FOOD_TOP,FOOD_TOP+.35),
  boxForProp('pizza','feed',-2.82,2.48,.35,FOOD_TOP,FOOD_TOP+.095),

].map(s=>s.zone==='nook'?{...s,min:[-s.max[2]-1.53,s.min[1],s.min[0]+5.95],max:[-s.min[2]-1.53,s.max[1],s.max[0]+5.95]}:s);
export const SIGNAL_SOURCES = [
  ...SURFACE_CUES,
  ...RESOURCE_SIGNALS,
  { id: 'nest', zone: 'rest', kind: 'shelter', position: [-4.27, 1.04, -2.67], range: 5 },
  { id: 'window', zone: 'garden', kind: 'light', position: [3.10, 1.365, -3.88], range: 5 },
  { id: 'foliage', zone: 'perch', kind: 'humidity', position: [3.4, .60, 1.0], range: 3.8 },
  { id: 'screen', zone: 'work', kind: 'contrast', position: [-1.20, 1.42, -3.15], range: 3.5 },
  {id:'toilet',zone:'toilet',kind:'sanitation',position:[4.08,.66,.38],range:5},
  { id: 'high-perch', zone: 'perch', kind: 'texture', position: [4.96, 2.03, -.1], range: 2 },
  { id: 'breeze', zone: 'garden', kind: 'airflow', position: [3, 2.7, -4], range: 3 },
  { id: 'open-air', zone: 'flight', kind: 'space', position: [.25,2.25,.75], range: 7 },
  { id: 'bell', zone: 'entry', kind: 'vibration', position: [4.5, .40, 3.1], range: 2 },
];
export const clamp = (v, low, high) => Math.max(low, Math.min(high, v));

export function resolveContacts(position, velocity, radius = BODY_RADIUS, solids = SOLIDS, branches = BRANCH_SEGMENTS) {
  const m=bodyMetrics(radius/BODY_RADIUS);
  if(solids===SOLIDS&&branches===BRANCH_SEGMENTS)return resolveMeshContact(position,velocity,radius);
  let support = null;
  // Resolve axis-aligned solids by shortest translation; 20 ms integration and
  // a bounded speed keep a step smaller than the thinnest expanded solid.
  for (let pass = 0; pass < 3; pass++) for (const solid of solids) {
    const min = solid.min.map(v => v - radius), max = solid.max.map(v => v + radius);
    if (!position.every((v, i) => v > min[i] && v < max[i])) continue;
    let axis = 0, sign = -1, depth = Infinity;
    for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
      const d = side < 0 ? position[i] - min[i] : max[i] - position[i];
      if (d < depth) { depth = d; axis = i; sign = side; }
    }
    position[axis] = sign < 0 ? min[axis] : max[axis];
    if (velocity[axis] * sign < 0) velocity[axis] = 0;
    if (axis === 1 && sign > 0) support = solid;
  }
  const limits = [[-5.72, 5.72], [radius + .04, 4.62], [-4.12, 4.20]];
  for (let i = 0; i < 3; i++) {
    if (position[i] < limits[i][0]) { position[i] = limits[i][0]; velocity[i] = Math.max(0, velocity[i]); if (i === 1) support = { id: 'floor', zone: 'flight' }; }
    if (position[i] > limits[i][1]) { position[i] = limits[i][1]; velocity[i] = Math.min(0, velocity[i]); }
  }
  // Exact contact continues to count on a stationary surface.
  if (!support) support = solids.find(s => Math.abs(position[1] - s.max[1] - radius) < m.tolerance
    && position[0] >= s.min[0] - radius && position[0] <= s.max[0] + radius
    && position[2] >= s.min[2] - radius && position[2] <= s.max[2] + radius) ?? null;
  if (!support && position[1] <= radius + .04 + m.tolerance*.5) support = { id: 'floor', zone: 'flight' };
  for (const branch of branches) {
    const nearest = closestOnBranch(position, branch);
    const away = position.map((v, i) => v - nearest[i]);
    const distance = Math.hypot(...away), limit = radius + branch.radius;
    if (distance >= limit) continue;
    const normal = distance > 1e-8 ? away.map(v => v / distance) : [0, 1, 0];
    const incoming = velocity.reduce((sum, v, i) => sum + v * normal[i], 0);
    for (let i = 0; i < 3; i++) { position[i] += normal[i] * (limit - distance); if (incoming < 0) velocity[i] -= incoming * normal[i]; }
    if (normal[1] > .55) support = { id: 'branch', zone: branch.zone ?? 'garden' };
  }
  return support;
}

// Water contact is local and vertical: flying over a bowl cannot count as drinking.
export function waterContact(actor) {
  return Boolean(resourceContact(actor,'water'));
}

export function resolveBodyContacts(position, velocity, heading=0, solids=SOLIDS, branches=BRANCH_SEGMENTS, actorOrScale=1) {
  const m=bodyMetrics(actorOrScale);
  let support=null;
  for(let pass=0;pass<3;pass++) {
    let correction=0; support=null;
    for(const offset of m.offsets){
      const shift=[Math.sin(heading)*offset,0,Math.cos(heading)*offset];
      const point=position.map((v,i)=>v+shift[i]);
      const hit=resolveContacts(point,velocity,m.radius,solids,branches);
      for(let i=0;i<3;i++){const next=point[i]-shift[i];correction+=Math.abs(next-position[i]);position[i]=next;}
      if(hit)support=hit;
    }
    if(correction<1e-8)break;
  }
  return support;
}

// Bounded substeps protect thin surfaces even during rendering prediction or a hitch.
export function moveBody(position,velocity,dt,heading=0,solids=SOLIDS,branches=BRANCH_SEGMENTS,actorOrScale=1){
  const m=bodyMetrics(actorOrScale);
  const steps=Math.max(1,Math.ceil(Math.hypot(...velocity)*dt/m.movementStep));
  let support=null;
  for(let step=0;step<steps;step++){
    for(let i=0;i<3;i++)position[i]+=velocity[i]*dt/steps;
    support=resolveBodyContacts(position,velocity,heading,solids,branches,m.scale);
  }
  return support;
}

// Visual landing preparation, not a neural motor command. Only approaching a
// nearby support surface can extend legs; descending in open air cannot.
export function landingReadiness(actor,solids=SOLIDS,branches=BRANCH_SEGMENTS){
  const m=bodyMetrics(actor);
  if(actor.contact)return 1;
  if(solids===SOLIDS&&branches===BRANCH_SEGMENTS){const h=meshClearance(actor.position,.45*m.scale);const v=actor.velocity??[0,0,0];return h&&h.point[1]<actor.position[1]&&v[1]<-.08?clamp(1-(h.distance-m.radius)/(.25*m.scale),0,1):0;}
  const v=actor.velocity??[0,0,0],p=actor.position;
  if(!p||v[1]>=-.08)return 0;
  const reach=Math.min(.25*m.scale,.10*m.scale-v[1]*.12),x=p[0]+v[0]*.12,z=p[2]+v[2]*.12;
  let gap=p[1]-m.radius-.04;
  for(const s of solids)if(x>=s.min[0]-m.radius&&x<=s.max[0]+m.radius&&z>=s.min[2]-m.radius&&z<=s.max[2]+m.radius){
    const distance=p[1]-m.radius-s.max[1];if(distance>=-.015*m.scale)gap=Math.min(gap,distance);
  }
  for(const branch of branches){const near=closestOnBranch(p,branch);if(p[1]>near[1])gap=Math.min(gap,Math.hypot(...p.map((n,i)=>n-near[i]))-branch.radius-m.radius);}
  return gap>=-.015*m.scale&&gap<reach?clamp(1-gap/reach,0,1):0;
}

// Attenuate a direct sensory attraction hidden behind a solid. This avoids
// an inaccessible source beneath a shelf trapping the body on its top.
export function signalOccluded(from,to,solids=SOLIDS){
 return solids.some(s=>{
  // The cue-bearing surface itself remains visible; an intervening shelf does not.
  if(to[0]>=s.min[0]&&to[0]<=s.max[0]&&to[2]>=s.min[2]&&to[2]<=s.max[2]&&to[1]>=s.max[1]-.015&&to[1]<=s.max[1]+.20)return false;
  let near=0,far=1;
  for(let i=0;i<3;i++){
   const d=to[i]-from[i];
   if(Math.abs(d)<1e-9){if(from[i]<=s.min[i]||from[i]>=s.max[i])return false;continue;}
   const a=(s.min[i]-from[i])/d,b=(s.max[i]-from[i])/d;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far)return false;
  }
  return near>.015&&near<.88&&far>near;
 });
}

// Static contact friction prevents weak residual drive from sliding resting feet.
// Stronger motor forces and vertical takeoff remain fully available.
export function applyContactFriction(velocity, acceleration, dt, contact,actorOrScale=1) {
  const m=bodyMetrics(actorOrScale);
  if (!contact || !(dt > 0) || acceleration[1] > .25) return;
  const speed=Math.hypot(velocity[0],velocity[2]);
  const drive=Math.hypot(acceleration[0],acceleration[2]);
  if(speed<.035*m.scale && drive<.5*m.scale){velocity[0]=0;velocity[2]=0;return;}
  const ratio=speed>0?Math.max(0,1-.22*m.scale*dt/speed):0;
  velocity[0]*=ratio;velocity[2]*=ratio;
}

// Local mechanosensory/visual clearance uses the same three-sphere envelope as
// collision resolution. Decorative meshes are absent from the coarse SOLIDS
// list, so those boxes alone cannot reveal a leaf or mushroom trapping the body.
// This returns sensory evidence only: no actor mutation, chosen destination or
// physical displacement. Call it at the sensory cadence, not every body step.
export function senseLocalObstacles(actor) {
  const m=bodyMetrics(actor);
  const clearResult = {blocked:false,blockedAbove:false,escape:[0,0,0],turn:0,strength:0,clearance:.12};
  if(!Array.isArray(actor?.position) || actor.position.length!==3 || !actor.position.every(Number.isFinite)
    || !Number.isFinite(actor.heading))return clearResult;
  const position=actor.position,heading=actor.heading,reach=.12*m.scale;
  const clearanceAt=(position,facing)=>{
    let clearance=reach;
    const sin=Math.sin(facing),cos=Math.cos(facing);
    for(const offset of m.offsets){
      const point=[position[0]+sin*offset,position[1],position[2]+cos*offset];
      const hit=meshClearance(point,m.radius+reach);
      if(!hit)continue;
      // A valid support below the feet must not be mistaken for a wall. A
      // penetrating support is still reported; merely testing the centre would
      // otherwise hide a squeezed head or abdomen.
      const below=(point[1]-hit.point[1])/Math.max(hit.distance,1e-8);
      if(below>.55 && hit.distance>=m.radius-m.tolerance)continue;
      clearance=Math.min(clearance,hit.distance-m.radius);
    }
    return clearance;
  };
  const clearance=clearanceAt(position,heading);
  const roof=clearanceAt([position[0],position[1]+.10*m.scale,position[2]],heading);
  const blockedAbove=roof<.015*m.scale,blocked=clearance<.015*m.scale || blockedAbove;
  if(!blocked)return {...clearResult,clearance};

  let best=null;
  for(let i=0;i<8;i++){
    const angle=i*Math.PI/4,x=Math.sin(angle),z=Math.cos(angle);
    let turn=Math.atan2(Math.sin(angle-heading),Math.cos(angle-heading));
    // The elongated body can back out before turning around. Compare its
    // closest parallel axis rather than demanding a 180-degree spin in a gap.
    if(Math.abs(turn)>Math.PI/2)turn-=Math.sign(turn)*Math.PI;
    const facing=heading+turn;
    let ground=reach;
    for(const distance of [.07,.20])ground=Math.min(ground,
      clearanceAt([position[0]+x*distance*m.scale,position[1],position[2]+z*distance*m.scale],facing));
    const overhead=clearanceAt([position[0]+x*.20*m.scale,position[1]+.09*m.scale,position[2]+z*.20*m.scale],facing);
    const score=ground+.3*overhead-Math.abs(turn)*.003;
    if(!best || score>best.score)best={x,z,turn,score};
  }
  return {blocked,blockedAbove,escape:[best.x,blockedAbove?0:.25,best.z],turn:best.turn,
    strength:clamp((.04*m.scale-Math.min(clearance,roof))/(.06*m.scale),0,1),clearance};
}

// Furniture affordances are on top, not on the underside. The room-facing
// edge provides a clear approach corridor before the ordinary attraction resumes.
// This returns a sensory direction; it never changes body position or velocity.
export function topSurfaceApproach(actor,previous=null){
 const m=bodyMetrics(actor);
 const [x,y,z]=actor.position;
 for(const solid of SOLIDS.filter(s=>['desk','window-platform','food-table'].includes(s.id))){
  const edge=solid.max[2]+.38,above=solid.max[1]+.32,latched=previous?.id===solid.id;
  if(x<solid.min[0]-.4||x>solid.max[0]+.4||z<solid.min[2]-.2||z>edge+.65)continue;
  if(actor.contact&&y>solid.max[1]+.04)return null;
  if(latched&&['rise','cross-edge'].includes(previous.phase)){
   // Clear the body envelope before entering the tabletop. Keep this phase
   // across noisy motor samples instead of reclassifying it every frame.
   if(y<above-.04&&previous.phase!=='cross-edge')return {id:solid.id,phase:'rise',direction:[0,1,clamp(edge-z,-.12,.12)],top:above};
   if(z>solid.max[2]-.22)return {id:solid.id,phase:'cross-edge',direction:[clamp((solid.min[0]+solid.max[0])/2-x,-.25,.25),clamp((above-y)*2,-.15,.5),-1],top:above};
   return null;
  }
  if(y>=solid.max[1]+m.radius*.5)continue;
  const outside=z>=edge-.06;
  return {id:solid.id,phase:outside?'rise':'clear-edge',direction:outside?[0,1,clamp(edge-z,-.15,.15)]:[0,0,1],top:above};
 }
 return null;
}
